export interface DomainEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** Base for aggregates: collects domain events to be stored in the outbox with the change. */
export abstract class AggregateRoot {
  private readonly events: DomainEvent[] = [];

  protected record(type: string, payload: Record<string, unknown>) {
    this.events.push({ type, payload });
  }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
