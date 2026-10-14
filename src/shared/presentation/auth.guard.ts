import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { AccessTokenPayload } from '../application/access-token';
import { permissionsFor } from '../application/permissions';
import { UnauthorizedError } from '../domain/errors';
import { AppConfig } from '../infrastructure/config/app-config';
import { ActorContext } from '../infrastructure/context/actor-context';
import { IS_PUBLIC } from './decorators';

export const ACCESS_COOKIE = 'access_token';

/**
 * Authenticates every route (except @Public): verifies the RS256 access token from the
 * HttpOnly cookie or an `Authorization: Bearer` header and builds the request actor.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly actors: ActorContext,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<Request & { actor?: unknown }>();
    const token = this.extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedError();
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        publicKey: this.config.jwtPublicKey,
        algorithms: ['RS256'],
        issuer: this.config.env.JWT_ISSUER,
        audience: this.config.env.JWT_AUDIENCE,
      });
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedError('Sessão expirada', 'token_expired');
    }

    const actor = {
      userId: payload.sub,
      tenantId: payload.tid,
      companyId: payload.cid,
      employeeId: payload.eid,
      name: payload.name,
      roles: payload.roles,
      permissions: permissionsFor(payload.roles),
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
    request.actor = actor;
    this.actors.set(actor);
    return true;
  }

  private extractToken(request: Request) {
    const cookie = (request.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
    if (cookie) return cookie;
    const header = request.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }
}
