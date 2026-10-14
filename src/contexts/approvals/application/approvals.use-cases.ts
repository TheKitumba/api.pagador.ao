import { Injectable } from '@nestjs/common';
import type { ApprovalType, Prisma, Role } from '@prisma/client';

import { type Actor, authorize } from '@/shared/application/permissions';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';

import { ApprovalRequest, type ApprovalStep, type Decision, type DecisionContext } from '../domain/approval-request';
import { ApprovalRequestRepository } from '../infrastructure/approval-request.repository';
import { ApprovalOutcomeRegistry, toSteps } from '../public';

async function decisionContext(db: Database, request: ApprovalRequest, actor: Actor): Promise<DecisionContext> {
  const approver = request.step?.approver;
  let segregationWaivable = false;
  if (approver && approver !== 'LINE_MANAGER' && request.isConflicted(actor)) {
    const others = await db.tx.membership.count({ where: { tenantId: actor.tenantId, roles: { has: approver }, userId: { not: actor.userId } } });
    segregationWaivable = others === 0;
  }
  return { beneficiaryManagerId: request.snapshot.beneficiaryManagerId, segregationWaivable };
}

@Injectable()
export class DecideApprovalUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly repository: ApprovalRequestRepository,
    private readonly outcomes: ApprovalOutcomeRegistry,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async execute(id: string, decision: Decision, reason?: string) {
    const actor = this.actors.current;
    const request = await this.repository.get(id);
    const context = await decisionContext(this.db, request, actor);
    const stepIndex = request.snapshot.currentStep;
    const result = request.decide(actor, decision, context, reason);

    await this.repository.save(request);
    await this.repository.addAction({ requestId: id, step: stepIndex, actorUserId: actor.userId, decision, reason });
    await this.outbox.publishFrom(request);
    await this.audit.record({
      action: `approval.${decision.toLowerCase()}`,
      entityType: request.snapshot.type.toLowerCase(),
      entityId: request.snapshot.subjectId,
      after: { requestId: id, step: stepIndex, reason, segregationWaived: result.segregationWaived },
    });

    if (result.finished) {
      await this.outcomes.dispatch({ type: request.snapshot.type, subjectId: request.snapshot.subjectId, decision, reason, actor });
    }
    return { id, status: request.snapshot.status, currentStep: request.snapshot.currentStep, segregationWaived: result.segregationWaived };
  }
}

@Injectable()
export class ListApprovalsQuery {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  async execute(filter: { scope: 'pending' | 'mine' | 'history'; type?: ApprovalType }) {
    const actor = this.actors.current;
    const where: Prisma.ApprovalRequestWhereInput = { ...(filter.type ? { type: filter.type } : {}) };

    if (filter.scope === 'mine') where.requesterUserId = actor.userId;
    else if (filter.scope === 'history') where.actions = { some: { actorUserId: actor.userId } };
    else where.status = 'PENDING';

    const rows = await this.db.tx.approvalRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { actions: { orderBy: { createdAt: 'asc' } } } });

    const result = rows.map((row) => {
      const request = ApprovalRequest.restore({ ...row, steps: row.steps as unknown as ApprovalStep[] });
      const steps = row.steps as unknown as ApprovalStep[];
      return {
        id: row.id,
        type: row.type,
        subjectId: row.subjectId,
        title: row.title,
        detail: row.detail,
        status: row.status,
        beneficiary: row.beneficiaryId ? { id: row.beneficiaryId, name: row.beneficiaryName } : null,
        step: { index: row.currentStep, total: steps.length, label: steps[row.currentStep]?.label ?? null },
        dueAt: row.dueAt,
        overdue: row.status === 'PENDING' && row.dueAt !== null && row.dueAt < new Date(),
        createdAt: row.createdAt,
        canDecide: request.isApproverOfCurrentStep(actor, { beneficiaryManagerId: row.beneficiaryManagerId }) && !request.isConflicted(actor),
        actions: row.actions.map((action) => ({ step: action.step, decision: action.decision, reason: action.reason, at: action.createdAt })),
      };
    });

    return filter.scope === 'pending' ? result.filter((item) => item.canDecide) : result;
  }
}

@Injectable()
export class ApprovalWorkflowsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  list() {
    authorize(this.actors.current, 'settings.read');
    return this.db.tx.approvalWorkflow.findMany({ orderBy: { type: 'asc' } });
  }

  async update(type: ApprovalType, approvers: { approver: Role; slaHours?: number }[]) {
    authorize(this.actors.current, 'settings.write');
    const steps = approvers.map((step) => ({ ...toSteps([step.approver], step.slaHours ?? 48)[0] }));
    const before = await this.db.tx.approvalWorkflow.findUnique({ where: { tenantId_type: { tenantId: this.db.tenantId, type } } });
    const updated = await this.db.tx.approvalWorkflow.upsert({
      where: { tenantId_type: { tenantId: this.db.tenantId, type } },
      create: { tenantId: this.db.tenantId, type, steps: steps as unknown as Prisma.InputJsonValue },
      update: { steps: steps as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({ action: 'approval_workflow.update', entityType: 'approval_workflow', entityId: updated.id, before: before?.steps, after: steps });
    return updated;
  }
}
