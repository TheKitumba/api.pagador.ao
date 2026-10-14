import type { PayrollRunStatus } from '@prisma/client';

import { AggregateRoot } from '@/shared/domain/aggregate-root';
import { BusinessRuleViolation } from '@/shared/domain/errors';

export interface PayrollRunProps {
  id: string;
  status: PayrollRunStatus;
  calculatedBy: string | null;
  approvedBy: string | null;
}

/**
 * Payroll run lifecycle (docs/04, 4.9):
 * DRAFT → CALCULATED → REVIEW → APPROVED → PAID → CLOSED. An approved run is immutable; a closed
 * run is never reopened (corrections go to a supplementary run).
 */
export class PayrollRun extends AggregateRoot {
  private constructor(private props: PayrollRunProps) {
    super();
  }

  static restore(props: PayrollRunProps) {
    return new PayrollRun(props);
  }

  get snapshot(): Readonly<PayrollRunProps> {
    return this.props;
  }

  private require(allowed: PayrollRunStatus[], action: string) {
    if (!allowed.includes(this.props.status)) {
      throw new BusinessRuleViolation(`Não é possível ${action}: o processamento está "${this.props.status}"`, 'invalid_payroll_state');
    }
  }

  /** Inputs can change only before review; changing a calculated run invalidates the calculation. */
  assertInputsEditable() {
    this.require(['DRAFT', 'CALCULATED'], 'alterar lançamentos');
    if (this.props.status === 'CALCULATED') this.props.status = 'DRAFT';
  }

  assertCalculable() {
    this.require(['DRAFT', 'CALCULATED'], 'calcular');
  }

  markCalculated(userId: string) {
    this.assertCalculable();
    this.props.status = 'CALCULATED';
    this.props.calculatedBy = userId;
    this.record('payroll_run.calculated', { runId: this.props.id });
  }

  submit(blockingAlerts: number) {
    this.require(['CALCULATED'], 'submeter para aprovação');
    if (blockingAlerts > 0) throw new BusinessRuleViolation(`Resolva ${blockingAlerts} alertas bloqueantes antes de submeter`, 'blocking_alerts');
    this.props.status = 'REVIEW';
  }

  approve(userId: string) {
    this.require(['REVIEW'], 'aprovar');
    this.props.status = 'APPROVED';
    this.props.approvedBy = userId;
    this.record('payroll_run.approved', { runId: this.props.id });
  }

  returnToCalculated() {
    this.require(['REVIEW'], 'devolver');
    this.props.status = 'CALCULATED';
  }

  markPaid() {
    this.require(['APPROVED'], 'marcar como paga');
    this.props.status = 'PAID';
    this.record('payroll_run.paid', { runId: this.props.id });
  }

  close() {
    this.require(['PAID'], 'fechar');
    this.props.status = 'CLOSED';
    this.record('payroll_run.closed', { runId: this.props.id });
  }
}
