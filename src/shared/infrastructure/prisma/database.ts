import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;

const TX_KEY = 'db.tx';
const TENANT_KEY = 'db.tenantId';
const TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/**
 * Unit of work with tenant isolation. Every request and job runs inside one transaction as role
 * `pagador_app` with `app.tenant_id` set, so PostgreSQL Row-Level Security filters every query
 * even if a repository forgets a `where tenantId`.
 */
@Injectable()
export class Database {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  /** The active transaction. Repositories and query services always use this. */
  get tx(): Tx {
    const tx = this.cls.isActive() ? this.cls.get<Tx | undefined>(TX_KEY) : undefined;
    if (!tx) throw new Error('No active database transaction (use Database.runAsTenant/runAsSystem)');
    return tx;
  }

  get tenantId(): string {
    const tenantId = this.cls.get<string | undefined>(TENANT_KEY);
    if (!tenantId) throw new Error('No tenant in the current context');
    return tenantId;
  }

  get hasTransaction() {
    return this.cls.isActive() && Boolean(this.cls.get(TX_KEY));
  }

  runAsTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRawUnsafe('SET LOCAL ROLE pagador_app');
    }, tenantId);
  }

  /** Cross-tenant system work (login lookups, public careers page, worker). Explicit and rare. */
  runAsSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.$executeRawUnsafe('SET LOCAL ROLE pagador_app');
    });
  }

  private run<T>(fn: (tx: Tx) => Promise<T>, prepare: (tx: Tx) => Promise<void>, tenantId?: string): Promise<T> {
    const execute = async () => {
      const existing = this.cls.get<Tx | undefined>(TX_KEY);
      if (existing) return fn(existing);

      return this.prisma.$transaction(async (tx) => {
        await prepare(tx);
        this.cls.set(TX_KEY, tx);
        if (tenantId) this.cls.set(TENANT_KEY, tenantId);
        try {
          return await fn(tx);
        } finally {
          this.cls.set(TX_KEY, undefined);
        }
      }, TX_OPTIONS);
    };

    return this.cls.isActive() ? execute() : this.cls.run(execute);
  }
}
