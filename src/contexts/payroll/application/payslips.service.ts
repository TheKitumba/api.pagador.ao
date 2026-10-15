import { Injectable } from '@nestjs/common';

import { authorize, can } from '@/shared/application/permissions';
import { Mailer } from '@/shared/application/ports';
import { BusinessRuleViolation, ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { AppConfig } from '@/shared/infrastructure/config/app-config';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate } from '@/shared/application/formatting';

import { renderPayslipPdf } from '../infrastructure/payslip-pdf';
import { runName } from './payroll-runs.use-cases';

@Injectable()
export class PayslipsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** HR/payroll see every payslip; an employee sees only their own (docs/05, 5.3 "Recibos"). */
  private async load(id: string) {
    const actor = this.actors.current;
    const payslip = await this.db.tx.payslip.findUnique({ where: { id }, include: { lines: true, run: { include: { period: true } } } });
    if (!payslip) throw new NotFoundError('Recibo', id);
    if (payslip.employeeId !== actor.employeeId) authorize(actor, 'payroll.read');
    return payslip;
  }

  async listForRun(runId: string, q?: string) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.read');
    const payslips = await this.db.tx.payslip.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    const employees = await this.db.tx.employee.findMany({ where: { id: { in: payslips.map((p) => p.employeeId) } }, select: { id: true, fullName: true, employeeNumber: true, positionId: true } });
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const query = q?.toLowerCase();
    return payslips
      .map((payslip) => {
        const employee = byId.get(payslip.employeeId);
        const alerts = (payslip.alerts as { severity: string; message: string }[] | null) ?? [];
        return {
          id: payslip.id,
          employee: { id: payslip.employeeId, name: employee?.fullName ?? null, number: employee?.employeeNumber ?? null },
          gross: decimal(payslip.gross),
          ssEmployee: decimal(payslip.ssEmployee),
          irt: decimal(payslip.irt),
          totalDeductions: decimal(payslip.totalDeductions),
          net: decimal(payslip.net),
          employerCost: decimal(payslip.employerCost),
          status: alerts.some((alert) => alert.severity === 'blocking') ? 'blocking' : alerts.some((alert) => alert.severity === 'warning') ? 'warning' : 'ok',
          issue: alerts.find((alert) => alert.severity !== 'info')?.message ?? null,
          sentAt: payslip.sentAt,
        };
      })
      .filter((row) => !query || row.employee.name?.toLowerCase().includes(query) || row.employee.number?.includes(query));
  }

  async get(id: string) {
    const payslip = await this.load(id);
    const employee = await this.db.tx.employee.findUnique({ where: { id: payslip.employeeId }, select: { fullName: true, employeeNumber: true, nif: true, socialSecurityNumber: true } });
    return {
      id: payslip.id,
      run: { id: payslip.runId, name: runName(payslip.run.runType, payslip.run.period.year, payslip.run.period.month), status: payslip.run.status },
      employee: { id: payslip.employeeId, name: employee?.fullName, number: employee?.employeeNumber, nif: employee?.nif, socialSecurityNumber: employee?.socialSecurityNumber },
      gross: decimal(payslip.gross),
      ssBase: decimal(payslip.ssBase),
      ssEmployee: decimal(payslip.ssEmployee),
      ssEmployer: decimal(payslip.ssEmployer),
      irtTaxable: decimal(payslip.irtTaxable),
      irtBase: decimal(payslip.irtBase),
      irt: decimal(payslip.irt),
      totalDeductions: decimal(payslip.totalDeductions),
      net: decimal(payslip.net),
      employerCost: decimal(payslip.employerCost),
      alerts: payslip.alerts,
      trace: payslip.calculationTrace,
      lines: payslip.lines.map((line) => ({
        code: line.code,
        description: line.description,
        kind: line.kind,
        quantity: line.quantity?.toString() ?? null,
        amount: decimal(line.amount),
        taxableAmount: decimal(line.taxableAmount),
        ssAmount: decimal(line.ssAmount),
        source: line.source,
        trace: line.trace,
      })),
    };
  }

  async pdf(id: string) {
    const payslip = await this.load(id);
    const [employee, company] = await Promise.all([
      this.db.tx.employee.findUniqueOrThrow({ where: { id: payslip.employeeId } }),
      this.db.tx.company.findUniqueOrThrow({ where: { id: payslip.run.companyId } }),
    ]);
    const position = employee.positionId ? await this.db.tx.jobPosition.findUnique({ where: { id: employee.positionId }, select: { title: true } }) : null;
    const snapshot = (payslip.run.legalTablesSnapshot ?? {}) as Record<string, string | null>;
    const period = runName(payslip.run.runType, payslip.run.period.year, payslip.run.period.month);
    const buffer = await renderPayslipPdf({
      company: { name: company.legalName, nif: company.nif },
      employee: { name: employee.fullName, number: employee.employeeNumber, nif: employee.nif, socialSecurityNumber: employee.socialSecurityNumber, position: position?.title ?? null },
      period,
      paymentDate: isoDate(payslip.run.period.paymentDate),
      lines: payslip.lines.filter((line) => line.kind !== 'EMPLOYER_CHARGE').map((line) => ({ code: line.code, description: line.description, quantity: line.quantity?.toString() ?? null, amount: line.amount.toFixed(2), kind: line.kind })),
      totals: { gross: payslip.gross.toFixed(2), ssEmployee: payslip.ssEmployee.toFixed(2), irt: payslip.irt.toFixed(2), totalDeductions: payslip.totalDeductions.toFixed(2), net: payslip.net.toFixed(2) },
      legalTables: Object.values(snapshot).filter(Boolean).join(', '),
    });
    return { buffer, fileName: `recibo-${employee.employeeNumber}-${payslip.run.period.year}-${String(payslip.run.period.month).padStart(2, '0')}.pdf`, employee, company };
  }

  /** Sends the payslip PDF by e-mail. Only for approved (or later) runs. */
  async send(id: string) {
    const actor = this.actors.current;
    if (!can(actor, 'payroll.read')) throw new ForbiddenError();
    const payslip = await this.load(id);
    if (!['APPROVED', 'PAID', 'CLOSED'].includes(payslip.run.status)) throw new BusinessRuleViolation('Só pode enviar recibos de folhas aprovadas', 'run_not_approved');
    const { buffer, fileName, employee, company } = await this.pdf(id);
    if (!employee.email) throw new BusinessRuleViolation('O trabalhador não tem e-mail. O recibo está disponível no portal.', 'no_email');
    const period = runName(payslip.run.runType, payslip.run.period.year, payslip.run.period.month);
    const paymentDate = payslip.run.period.paymentDate?.toLocaleDateString('pt-AO', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) ?? null;
    await this.mailer.send({
      to: employee.email,
      subject: `Recibo de vencimento — ${period}`,
      template: 'payslip',
      data: { name: employee.fullName, companyName: company.tradeName, period, paymentDate, portalUrl: `${this.config.env.APP_URL}/me/payslips` },
      attachments: [{ filename: fileName, content: buffer, contentType: 'application/pdf' }],
    });
    await this.db.tx.payslip.update({ where: { id }, data: { sentAt: new Date() } });
    await this.audit.record({ action: 'payslip.send', entityType: 'payslip', entityId: id, after: { to: employee.email } });
    return { id, sentTo: employee.email };
  }

  /** The current user's own payslips (portal). */
  async mine() {
    const actor = this.actors.current;
    if (!actor.employeeId) throw new ForbiddenError('A sua conta não está ligada a um trabalhador', 'no_employee_link');
    const payslips = await this.db.tx.payslip.findMany({
      where: { employeeId: actor.employeeId, run: { status: { in: ['APPROVED', 'PAID', 'CLOSED'] } } },
      include: { run: { include: { period: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return payslips.map((payslip) => ({
      id: payslip.id,
      name: runName(payslip.run.runType, payslip.run.period.year, payslip.run.period.month),
      year: payslip.run.period.year,
      month: payslip.run.period.month,
      paymentDate: isoDate(payslip.run.period.paymentDate),
      gross: decimal(payslip.gross),
      net: decimal(payslip.net),
    }));
  }
}
