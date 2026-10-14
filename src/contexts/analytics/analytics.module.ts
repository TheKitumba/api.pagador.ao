import { Module } from '@nestjs/common';

import { TaxComplianceModule } from '../tax-compliance/tax-compliance.module';
import { AnalyticsService } from './application/analytics.service';
import { AnalyticsController } from './presentation/analytics.controller';

@Module({
  imports: [TaxComplianceModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
