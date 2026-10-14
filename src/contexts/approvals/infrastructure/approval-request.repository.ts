import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { NotFoundError } from '@/shared/domain/errors';
import { Database } from '@/shared/infrastructure/prisma/database';

import { ApprovalRequest, type ApprovalStep } from '../domain/approval-request';

@Injectable()
export class ApprovalRequestRepository {
  constructor(private readonly db: Database) {}

  async get(id: string) {
    const row = await this.db.tx.approvalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Pedido de aprovação', id);
    return ApprovalRequest.restore({
      id: row.id,
      type: row.type,
      subjectId: row.subjectId,
      title: row.title,
      requesterUserId: row.requesterUserId,
      beneficiaryId: row.beneficiaryId,
      beneficiaryManagerId: row.beneficiaryManagerId,
      excludedUserIds: row.excludedUserIds,
      steps: row.steps as unknown as ApprovalStep[],
      currentStep: row.currentStep,
      status: row.status,
    });
  }

  async save(request: ApprovalRequest) {
    const { id, currentStep, status } = request.snapshot;
    await this.db.tx.approvalRequest.update({
      where: { id },
      data: { currentStep, status, decidedAt: status === 'PENDING' ? null : new Date() },
    });
  }

  async addAction(data: Omit<Prisma.ApprovalActionUncheckedCreateInput, 'tenantId'>) {
    await this.db.tx.approvalAction.create({ data: { ...data, tenantId: this.db.tenantId } });
  }
}
