import { Controller, Get, Module } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PayslipsService } from '@/contexts/payroll/application/payslips.service';
import { LeaveBalances } from '@/contexts/time/public';
import { EmployeeDirectory } from '@/contexts/workforce/public';
import { ForbiddenError } from '@/shared/domain/errors';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate } from '@/shared/application/formatting';

/**
 * Worker self-service (docs/03 M18). Not a bounded context: a presentation surface that combines
 * other contexts' facades with the worker's own permissions (docs/09, 9.4.1).
 */
@ApiTags('Portal')
@ApiCookieAuth()
@Controller('me')
export class PortalController {
  constructor(
    private readonly actors: ActorContext,
    private readonly db: Database,
    private readonly employees: EmployeeDirectory,
    private readonly leave: LeaveBalances,
    private readonly payslips: PayslipsService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Início do portal', description: 'Próximo pagamento, último líquido, saldo de férias e dados do trabalhador ligado à conta.' })
  async summary() {
    const actor = this.actors.current;
    if (!actor.employeeId) throw new ForbiddenError('A sua conta não está ligada a um trabalhador', 'no_employee_link');
    const today = new Date();
    const [employee, vacationDays, payslips, period, balance] = await Promise.all([
      this.employees.get(actor.employeeId),
      this.leave.remainingDays(actor.employeeId, today.getUTCFullYear()),
      this.payslips.mine(),
      this.db.tx.payrollPeriod.findFirst({ where: { companyId: actor.companyId, paymentDate: { gte: new Date(today.toISOString().slice(0, 10)) } }, orderBy: { paymentDate: 'asc' } }),
      this.db.tx.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: actor.employeeId, year: today.getUTCFullYear() } } }),
    ]);
    return {
      employee: { id: employee.id, name: employee.name, number: employee.number, email: employee.email, phone: employee.phone },
      nextPaymentDate: period ? isoDate(period.paymentDate) : null,
      lastPayslip: payslips[0] ?? null,
      vacation: { availableDays: Math.max(0, vacationDays - (balance?.scheduled ?? 0)), scheduledDays: balance?.scheduled ?? 0 },
    };
  }
}

@Module({ controllers: [PortalController] })
export class PortalModule {}
