import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ClsModule } from 'nestjs-cls';

import { CONTEXT_MODULES } from '@/contexts';
import { SharedInfrastructureModule } from '@/shared/infrastructure/shared-infrastructure.module';

import { NotificationProjector } from './notification-projector';
import { DailyAlertsProcessor, JobSchedules, OutboxRelayProcessor, PayrollCalculationProcessor } from './processors';

/** The background worker: same contexts as the API, no HTTP (docs/09, 9.8). */
@Module({
  imports: [ClsModule.forRoot({ global: true }), JwtModule.register({ global: true }), SharedInfrastructureModule, ...CONTEXT_MODULES],
  providers: [NotificationProjector, JobSchedules, OutboxRelayProcessor, PayrollCalculationProcessor, DailyAlertsProcessor],
})
export class WorkerModule {}
