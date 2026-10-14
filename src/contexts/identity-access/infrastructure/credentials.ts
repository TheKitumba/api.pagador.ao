import { createHash, randomBytes, randomInt } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/** Argon2id password hashing (docs/08, RNF-SEG-03). */
@Injectable()
export class PasswordHasher {
  hash(password: string) {
    return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  verify(hashed: string, password: string) {
    return verify(hashed, password).catch(() => false);
  }
}

/** Opaque random tokens (refresh tokens, invitations, password reset). Only the hash is stored. */
export function randomToken() {
  return randomBytes(48).toString('base64url');
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function sixDigitCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
