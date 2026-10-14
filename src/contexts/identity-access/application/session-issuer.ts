import { Injectable } from '@nestjs/common';
import type { Membership, User } from '@prisma/client';

import { permissionsFor } from '@/shared/application/permissions';
import { AppConfig } from '@/shared/infrastructure/config/app-config';
import { PrismaService } from '@/shared/infrastructure/prisma/prisma.service';

import { randomToken, sha256 } from '../infrastructure/credentials';
import { TokenService } from '../infrastructure/token.service';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  tenantId: string;
  companyId: string | null;
  employeeId: string | null;
  roles: string[];
  permissions: string[];
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export function toSessionUser(user: Pick<User, 'id' | 'name' | 'email'>, membership: Membership): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    tenantId: membership.tenantId,
    companyId: membership.companyId,
    employeeId: membership.employeeId,
    roles: membership.roles,
    permissions: [...permissionsFor(membership.roles)].sort(),
  };
}

/** Creates the access token (RS256 JWT) and a rotating refresh token for a membership. */
@Injectable()
export class SessionIssuer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  async issue(user: User, membership: Membership, context: { ip?: string; userAgent?: string }): Promise<IssuedSession> {
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tenantId: membership.tenantId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      tid: membership.tenantId,
      cid: membership.companyId ?? '',
      eid: membership.employeeId,
      name: user.name,
      roles: membership.roles,
    });
    return { accessToken, refreshToken, user: toSessionUser(user, membership) };
  }
}
