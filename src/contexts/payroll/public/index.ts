import { Injectable } from '@nestjs/common';

import { NotFoundError } from '@/shared/domain/errors';
import { Decimal } from '@/shared/domain/money';
import { Database } from '@/shared/infrastructure/prisma/database';

import { DEFAULT_PAY_ITEMS } from '../domain/default-pay-items';
import { PayrollRun } from '../domain/payroll-run';

/** Creates the default pay items for a new company (docs/04, 4.3). */
@Injectable()
export class PayrollProvisioning {
  constructor(private readonly db: Database) {}

  async provisionCompany(companyId: string) {
    await this.db.tx.payItem.createMany({
      data: DEFAULT_PAY_ITEMS.map((item) => ({
        tenantId: this.db.tenantId,
        companyId,
        code: item.code,
        name: item.name,
        kind: item.kind,
        nature: item.nature,
        category: item.category,
        irtSubject: item.kind === 'EARNING' ? (item.irtSubject ?? true) : false,
        irtExemptionLimit: item.irtExemptionLimit,
        ssSubject: item.kind === 'EARNING' ? (item.ssSubject ?? true) : false,
        holidayAllowance: item.holidayAllowance ?? false,
        christmasAllowance: item.christmasAllowance ?? false,
        proportional: item.proportional ?? false,
        calculationOrder: item.order,
      })),
      skipDuplicates: true,
    });
  }
}

/** Outstanding loans and advances (workforce uses it for final settlements). */
@Injectable()
export class LoanBalances {
  constructor(private readonly db: Database) {}

  async outstanding(employeeId: string) {
    const loans = await this.db.tx.loan.aggregate({ where: { employeeId, status: 'ACTIVE', type: { in: ['ADVANCE', 'LOAN'] } }, _sum: { balance: true } });
    return (loans._sum.balance ?? new Decimal(0)).toFixed(2);
  }
}

export interface PayableSlip {
  payslipId: string;
  employeeId: string;
  employeeName: string;
  net: string;
  bankCode: string | null;
  iban: string | null;
}

/** Facade for payments and tax-compliance: what an approved run pays and withholds. */
@Injectable()
export class PayrollRunsFacade {
  constructor(private readonly db: Database) {}

  async payable(runId: string): Promise<{ run: { id: string; status: string; year: number; month: number; companyId: string }; slips: PayableSlip[] }> {
    const run = await this.db.tx.payrollRun.findUnique({ where: { id: runId }, include: { period: true, payslips: { select: { id: true, employeeId: true, net: true } } } });
    if (!run) throw new NotFoundError('Processamento', runId);
    const employees = await this.db.tx.employee.findMany({
      where: { id: { in: run.payslips.map((slip) => slip.employeeId) } },
      select: { id: true, fullName: true, bankAccounts: { where: { isPrimary: true }, take: 1 } },
    });
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    return {
      run: { id: run.id, status: run.status, year: run.period.year, month: run.period.month, companyId: run.companyId },
      slips: run.payslips.map((slip) => {
        const employee = byId.get(slip.employeeId);
        return { payslipId: slip.id, employeeId: slip.employeeId, employeeName: employee?.fullName ?? '', net: slip.net.toFixed(2), bankCode: employee?.bankAccounts[0]?.bankCode ?? null, iban: employee?.bankAccounts[0]?.iban ?? null };
      }),
    };
  }

  /** Marks the run as paid when every payment batch is reconciled. */
  async markPaid(runId: string) {
    const run = await this.db.tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const aggregate = PayrollRun.restore({ id: run.id, status: run.status, calculatedBy: run.calculatedBy, approvedBy: run.approvedBy });
    if (run.status !== 'APPROVED') return;
    aggregate.markPaid();
    await this.db.tx.payrollRun.update({ where: { id: runId }, data: { status: aggregate.snapshot.status, paidAt: new Date() } });
  }

  /** Per-employee withholding and SS for the month's approved runs (IRT map and INSS remuneration file). */
  async monthlyWithholdings(companyId: string, year: number, month: number) {
    const payslips = await this.db.tx.payslip.findMany({
      where: { run: { companyId, period: { year, month }, status: { in: ['APPROVED', 'PAID', 'CLOSED'] } } },
      select: { employeeId: true, gross: true, ssBase: true, ssEmployee: true, ssEmployer: true, irtBase: true, irt: true },
    });
    const employees = await this.db.tx.employee.findMany({ where: { id: { in: payslips.map((p) => p.employeeId) } }, select: { id: true, fullName: true, nif: true, socialSecurityNumber: true } });
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    return payslips.map((payslip) => {
      const employee = byId.get(payslip.employeeId);
      return {
        employeeId: payslip.employeeId,
        name: employee?.fullName ?? '',
        nif: employee?.nif ?? null,
        socialSecurityNumber: employee?.socialSecurityNumber ?? null,
        gross: payslip.gross.toFixed(2),
        ssBase: payslip.ssBase.toFixed(2),
        ssEmployee: payslip.ssEmployee.toFixed(2),
        ssEmployer: payslip.ssEmployer.toFixed(2),
        irtBase: payslip.irtBase.toFixed(2),
        irt: payslip.irt.toFixed(2),
      };
    });
  }
}
