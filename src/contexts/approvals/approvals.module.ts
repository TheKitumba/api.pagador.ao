import { Global, Module } from '@nestjs/common';

import { ApprovalWorkflowsService, DecideApprovalUseCase, ListApprovalsQuery } from './application/approvals.use-cases';
import { ApprovalRequestRepository } from './infrastructure/approval-request.repository';
import { ApprovalsController } from './presentation/approvals.controller';
import { ApprovalOutcomeRegistry, Approvals, ApprovalsProvisioning } from './public';

/** Global so every context can open approval requests and register outcome handlers. */
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalRequestRepository, ApprovalOutcomeRegistry, Approvals, ApprovalsProvisioning, DecideApprovalUseCase, ListApprovalsQuery, ApprovalWorkflowsService],
  exports: [ApprovalOutcomeRegistry, Approvals, ApprovalsProvisioning],
})
export class ApprovalsModule {}
