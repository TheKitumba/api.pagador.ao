import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { CONTEXT_MODULES } from './contexts';
import { HealthController } from './health.controller';
import { PortalModule } from './portal/portal.controller';
import { SharedInfrastructureModule } from './shared/infrastructure/shared-infrastructure.module';
import { AuthGuard } from './shared/presentation/auth.guard';
import { OriginCheckMiddleware } from './shared/presentation/origin-check.middleware';
import { ProblemDetailsFilter } from './shared/presentation/problem-details.filter';
import { TenantTransactionInterceptor } from './shared/presentation/tenant-transaction.interceptor';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    JwtModule.register({ global: true }),
    SharedInfrastructureModule,
    ...CONTEXT_MODULES,
    PortalModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes('{*path}');
  }
}
