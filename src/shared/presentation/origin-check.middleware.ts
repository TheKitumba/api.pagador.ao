import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ForbiddenError } from '../domain/errors';
import { AppConfig } from '../infrastructure/config/app-config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie sessions (docs/09, 9.10): mutations from a browser must come from an
 * allowed origin. Requests without Origin (server-to-server, Bearer tokens) are not affected.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  constructor(private readonly config: AppConfig) {}

  use(request: Request, _response: Response, next: NextFunction) {
    const origin = request.headers.origin;
    if (SAFE_METHODS.has(request.method) || !origin || this.config.corsOrigins.includes(origin)) return next();
    next(new ForbiddenError('Origem do pedido não autorizada', 'invalid_origin'));
  }
}
