import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3333),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().optional(),
  APP_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_PRIVATE_KEY_PATH: z.string().default('keys/jwt-private.pem'),
  JWT_PUBLIC_KEY_PATH: z.string().default('keys/jwt-public.pem'),
  JWT_ISSUER: z.string().default('https://api.pagador.ao'),
  JWT_AUDIENCE: z.string().default('pagador.ao'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default('pagador'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  MAIL_FROM: z.string().default('pagador.ao <no-reply@pagador.ao>'),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
});

/** Environment validated at startup: the process refuses to boot with a bad configuration. */
export class AppConfig {
  readonly env: z.infer<typeof envSchema>;
  readonly jwtPrivateKey: string;
  readonly jwtPublicKey: string;

  constructor() {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
      throw new Error(`Invalid environment variables:\n${issues}`);
    }
    this.env = parsed.data;
    // RS256: the private key signs tokens, the public key verifies them.
    this.jwtPrivateKey = readFileSync(resolve(this.env.JWT_PRIVATE_KEY_PATH), 'utf8');
    this.jwtPublicKey = readFileSync(resolve(this.env.JWT_PUBLIC_KEY_PATH), 'utf8');
  }

  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }

  get corsOrigins() {
    return this.env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  }
}
