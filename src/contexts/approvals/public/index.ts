import { Injectable } from '@nestjs/common';
import type { ApprovalType, Prisma } from '@prisma/client';

import type { Actor } from '@/shared/application/permissions';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';

import { APPROVER_LABEL, type ApprovalStep, type Approver, DEFAULT_WORKFLOWS, type Decision } from '../domain/approval-request';

export type { Decision };

export interface ApprovalOutcome {
  type: ApprovalType;
  subjectId: string;
  decision: Decision;
  reason?: string;
  actor: Actor;
}

type OutcomeHandler = (outcome: ApprovalOutcome) => Promise<void>;

/**
 * Contexts register what happens to their subject when a request is finally approved, rejected
 * or returned. Handlers run in the same transaction as the decision.
 */
@Injectable()
export class ApprovalOutcomeRegistry {
  private readonly handlers = new Map<ApprovalType, OutcomeHandler>();

  register(type: ApprovalType, handler: OutcomeHandler) {
    this.handlers.set(type, handler);
  }

  async dispatch(outcome: ApprovalOutcome) {
    await this.handlers.get(outcome.type)?.(outcome);
  }
}

export interface StartApprovalInput {
  type: ApprovalType;
  subjectId: string;
  title: string;
  detail?: string;
  requesterUserId: string | null;
  beneficiary?: { employeeId: string; name: string; managerId: string | null } | null;
  /** Users that may not decide (segregation of duties), e.g. who calculated the payroll. */
  excludedUserIds?: string[];
}

/** Facade used by other contexts to open approval requests. */
@Injectable()
export class Approvals {
  constructor(
    private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async start(input: StartApprovalInput) {
    const workflow = await this.db.tx.approvalWorkflow.findUnique({ where: { tenantId_type: { tenantId: this.db.tenantId, type: input.type } } });
    const steps = (workflow?.steps as unknown as ApprovalStep[] | undefined) ?? toSteps(DEFAULT_WORKFLOWS[input.type]);
    const slaHours = steps[0]?.slaHours ?? 48;

    // A new request supersedes an open one for the same subject (e.g. resubmission after correction).
    await this.db.tx.approvalRequest.updateMany({ where: { type: input.type, subjectId: input.subjectId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });

    const request = await this.db.tx.approvalRequest.create({
      data: {
        tenantId: this.db.tenantId,
        type: input.type,
        subjectId: input.subjectId,
        title: input.title,
        detail: input.detail,
        requesterUserId: input.requesterUserId,
        beneficiaryId: input.beneficiary?.employeeId ?? null,
        beneficiaryName: input.beneficiary?.name ?? null,
        beneficiaryManagerId: input.beneficiary?.managerId ?? null,
        excludedUserIds: input.excludedUserIds ?? [],
        steps: steps as unknown as Prisma.InputJsonValue,
        dueAt: new Date(Date.now() + slaHours * 3_600_000),
      },
    });
    await this.outbox.publish('approval.requested', { requestId: request.id, type: input.type, title: input.title, approver: steps[0]?.approver, beneficiaryEmployeeId: input.beneficiary?.employeeId ?? null, beneficiaryManagerId: input.beneficiary?.managerId ?? null });
    return request.id;
  }

  async cancel(type: ApprovalType, subjectId: string) {
    await this.db.tx.approvalRequest.updateMany({ where: { type, subjectId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
  }
}

export function toSteps(approvers: Approver[], slaHours = 48): ApprovalStep[] {
  return approvers.map((approver) => ({ approver, label: APPROVER_LABEL[approver], slaHours }));
}

/** Creates the default workflows for a new tenant. */
@Injectable()
export class ApprovalsProvisioning {
  constructor(private readonly db: Database) {}

  async provisionTenant() {
    for (const [type, approvers] of Object.entries(DEFAULT_WORKFLOWS) as [ApprovalType, Approver[]][]) {
      await this.db.tx.approvalWorkflow.upsert({
        where: { tenantId_type: { tenantId: this.db.tenantId, type } },
        create: { tenantId: this.db.tenantId, type, steps: toSteps(approvers) as unknown as Prisma.InputJsonValue },
        update: {},
      });
    }
  }
}
