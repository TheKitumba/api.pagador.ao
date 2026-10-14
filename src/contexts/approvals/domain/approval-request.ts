import type { ApprovalType, RequestStatus, Role } from '@prisma/client';

import type { Actor } from '@/shared/application/permissions';
import { AggregateRoot } from '@/shared/domain/aggregate-root';
import { BusinessRuleViolation, ForbiddenError, ValidationError } from '@/shared/domain/errors';

/**
 * Who decides a step: a role. LINE_MANAGER means the beneficiary's direct manager
 * (or an HR manager when the beneficiary has none).
 */
export type Approver = Role;

export interface ApprovalStep {
  approver: Approver;
  label: string;
  slaHours?: number;
}

export const APPROVER_LABEL: Record<Approver, string> = {
  LINE_MANAGER: 'Chefia directa',
  ACCOUNT_ADMIN: 'Direcção / administrador',
  HR_MANAGER: 'Gestor de RH',
  HR_TECHNICIAN: 'Técnico de RH',
  PAYROLL_PROCESSOR: 'Processador salarial',
  FINANCIAL_APPROVER: 'Aprovador financeiro',
  RECRUITER: 'Recrutador',
  EMPLOYEE: 'Trabalhador',
  AUDITOR: 'Auditor',
};

/** Default flows (docs/05, 5.5). */
export const DEFAULT_WORKFLOWS: Record<ApprovalType, Approver[]> = {
  LEAVE: ['LINE_MANAGER', 'HR_TECHNICIAN'],
  ATTENDANCE_CORRECTION: ['LINE_MANAGER'],
  OVERTIME: ['LINE_MANAGER'],
  ADVANCE: ['LINE_MANAGER', 'HR_MANAGER', 'FINANCIAL_APPROVER'],
  LOAN: ['HR_MANAGER', 'FINANCIAL_APPROVER'],
  EXPENSE: ['LINE_MANAGER', 'FINANCIAL_APPROVER'],
  SALARY_CHANGE: ['LINE_MANAGER', 'HR_MANAGER', 'ACCOUNT_ADMIN'],
  PAYROLL_RUN: ['FINANCIAL_APPROVER'],
  PAYMENT_BATCH: ['FINANCIAL_APPROVER'],
  TERMINATION: ['HR_MANAGER', 'ACCOUNT_ADMIN'],
  TIMESHEET: ['LINE_MANAGER'],
};

export interface DecisionContext {
  /** The beneficiary's manager (employee id), when the request has a beneficiary. */
  beneficiaryManagerId: string | null;
  /** When no other user holds the step role, the only holder may decide (docs/05, 5.4 rule 5). */
  segregationWaivable: boolean;
}

export type Decision = 'APPROVED' | 'REJECTED' | 'RETURNED';

export interface ApprovalRequestProps {
  id: string;
  type: ApprovalType;
  subjectId: string;
  title: string;
  requesterUserId: string | null;
  beneficiaryId: string | null;
  beneficiaryManagerId: string | null;
  excludedUserIds: string[];
  steps: ApprovalStep[];
  currentStep: number;
  status: RequestStatus;
}

/** Multi-step approval with segregation of duties (docs/05, 5.4). */
export class ApprovalRequest extends AggregateRoot {
  private constructor(private props: ApprovalRequestProps) {
    super();
  }

  static restore(props: ApprovalRequestProps) {
    return new ApprovalRequest(props);
  }

  get snapshot(): Readonly<ApprovalRequestProps> {
    return this.props;
  }

  get step(): ApprovalStep | undefined {
    return this.props.steps[this.props.currentStep];
  }

  /** Whether the actor is the expected approver of the current step (ignores segregation). */
  isApproverOfCurrentStep(actor: Actor, context: Pick<DecisionContext, 'beneficiaryManagerId'>) {
    const step = this.step;
    if (!step || this.props.status !== 'PENDING') return false;
    if (step.approver === 'LINE_MANAGER') {
      if (context.beneficiaryManagerId) return actor.employeeId === context.beneficiaryManagerId;
      return actor.roles.includes('HR_MANAGER');
    }
    return actor.roles.includes(step.approver);
  }

  /** Users that may never decide: requester, beneficiary and explicit exclusions (e.g. who calculated the payroll). */
  isConflicted(actor: Actor) {
    return (
      actor.userId === this.props.requesterUserId ||
      (this.props.beneficiaryId !== null && actor.employeeId === this.props.beneficiaryId) ||
      this.props.excludedUserIds.includes(actor.userId)
    );
  }

  canDecide(actor: Actor, context: DecisionContext) {
    return this.isApproverOfCurrentStep(actor, context) && (!this.isConflicted(actor) || context.segregationWaivable);
  }

  decide(actor: Actor, decision: Decision, context: DecisionContext, reason?: string): { finished: boolean; segregationWaived: boolean } {
    if (this.props.status !== 'PENDING') throw new BusinessRuleViolation('Este pedido já foi decidido', 'already_decided');
    if (!this.isApproverOfCurrentStep(actor, context)) throw new ForbiddenError('Não é o aprovador deste passo', 'not_step_approver');
    const conflicted = this.isConflicted(actor);
    if (conflicted && !context.segregationWaivable) {
      throw new ForbiddenError('Segregação de funções: não pode decidir um pedido que criou, que o beneficia ou que preparou', 'segregation_of_duties');
    }
    if (decision !== 'APPROVED' && !reason?.trim()) throw new ValidationError('Indique o motivo', { reason: ['Obrigatório'] }, 'reason_required');

    if (decision === 'APPROVED') {
      const isLast = this.props.currentStep >= this.props.steps.length - 1;
      if (isLast) this.props.status = 'APPROVED';
      else this.props.currentStep += 1;
      this.record(isLast ? 'approval.approved' : 'approval.step_approved', { requestId: this.props.id, type: this.props.type, subjectId: this.props.subjectId });
      return { finished: isLast, segregationWaived: conflicted };
    }

    this.props.status = decision === 'REJECTED' ? 'REJECTED' : 'RETURNED';
    this.record(decision === 'REJECTED' ? 'approval.rejected' : 'approval.returned', { requestId: this.props.id, type: this.props.type, subjectId: this.props.subjectId, reason });
    return { finished: true, segregationWaived: conflicted };
  }
}
