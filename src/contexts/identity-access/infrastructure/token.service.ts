import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AppConfig } from '@/shared/infrastructure/config/app-config';
import type { AccessTokenPayload } from '@/shared/application/access-token';

interface ChallengePayload {
  sub: string;
  tid: string;
  purpose: '2fa';
}

/** Signs and verifies JWTs with RS256 (private key signs, public key verifies). */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  signAccessToken(payload: AccessTokenPayload) {
    return this.jwt.signAsync(payload, {
      privateKey: this.config.jwtPrivateKey,
      algorithm: 'RS256',
      expiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: this.config.env.JWT_ISSUER,
      audience: this.config.env.JWT_AUDIENCE,
    });
  }

  /** Short-lived token proving the password step passed while the 2FA code is pending. */
  signChallenge(userId: string, tenantId: string) {
    return this.jwt.signAsync({ sub: userId, tid: tenantId, purpose: '2fa' } satisfies ChallengePayload, {
      privateKey: this.config.jwtPrivateKey,
      algorithm: 'RS256',
      expiresIn: 300,
      issuer: this.config.env.JWT_ISSUER,
      audience: `${this.config.env.JWT_AUDIENCE}:2fa`,
    });
  }

  verifyChallenge(token: string) {
    return this.jwt.verifyAsync<ChallengePayload>(token, {
      publicKey: this.config.jwtPublicKey,
      algorithms: ['RS256'],
      issuer: this.config.env.JWT_ISSUER,
      audience: `${this.config.env.JWT_AUDIENCE}:2fa`,
    });
  }
}
