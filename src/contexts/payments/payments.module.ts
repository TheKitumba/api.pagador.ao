import { Module } from '@nestjs/common';

import { GeneratePaymentBatchesUseCase, PaymentBatchesService, PaymentBatchOutcomeHandler } from './application/payments.use-cases';
import { PaymentsController } from './presentation/payments.controller';

@Module({
  controllers: [PaymentsController],
  providers: [GeneratePaymentBatchesUseCase, PaymentBatchOutcomeHandler, PaymentBatchesService],
})
export class PaymentsModule {}
