import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import type { Actor } from '../../application/permissions';
import { UnauthorizedError } from '../../domain/errors';

const ACTOR_KEY = 'actor';

/** The authenticated user of the current request or job (request-scoped via AsyncLocalStorage). */
@Injectable()
export class ActorContext {
  constructor(private readonly cls: ClsService) {}

  set(actor: Actor) {
    this.cls.set(ACTOR_KEY, actor);
  }

  get current(): Actor {
    const actor = this.cls.isActive() ? this.cls.get<Actor | undefined>(ACTOR_KEY) : undefined;
    if (!actor) throw new UnauthorizedError();
    return actor;
  }

  get optional(): Actor | undefined {
    return this.cls.isActive() ? this.cls.get<Actor | undefined>(ACTOR_KEY) : undefined;
  }
}
