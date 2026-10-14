import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ActorContext } from '../context/actor-context';
import { canonicalJson } from './canonical-json';
import { Database } from '../prisma/database';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  sensitive?: boolean;
}

const SENSITIVE_KEYS = /password|hash|secret|token|iban/i;

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (key, field) => (SENSITIVE_KEYS.test(key) ? '[redacted]' : field)));
}

/**
 * Append-only, hash-chained audit log written in the same transaction as the change
 * (docs/09, 9.6 rule 9). A per-tenant advisory lock keeps the chain ordered.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  async record(entry: AuditEntry) {
    const tx = this.db.tx;
    const tenantId = this.db.tenantId;
    const actor = this.actors.optional;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit:${tenantId}`}))`;
    const previous = await tx.auditLog.findFirst({ where: { tenantId }, orderBy: { id: 'desc' }, select: { hash: true } });

    const body = {
      tenantId,
      actorUserId: actor?.userId ?? null,
      actorName: actor?.name ?? 'Sistema',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: redact(entry.before) as object | undefined,
      after: redact(entry.after) as object | undefined,
      sensitive: entry.sensitive ?? false,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent ?? null,
    };
    const prevHash = previous?.hash ?? null;
    const hash = createHash('sha256')
      .update(`${prevHash ?? ''}|${canonicalJson(body)}`)
      .digest('hex');

    await tx.auditLog.create({ data: { ...body, before: body.before ?? undefined, after: body.after ?? undefined, prevHash, hash } });
  }
}
