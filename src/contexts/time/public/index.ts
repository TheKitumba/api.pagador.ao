import { Injectable } from '@nestjs/common';

import { Database } from '@/shared/infrastructure/prisma/database';

import { countWorkingDays, monthRange } from '../domain/calendar';
import { TimeSupport } from '../application/time-support';

export interface AttendanceSummary {
  employeeId: string;
  unjustifiedAbsenceDays: number;
  unpaidLeaveDays: number;
  /** Approved overtime hours by kind. */
  overtimeHours: { WEEKDAY: number; REST_DAY: number; HOLIDAY: number; NIGHT: number };
}

/** Public facade: leave balances (workforce, for final settlements). */
@Injectable()
export class LeaveBalances {
  constructor(private readonly db: Database) {}

  async remainingDays(employeeId: string, year: number) {
    const balance = await this.db.tx.leaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } });
    return balance ? Math.max(0, balance.entitledDays + balance.carriedOver - balance.taken) : 0;
  }
}

/** Public facade for payroll: what the month's attendance means for pay (AttendanceSummaryPort). */
@Injectable()
export class AttendanceFacade {
  constructor(
    private readonly db: Database,
    private readonly support: TimeSupport,
  ) {}

  async isPeriodClosed(companyId: string, year: number, month: number) {
    const period = await this.db.tx.attendancePeriod.findUnique({ where: { companyId_year_month: { companyId, year, month } } });
    return Boolean(period?.closedAt);
  }

  async summaries(employeeIds: string[], year: number, month: number): Promise<Map<string, AttendanceSummary>> {
    const { start, end } = monthRange(year, month);
    const holidays = await this.support.holidays(year);
    const [leave, overtime] = await Promise.all([
      this.db.tx.leaveRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'APPROVED', type: { in: ['UNJUSTIFIED', 'UNPAID'] }, startDate: { lte: end }, endDate: { gte: start } } }),
      this.db.tx.overtimeRequest.findMany({ where: { employeeId: { in: employeeIds }, status: 'APPROVED', date: { gte: start, lte: end } } }),
    ]);
    const result = new Map<string, AttendanceSummary>();
    for (const id of employeeIds) result.set(id, { employeeId: id, unjustifiedAbsenceDays: 0, unpaidLeaveDays: 0, overtimeHours: { WEEKDAY: 0, REST_DAY: 0, HOLIDAY: 0, NIGHT: 0 } });

    for (const item of leave) {
      const from = item.startDate < start ? start : item.startDate;
      const to = item.endDate > end ? end : item.endDate;
      const days = countWorkingDays(from, to, holidays);
      const summary = result.get(item.employeeId)!;
      if (item.type === 'UNJUSTIFIED') summary.unjustifiedAbsenceDays += days;
      else summary.unpaidLeaveDays += days;
    }
    for (const item of overtime) result.get(item.employeeId)!.overtimeHours[item.kind] += item.minutes / 60;
    return result;
  }
}
