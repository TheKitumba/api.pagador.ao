import { Injectable } from '@nestjs/common';

import { NotFoundError } from '@/shared/domain/errors';
import { Database } from '@/shared/infrastructure/prisma/database';

export interface EmployeeSummary {
  id: string;
  name: string;
  number: string;
  email: string | null;
  phone: string | null;
  managerId: string | null;
  companyId: string;
  status: string;
  establishmentId: string | null;
}

export interface PayrollEmployee {
  id: string;
  name: string;
  number: string;
  hireDate: Date;
  status: string;
  dependents: number;
  nif: string | null;
  socialSecurityNumber: string | null;
  contract: { id: string; baseSalary: string; weeklyHours: string; startDate: Date; endDate: Date | null; terminationDate: Date | null; paymentMethod: string } | null;
  fixedPayItems: { payItemId: string; amount: string }[];
  bankAccount: { bankCode: string; iban: string } | null;
}

/** Public facade of the workforce context. Other contexts never read its tables for writes. */
@Injectable()
export class EmployeeDirectory {
  constructor(private readonly db: Database) {}

  async get(id: string): Promise<EmployeeSummary> {
    const employee = await this.db.tx.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundError('Trabalhador', id);
    return {
      id: employee.id,
      name: employee.fullName,
      number: employee.employeeNumber,
      email: employee.email,
      phone: employee.phone,
      managerId: employee.managerId,
      companyId: employee.companyId,
      status: employee.status,
      establishmentId: employee.establishmentId,
    };
  }

  async names(ids: string[]) {
    const rows = await this.db.tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  /** Employees with a contract overlapping the period, with what the payroll needs (EmploymentSnapshotPort). */
  async payrollPopulation(companyId: string, periodStart: Date, periodEnd: Date): Promise<PayrollEmployee[]> {
    const overlaps = {
      startDate: { lte: periodEnd },
      AND: [{ OR: [{ endDate: null }, { endDate: { gte: periodStart } }] }, { OR: [{ terminationDate: null }, { terminationDate: { gte: periodStart } }] }],
    };
    const employees = await this.db.tx.employee.findMany({
      where: { companyId, hireDate: { lte: periodEnd }, contracts: { some: overlaps } },
      include: {
        contracts: { where: overlaps, orderBy: { startDate: 'desc' }, take: 1, include: { payItems: true } },
        bankAccounts: { where: { isPrimary: true }, take: 1 },
      },
      orderBy: { employeeNumber: 'asc' },
    });
    return employees.map((employee) => {
      const contract = employee.contracts[0];
      return {
        id: employee.id,
        name: employee.fullName,
        number: employee.employeeNumber,
        hireDate: employee.hireDate,
        status: employee.status,
        dependents: employee.dependents,
        nif: employee.nif,
        socialSecurityNumber: employee.socialSecurityNumber,
        contract: contract
          ? { id: contract.id, baseSalary: contract.baseSalary.toString(), weeklyHours: contract.weeklyHours.toString(), startDate: contract.startDate, endDate: contract.endDate, terminationDate: contract.terminationDate, paymentMethod: contract.paymentMethod }
          : null,
        fixedPayItems: contract ? contract.payItems.map((item) => ({ payItemId: item.payItemId, amount: item.amount.toString() })) : [],
        bankAccount: employee.bankAccounts[0] ? { bankCode: employee.bankAccounts[0].bankCode, iban: employee.bankAccounts[0].iban } : null,
      };
    });
  }

  /** Bank account changes in the last `days` (alert for payment approvers, docs/05 5.4 rule 4). */
  async recentIbanChanges(companyId: string, since: Date) {
    const rows = await this.db.tx.bankAccount.findMany({ where: { isPrimary: true, changedAt: { gte: since }, employee: { companyId } }, include: { employee: { select: { fullName: true } } } });
    return rows.map((row) => ({ employeeId: row.employeeId, name: row.employee.fullName, changedAt: row.changedAt }));
  }
}
