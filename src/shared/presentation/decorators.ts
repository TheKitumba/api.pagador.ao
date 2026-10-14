import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import type { Actor } from '../application/permissions';

export const IS_PUBLIC = 'isPublic';

/** Route without authentication (login, public careers page, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The authenticated actor, resolved by the auth guard. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  return context.switchToHttp().getRequest().actor;
});
