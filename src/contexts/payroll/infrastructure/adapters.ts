import { Injectable } from '@nestjs/common';

import { AttendanceFacade } from '@/contexts/time/public';
import { EmployeeDirectory } from '@/contexts/workforce/public';

import { type AttendanceForPay, AttendanceSummaryPort, type EmploymentSnapshot, EmploymentSnapshotPort } from '../application/ports';

@Injectable()
export class EmploymentSnapshotAdapter extends EmploymentSnapshotPort {
  constructor(private readonly directory: EmployeeDirectory) {
    super();
  }

  async forPeriod(companyId: string, start: Date, end: Date): Promise<EmploymentSnapshot[]> {
    const employees = await this.directory.payrollPopulation(companyId, start, end);
    return employees
      .filter((employee) => employee.contract)
      .map((employee) => ({
        employeeId: employee.id,
        name: employee.name,
        number: employee.number,
        hireDate: employee.hireDate,
        dependents: employee.dependents,
        nif: employee.nif,
        socialSecurityNumber: employee.socialSecurityNumber,
        contract: employee.contract!,
        fixedPayItems: employee.fixedPayItems,
        bankAccount: employee.bankAccount,
      }));
  }
}

@Injectable()
export class AttendanceSummaryAdapter extends AttendanceSummaryPort {
  constructor(private readonly attendance: AttendanceFacade) {
    super();
  }

  isClosed(companyId: string, year: number, month: number) {
    return this.attendance.isPeriodClosed(companyId, year, month);
  }

  async forEmployees(employeeIds: string[], year: number, month: number): Promise<Map<string, AttendanceForPay>> {
    return this.attendance.summaries(employeeIds, year, month);
  }
}
