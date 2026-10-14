import { Module } from '@nestjs/common';

import { GenerateTaxFilingsUseCase, TaxFilingsService } from './application/tax-filings.use-cases';
import { TaxFilingsController } from './presentation/tax-filings.controller';

@Module({
  controllers: [TaxFilingsController],
  providers: [GenerateTaxFilingsUseCase, TaxFilingsService],
  exports: [TaxFilingsService],
})
export class TaxComplianceModule {}
