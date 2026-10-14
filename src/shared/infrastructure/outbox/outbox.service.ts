import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AggregateRoot, DomainEvent } from '../../domain/aggregate-root';
import { Database } from '../prisma/database';

/**
 * Transactional outbox: integration events are stored with the change and published by the
 * worker, so no event is lost nor published without its change (docs/09, 9.4.2).
 */
@Injectable()
export class OutboxService {
  constructor(private readonly db: Database) {}

  async publish(type: string, payload: Record<string, unknown>) {
    await this.db.tx.outboxEvent.create({
      data: { tenantId: this.db.tenantId, type, payload: payload as Prisma.InputJsonValue },
    });
  }

  async publishAll(events: DomainEvent[]) {
    for (const event of events) await this.publish(event.type, event.payload);
  }

  async publishFrom(aggregate: AggregateRoot) {
    await this.publishAll(aggregate.pullEvents());
  }
}
