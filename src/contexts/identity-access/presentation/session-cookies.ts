import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { AppConfig } from '@/shared/infrastructure/config/app-config';
import { ACCESS_COOKIE } from '@/shared/presentation/auth.guard';

import type { IssuedSession } from '../application/session-issuer';

export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/v1/auth';

/**
 * Carries no credential: it only says "a refresh token exists", for as long as it lives. The
 * frontend's proxy cannot see the refresh cookie (its path is /v1/auth), and the access cookie
 * expires after a few minutes, so without this marker an idle but valid session looks signed out.
 */
export const SESSION_COOKIE = 'pagador_session';

/** Tokens travel only in HttpOnly cookies, never readable by JavaScript (docs/09, 9.10). */
@Injectable()
export class SessionCookies {
  constructor(private readonly config: AppConfig) {}

  private base(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      domain: this.config.env.COOKIE_DOMAIN || undefined,
    };
  }

  set(response: Response, session: IssuedSession) {
    response.cookie(ACCESS_COOKIE, session.accessToken, { ...this.base(), path: '/', maxAge: this.config.env.ACCESS_TOKEN_TTL_SECONDS * 1000 });
    response.cookie(REFRESH_COOKIE, session.refreshToken, { ...this.base(), path: REFRESH_PATH, maxAge: this.config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
    response.cookie(SESSION_COOKIE, '1', { ...this.base(), path: '/', maxAge: this.config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
  }

  clear(response: Response) {
    response.clearCookie(ACCESS_COOKIE, { ...this.base(), path: '/' });
    response.clearCookie(REFRESH_COOKIE, { ...this.base(), path: REFRESH_PATH });
    response.clearCookie(SESSION_COOKIE, { ...this.base(), path: '/' });
  }
}
