import type { ContractType, EmployeeStatus } from '@prisma/client';

import { ValidationError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { Iban, Nif, PhoneNumber } from '@/shared/domain/value-objects';

/** Default probation by contract type, in days (docs/02, 2.2.1 — parametrisable). */
export const DEFAULT_PROBATION_DAYS: Partial<Record<ContractType, number>> = {
  INDEFINITE: 60,
  FIXED_TERM: 30,
  UNCERTAIN_TERM: 30,
  PART_TIME: 30,
};

/** Maximum renewals of fixed-term contracts before conversion to indefinite (parametrisable). */
export const MAX_FIXED_TERM_RENEWALS = 3;

export interface HireInput {
  fullName: string;
  birthDate?: string;
  gender?: 'FEMALE' | 'MALE';
  idDocumentNumber?: string;
  nif?: string;
  socialSecurityNumber?: string;
  phone?: string;
  email?: string;
  province?: string;
  municipality?: string;
  address?: string;
  hireDate: string;
  positionId?: string;
  orgUnitId?: string;
  establishmentId?: string;
  managerId?: string;
  contract: { type: ContractType; endDate?: string; baseSalary: number | string; weeklyHours?: number; probationDays?: number };
  bank?: { bankCode: string; iban: string };
}

/** Validates the identity and payment data of a new hire (docs/03, M02; docs/10 "Novo trabalhador"). */
export function validateHire(input: HireInput) {
  const errors: Record<string, string[]> = {};
  const attempt = <T>(field: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof ValidationError) errors[field] = Object.values(error.fieldErrors).flat();
      return undefined;
    }
  };

  const nif = input.nif ? attempt('nif', () => Nif.personal(input.nif!).value) : undefined;
  const idDocument = input.idDocumentNumber ? attempt('idDocumentNumber', () => Nif.personal(input.idDocumentNumber!).value) : undefined;
  const phone = input.phone ? attempt('phone', () => PhoneNumber.create(input.phone!).value) : undefined;
  const iban = input.bank ? attempt('bank.iban', () => Iban.create(input.bank!.iban).value) : undefined;
  const salary = Money.of(input.contract.baseSalary);
  if (!salary.greaterThan(0)) errors['contract.baseSalary'] = ['O vencimento deve ser superior a zero'];
  if (['FIXED_TERM', 'TEMPORARY', 'INTERNSHIP'].includes(input.contract.type) && !input.contract.endDate) {
    errors['contract.endDate'] = ['Contratos a termo exigem data de fim'];
  }
  if (input.contract.endDate && input.contract.endDate <= input.hireDate) errors['contract.endDate'] = ['A data de fim tem de ser posterior à admissão'];
  if (!input.email && !phone) errors.email = ['Indique o e-mail ou o telemóvel (para o portal)'];

  if (Object.keys(errors).length) throw new ValidationError('Dados de admissão inválidos', errors, 'invalid_hire');
  return { nif, idDocument, phone, iban, salary };
}

export function initialStatus(probationEndDate: Date | null, hireDate: Date): EmployeeStatus {
  return probationEndDate && probationEndDate > hireDate ? 'PROBATION' : 'ACTIVE';
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}
