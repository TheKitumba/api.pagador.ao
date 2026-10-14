import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { type Pagination, pageArgs, toPage } from '@/shared/application/pagination';
import { authorize } from '@/shared/application/permissions';
import { canonicalJson } from '@/shared/infrastructure/audit/canonical-json';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';

/** Audit log queries and tamper detection (docs/03 M25, docs/06 AuditLog). */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  private where(filter: { action?: string; entityType?: string; entityId?: string; actorUserId?: string; from?: Date; to?: Date }): Prisma.AuditLogWhereInput {
    return {
      ...(filter.action ? { action: { startsWith: filter.action } } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.from || filter.to ? { occurredAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
    };
  }

  async list(filter: Pagination & { action?: string; entityType?: string; entityId?: string; actorUserId?: string; from?: Date; to?: Date }) {
    authorize(this.actors.current, 'audit.read');
    const rows = await this.db.tx.auditLog.findMany({ where: this.where(filter), ...pageArgs(filter) });
    return toPage(rows.map((row) => ({ ...row, hash: undefined, prevHash: undefined })), filter.limit);
  }

  async exportRows(filter: { from?: Date; to?: Date }) {
    authorize(this.actors.current, 'audit.read');
    const rows = await this.db.tx.auditLog.findMany({ where: this.where(filter), orderBy: { id: 'asc' }, take: 50_000 });
    return rows.map((row) => ({ data: row.occurredAt.toISOString(), utilizador: row.actorName, accao: row.action, entidade: row.entityType, id_entidade: row.entityId, sensivel: row.sensitive ? 'sim' : 'não', ip: row.ip }));
  }

  /** Recomputes the hash chain; any edited or removed entry breaks it. */
  async verify() {
    const actor = this.actors.current;
    authorize(actor, 'audit.read');
    const rows = await this.db.tx.auditLog.findMany({ orderBy: { id: 'asc' } });
    let previous: string | null = null;
    for (const row of rows) {
      const body = {
        tenantId: row.tenantId,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before ?? undefined,
        after: row.after ?? undefined,
        sensitive: row.sensitive,
        ip: row.ip,
        userAgent: row.userAgent,
      };
      const expected: string = createHash('sha256').update(`${previous ?? ''}|${canonicalJson(body)}`).digest('hex');
      if (row.prevHash !== previous || row.hash !== expected) return { valid: false, entries: rows.length, brokenAt: { id: row.id, occurredAt: row.occurredAt, action: row.action } };
      previous = row.hash;
    }
    return { valid: true, entries: rows.length, brokenAt: null };
  }
}
