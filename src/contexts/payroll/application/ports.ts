/**
 * What the payroll needs from other contexts, in the payroll's own model (anti-corruption layer,
 * docs/09 9.4.2). Implemented in infrastructure with the other contexts' public facades.
 */

export interface EmploymentSnapshot {
  employeeId: string;
  name: string;
  number: string;
  hireDate: Date;
  dependents: number;
  nif: string | null;
  socialSecurityNumber: string | null;
  contract: { id: string; baseSalary: string; weeklyHours: string; startDate: Date; endDate: Date | null; terminationDate: Date | null; paymentMethod: string };
  fixedPayItems: { payItemId: string; amount: string }[];
  bankAccount: { bankCode: string; iban: string } | null;
}

export abstract class EmploymentSnapshotPort {
  abstract forPeriod(companyId: string, start: Date, end: Date): Promise<EmploymentSnapshot[]>;
}

export interface AttendanceForPay {
  unjustifiedAbsenceDays: number;
  unpaidLeaveDays: number;
  overtimeHours: { WEEKDAY: number; REST_DAY: number; HOLIDAY: number; NIGHT: number };
}

export abstract class AttendanceSummaryPort {
  abstract isClosed(companyId: string, year: number, month: number): Promise<boolean>;
  abstract forEmployees(employeeIds: string[], year: number, month: number): Promise<Map<string, AttendanceForPay>>;
}
