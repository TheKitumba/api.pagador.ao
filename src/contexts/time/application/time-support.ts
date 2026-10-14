import { Injectable } from '@nestjs/common';

import { type Actor, can } from '@/shared/application/permissions';
import { ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { EmployeeDirectory } from '@/contexts/workforce/public';
import { Database } from '@/shared/infrastructure/prisma/database';

import type { Holiday } from '../domain/calendar';

/** Shared helpers for the time context: holidays and "whose data may the actor touch". */
@Injectable()
export class TimeSupport {
  constructor(
    private readonly db: Database,
    private readonly employees: EmployeeDirectory,
  ) {}

  async holidays(year: number): Promise<Holiday[]> {
    const tables = await this.db.tx.legalTable.findMany({ where: { kind: 'HOLIDAYS' }, orderBy: { effectiveFrom: 'desc' } });
    const holidays = tables.flatMap((table) => ((table.data as { holidays?: Holiday[] }).holidays ?? []));
    return holidays.filter((holiday) => holiday.date.startsWith(String(year)) || holiday.date.startsWith(String(year + 1)));
  }

  /**
   * Resolves the employee a request is about: own data for everyone, the team for managers,
   * anyone in the company with the given permission.
   */
  async resolveEmployee(actor: Actor, employeeId: string | undefined, permission: 'leave.write' | 'overtime.write' | 'attendance.write') {
    const targetId = employeeId ?? actor.employeeId;
    if (!targetId) throw new ForbiddenError('A sua conta não está ligada a um trabalhador', 'no_employee_link');
    const employee = await this.employees.get(targetId);
    if (employee.companyId !== actor.companyId) throw new NotFoundError('Trabalhador', targetId);
    const own = targetId === actor.employeeId;
    const team = employee.managerId !== null && employee.managerId === actor.employeeId;
    if (!own && !team && !can(actor, permission)) throw new ForbiddenError('Só pode registar pedidos próprios ou da sua equipa', 'missing_permission');
    return employee;
  }
}
