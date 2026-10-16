import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';

import { ApprovalsProvisioning } from '@/contexts/approvals/public';
import { CompanyProvisioning } from '@/contexts/organization/public';
import { PayrollProvisioning } from '@/contexts/payroll/public';
import { Mailer, SmsSender } from '@/shared/application/ports';
import { BusinessRuleViolation, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/shared/domain/errors';
import { Nif, PhoneNumber } from '@/shared/domain/value-objects';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { AppConfig } from '@/shared/infrastructure/config/app-config';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

import { assertStrongPassword, LOCK_MINUTES, MAX_FAILED_LOGINS } from '../domain/password-policy';
import { PasswordHasher, randomToken, sha256, sixDigitCode } from '../infrastructure/credentials';
import { TokenService } from '../infrastructure/token.service';
import { type IssuedSession, SessionIssuer, toSessionUser } from './session-issuer';

interface RequestInfo {
  ip?: string;
  userAgent?: string;
}

const OWNER_ROLES: Role[] = ['ACCOUNT_ADMIN', 'HR_MANAGER', 'PAYROLL_PROCESSOR', 'FINANCIAL_APPROVER'];

export type LoginResult = { kind: 'session'; session: IssuedSession } | { kind: 'two-factor'; challengeToken: string };

async function firstActiveMembership(prisma: PrismaService, userId: string, tenantId?: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, ...(tenantId ? { tenantId } : {}), OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) throw new UnauthorizedError('Esta conta não tem acesso a nenhuma empresa', 'no_membership');
  return membership;
}

/** Creates the account: tenant, company, owner user and the company defaults (pay items, workflows). */
@Injectable()
export class RegisterAccountUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly db: Database,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
    private readonly companies: CompanyProvisioning,
    private readonly payroll: PayrollProvisioning,
    private readonly approvals: ApprovalsProvisioning,
    private readonly audit: AuditService,
  ) {}

  async execute(
    input: { name: string; email: string; password: string; company: { name: string; nif: string; size: string; province: string } },
    info: RequestInfo,
  ) {
    assertStrongPassword(input.password);
    const nif = Nif.company(input.company.nif);
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictError('Já existe uma conta com este e-mail', 'email_taken');

    const passwordHash = await this.hasher.hash(input.password);
    const { user, membership } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.company.name } });
      const user = await tx.user.create({ data: { name: input.name.trim(), email, passwordHash } });
      const membership = await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, roles: OWNER_ROLES } });
      return { user, membership };
    });

    const companyId = await this.db.runAsTenant(membership.tenantId, async () => {
      const id = await this.companies.createCompany({ legalName: input.company.name, nif: nif.value, size: input.company.size, province: input.company.province });
      await this.payroll.provisionCompany(id);
      await this.approvals.provisionTenant();
      await this.audit.record({ action: 'account.register', entityType: 'company', entityId: id, after: { company: input.company.name, owner: email } });
      return id;
    });

    const updated = await this.prisma.membership.update({ where: { id: membership.id }, data: { companyId } });
    return this.sessions.issue(user, updated, info);
  }
}

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
    private readonly tokens: TokenService,
  ) {}

  async execute(input: { email: string; password: string; tenantId?: string }, info: RequestInfo): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    const invalid = new UnauthorizedError('E-mail ou palavra-passe incorrectos', 'invalid_credentials');
    if (!user?.passwordHash || user.status === 'DISABLED') throw invalid;

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError(`Conta bloqueada temporariamente. Tente após ${LOCK_MINUTES} minutos.`, 'account_locked');
    }

    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      const failedLogins = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins, lockedUntil: failedLogins >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      throw invalid;
    }

    const membership = await firstActiveMembership(this.prisma, user.id, input.tenantId);
    if (user.twoFactorEnabled) return { kind: 'two-factor', challengeToken: await this.tokens.signChallenge(user.id, membership.tenantId) };
    return { kind: 'session', session: await this.sessions.issue(user, membership, info) };
  }
}

@Injectable()
export class VerifyTwoFactorLoginUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: { challengeToken: string; code: string }, info: RequestInfo) {
    const challenge = await this.tokens.verifyChallenge(input.challengeToken).catch(() => {
      throw new UnauthorizedError('Pedido de verificação expirado. Entre de novo.', 'challenge_expired');
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: challenge.sub } });
    if (!user.totpSecret || !(await verifyTotp({ secret: user.totpSecret, token: input.code })).valid) {
      throw new UnauthorizedError('Código de verificação inválido', 'invalid_2fa_code');
    }
    return this.sessions.issue(user, await firstActiveMembership(this.prisma, user.id, challenge.tid), info);
  }
}

/** Refresh token rotation with reuse detection: a reused token revokes every session of the user. */
@Injectable()
export class RefreshSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(refreshToken: string | undefined, info: RequestInfo) {
    if (!refreshToken) throw new UnauthorizedError('Sessão terminada', 'no_refresh_token');
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date()) throw new UnauthorizedError('Sessão expirada', 'refresh_expired');

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedError('Sessão inválida. Entre de novo.', 'refresh_reused');
    }

    const membership = await firstActiveMembership(this.prisma, stored.userId, stored.tenantId);
    const session = await this.sessions.issue(stored.user, membership, info);
    const replacement = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(session.refreshToken) } });
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date(), replacedBy: replacement.id } });
    return session;
  }
}

@Injectable()
export class LogoutUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

@Injectable()
export class GetSessionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContext,
  ) {}

  async execute() {
    const actor = this.actors.current;
    const membership = await this.prisma.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } }, include: { user: true } });
    return toSessionUser(membership.user, membership);
  }
}

/** Sign-in with phone + SMS code for workers without e-mail (docs/05, 5.6). Never reveals whether the number exists. */
@Injectable()
export class RequestLoginCodeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsSender,
  ) {}

  async execute(rawPhone: string) {
    const phone = PhoneNumber.create(rawPhone).value;
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || user.status !== 'ACTIVE') return;

    const recent = await this.prisma.oneTimeCode.count({ where: { identifier: phone, purpose: 'LOGIN', createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent > 0) throw new BusinessRuleViolation('Aguarde um minuto antes de pedir outro código', 'otp_rate_limited');

    const code = sixDigitCode();
    await this.prisma.oneTimeCode.create({ data: { identifier: phone, purpose: 'LOGIN', codeHash: sha256(code), expiresAt: new Date(Date.now() + 5 * 60_000) } });
    await this.sms.send(phone, `pagador.ao: o seu código de acesso é ${code}. Válido durante 5 minutos.`);
  }
}

@Injectable()
export class VerifyLoginCodeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: { phone: string; code: string }, info: RequestInfo) {
    const phone = PhoneNumber.create(input.phone).value;
    const invalid = new UnauthorizedError('Código inválido ou expirado', 'invalid_otp');
    const otp = await this.prisma.oneTimeCode.findFirst({ where: { identifier: phone, purpose: 'LOGIN', usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!otp || otp.attempts >= 5) throw invalid;
    if (otp.codeHash !== sha256(input.code)) {
      await this.prisma.oneTimeCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }
    await this.prisma.oneTimeCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { phone } });
    return this.sessions.issue(user, await firstActiveMembership(this.prisma, user.id), info);
  }
}

@Injectable()
export class SetupTwoFactorUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContext,
  ) {}

  async execute() {
    const actor = this.actors.current;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret, twoFactorEnabled: false } });
    return { secret, otpauthUrl: generateURI({ issuer: 'pagador.ao', label: user.email ?? user.phone ?? user.name, secret }) };
  }
}

@Injectable()
export class EnableTwoFactorUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async execute(code: string) {
    const actor = this.actors.current;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.totpSecret) throw new BusinessRuleViolation('Configure a autenticação de dois factores primeiro', '2fa_not_setup');
    if (!(await verifyTotp({ secret: user.totpSecret, token: code })).valid) throw new ValidationError('Código inválido', { code: ['Código inválido'] }, 'invalid_2fa_code');
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    await this.audit.record({ action: 'user.2fa_enabled', entityType: 'user', entityId: user.id });
  }
}

@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {}

  async execute(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const token = randomToken();
    await this.prisma.oneTimeCode.create({ data: { identifier: email, purpose: 'PASSWORD_RESET', codeHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
    await this.mailer.send({
      to: email,
      subject: 'Redefinir a palavra-passe — pagador.ao',
      template: 'password-reset',
      data: { name: user.name, resetUrl: `${this.config.env.APP_URL}/reset-password?token=${token}`, validMinutes: 30 },
    });
  }
}

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: { token: string; password: string }) {
    assertStrongPassword(input.password);
    const otp = await this.prisma.oneTimeCode.findFirst({ where: { codeHash: sha256(input.token), purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: { gt: new Date() } } });
    if (!otp) throw new UnauthorizedError('Ligação inválida ou expirada', 'invalid_reset_token');
    const passwordHash = await this.hasher.hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { email: otp.identifier }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
      this.prisma.oneTimeCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { user: { email: otp.identifier }, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }
}


/**
 * Opens another company of the same account: re-issues the session with that company and keeps it as
 * the user's current one (refreshes and later logins open it). The presented refresh token is rotated
 * like on refresh, so the previous session cannot be reused.
 */
@Injectable()
export class SwitchCompanyUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly sessions: SessionIssuer,
    private readonly audit: AuditService,
  ) {}

  async execute(companyId: string, refreshToken: string | undefined, info: RequestInfo) {
    const actor = this.actors.current;
    if (actor.roles.every((role) => role === 'EMPLOYEE')) throw new ForbiddenError('A sua conta só tem acesso à empresa onde trabalha', 'single_company');

    // Row-level security limits this lookup to the actor's account.
    const company = await this.db.tx.company.findUnique({ where: { id: companyId }, select: { id: true, tenantId: true } });
    if (!company || company.tenantId !== actor.tenantId) throw new NotFoundError('Empresa', companyId);

    const before = actor.companyId;
    const membership = await this.db.tx.membership.update({
      where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } },
      data: { companyId: company.id },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const session = await this.sessions.issue(user, membership, info);

    if (refreshToken) {
      const replacement = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(session.refreshToken) } });
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(refreshToken), userId: actor.userId, revokedAt: null },
        data: { revokedAt: new Date(), replacedBy: replacement.id },
      });
    }
    await this.audit.record({ action: 'session.switch_company', entityType: 'company', entityId: company.id, before: { companyId: before }, after: { companyId: company.id } });
    return session;
  }
}
