import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { defaultIfEmpty, firstValueFrom, from } from 'rxjs';

import { ActorContext } from '../infrastructure/context/actor-context';
import { Database } from '../infrastructure/prisma/database';

/**
 * Wraps every authenticated request in one tenant transaction: the change, its audit entry and
 * its outbox events commit or roll back together, and RLS scopes every query to the tenant.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    const actor = this.actors.optional;
    if (!actor) return next.handle();

    return from(this.db.runAsTenant(actor.tenantId, () => firstValueFrom(next.handle().pipe(defaultIfEmpty(undefined)))));
  }
}
