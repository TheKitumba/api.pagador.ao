import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';

import { authorize, permissionsFor, ROLE_PERMISSIONS } from '@/shared/application/permissions';
import { Mailer } from '@/shared/application/ports';
import { BusinessRuleViolation, ConflictError, NotFoundError, UnauthorizedError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { AppConfig } from '@/shared/infrastructure/config/app-config';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

import { assertStrongPassword } from '../domain/password-policy';
import { PasswordHasher, randomToken, sha256 } from '../infrastructure/credentials';
import { SessionIssuer } from './session-issuer';

@Injectable()
export class ListUsersQuery {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  async execute() {
    const actor = this.actors.current;
    authorize(actor, 'users.manage');
    const [memberships, invitations] = await Promise.all([
      this.db.tx.membership.findMany({ where: { tenantId: actor.tenantId }, include: { user: true }, orderBy: { createdAt: 'asc' } }),
      this.db.tx.invitation.findMany({ where: { tenantId: actor.tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return {
      users: memberships.map((membership) => ({
        userId: membership.userId,
        name: membership.user.name,
        email: membership.user.email,
        phone: membership.user.phone,
        roles: membership.roles,
        employeeId: membership.employeeId,
        twoFactorEnabled: membership.user.twoFactorEnabled,
        lastLoginAt: membership.user.lastLoginAt,
        expiresAt: membership.expiresAt,
      })),
      pendingInvitations: invitations.map((invitation) => ({ id: invitation.id, email: invitation.email, roles: invitation.roles, expiresAt: invitation.expiresAt })),
    };
  }
}

export function roleCatalog() {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).map((role) => ({ role, permissions: [...permissionsFor([role])].sort() }));
}

@Injectable()
export class InviteUserUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { email: string; roles: Role[] }) {
    const actor = this.actors.current;
    authorize(actor, 'users.manage');
    const email = input.email.trim().toLowerCase();

    const existing = await this.db.tx.membership.findFirst({ where: { tenantId: actor.tenantId, user: { email } } });
    if (existing) throw new ConflictError('Esta pessoa já tem acesso', 'already_member');

    const token = randomToken();
    const invitation = await this.db.tx.invitation.create({
      data: { tenantId: actor.tenantId, email, roles: input.roles, tokenHash: sha256(token), invitedBy: actor.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    await this.audit.record({ action: 'user.invite', entityType: 'invitation', entityId: invitation.id, after: { email, roles: input.roles } });
    await this.mailer.send({
      to: email,
      subject: `${actor.name} convidou-o para o pagador.ao`,
      text: `Foi convidado(a) para a conta da empresa no pagador.ao com o papel ${input.roles.join(', ')}.\n\nAceite o convite em: ${this.config.env.APP_URL}/accept-invitation?token=${token}\nO convite é válido durante 7 dias.`,
    });
    return { id: invitation.id, email, roles: input.roles, expiresAt: invitation.expiresAt };
  }
}

@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: { token: string; name: string; password: string }, info: { ip?: string; userAgent?: string }) {
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) throw new UnauthorizedError('Convite inválido ou expirado', 'invalid_invitation');

    let user = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    if (!user) {
      assertStrongPassword(input.password);
      user = await this.prisma.user.create({ data: { name: input.name.trim(), email: invitation.email, passwordHash: await this.hasher.hash(input.password) } });
    }
    const company = await this.prisma.membership.findFirst({ where: { tenantId: invitation.tenantId, companyId: { not: null } }, select: { companyId: true } });
    const membership = await this.prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } },
      create: { tenantId: invitation.tenantId, userId: user.id, roles: invitation.roles, companyId: company?.companyId ?? null },
      update: { roles: invitation.roles },
    });
    await this.prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    return this.sessions.issue(user, membership, info);
  }
}

@Injectable()
export class ChangeUserRolesUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async execute(userId: string, input: { roles: Role[]; employeeId?: string | null }) {
    const actor = this.actors.current;
    authorize(actor, 'users.manage');
    const membership = await this.db.tx.membership.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } } });
    if (!membership) throw new NotFoundError('Utilizador', userId);
    if (userId === actor.userId && !input.roles.includes('ACCOUNT_ADMIN')) {
      throw new BusinessRuleViolation('Não pode retirar a si próprio o papel de administrador', 'cannot_demote_self');
    }
    const updated = await this.db.tx.membership.update({
      where: { id: membership.id },
      data: { roles: input.roles, ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}) },
    });
    await this.audit.record({ action: 'user.roles_changed', entityType: 'membership', entityId: membership.id, before: { roles: membership.roles }, after: { roles: updated.roles } });
    return { userId, roles: updated.roles, employeeId: updated.employeeId };
  }
}

@Injectable()
export class RemoveUserAccessUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async execute(userId: string) {
    const actor = this.actors.current;
    authorize(actor, 'users.manage');
    if (userId === actor.userId) throw new BusinessRuleViolation('Não pode remover o seu próprio acesso', 'cannot_remove_self');
    const membership = await this.db.tx.membership.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } } });
    if (!membership) throw new NotFoundError('Utilizador', userId);
    await this.db.tx.membership.delete({ where: { id: membership.id } });
    // Ends open sessions immediately.
    await this.db.tx.refreshToken.updateMany({ where: { userId, tenantId: actor.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'user.access_removed', entityType: 'membership', entityId: membership.id, before: { userId, roles: membership.roles } });
  }
}
