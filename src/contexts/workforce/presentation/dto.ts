import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { paginationSchema } from '@/shared/application/pagination';
import { dateOnly, moneyInput } from '@/shared/presentation/zod';

export const contractType = z.enum(['INDEFINITE', 'FIXED_TERM', 'UNCERTAIN_TERM', 'PART_TIME', 'INTERNSHIP', 'TEMPORARY', 'NON_RESIDENT']);
const employeeStatus = z.enum(['ACTIVE', 'PROBATION', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED']);

export class HireEmployeeDto extends createZodDto(
  z.object({
    fullName: z.string().trim().min(3),
    birthDate: dateOnly.optional(),
    gender: z.enum(['FEMALE', 'MALE']).optional(),
    idDocumentNumber: z.string().optional().describe('N.º do BI (9 dígitos, 2 letras, 3 dígitos)'),
    nif: z.string().optional().describe('Para pessoas singulares é igual ao n.º do BI'),
    socialSecurityNumber: z.string().optional(),
    phone: z.string().optional().describe('+244 9XX XXX XXX'),
    email: z.email().optional(),
    province: z.string().optional(),
    municipality: z.string().optional(),
    address: z.string().optional(),
    hireDate: dateOnly,
    positionId: z.uuid().optional(),
    orgUnitId: z.uuid().optional(),
    establishmentId: z.uuid().optional(),
    managerId: z.uuid().optional(),
    contract: z.object({
      type: contractType,
      endDate: dateOnly.optional().describe('Obrigatória nos contratos a termo'),
      baseSalary: moneyInput,
      weeklyHours: z.number().min(1).max(60).optional().describe('44 por omissão'),
      probationDays: z.number().int().min(0).max(180).optional(),
    }),
    bank: z.object({ bankCode: z.string(), iban: z.string().describe('AO06 + 21 dígitos (validado com mod-97)') }).optional(),
  }),
) {}

export class UpdateEmployeeDto extends createZodDto(
  z
    .object({
      fullName: z.string().trim().min(3),
      gender: z.enum(['FEMALE', 'MALE']).nullable(),
      birthDate: dateOnly.nullable(),
      maritalStatus: z.string().nullable(),
      idDocumentNumber: z.string().nullable(),
      idDocumentExpiry: dateOnly.nullable(),
      nif: z.string().nullable(),
      socialSecurityNumber: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.email().nullable(),
      province: z.string().nullable(),
      municipality: z.string().nullable(),
      address: z.string().nullable(),
      positionId: z.uuid().nullable(),
      orgUnitId: z.uuid().nullable(),
      establishmentId: z.uuid().nullable(),
      costCenterId: z.uuid().nullable(),
      managerId: z.uuid().nullable(),
      scheduleId: z.uuid().nullable(),
      dependents: z.number().int().min(0).max(20),
      status: employeeStatus,
    })
    .partial(),
) {}

export class ListEmployeesDto extends createZodDto(
  paginationSchema.extend({
    status: employeeStatus.optional(),
    orgUnitId: z.uuid().optional(),
    establishmentId: z.uuid().optional(),
    q: z.string().optional().describe('Pesquisa por nome, n.º, NIF ou e-mail'),
  }),
) {}

export class BankAccountDto extends createZodDto(z.object({ bankCode: z.string(), iban: z.string(), holderName: z.string().optional() })) {}

export class UploadDocumentDto extends createZodDto(z.object({ category: z.string().min(2).describe('Ex.: Bilhete de Identidade, Contrato, Certificado'), expiresAt: dateOnly.optional() })) {}

export class ImportQueryDto extends createZodDto(z.object({ dryRun: z.enum(['true', 'false']).default('true').describe('true = apenas validar') })) {}

export class CreateContractDto extends createZodDto(
  z.object({
    contractType,
    startDate: dateOnly,
    endDate: dateOnly.optional(),
    baseSalary: moneyInput,
    weeklyHours: z.number().min(1).max(60).optional(),
    positionId: z.uuid().optional(),
    probationDays: z.number().int().min(0).max(180).optional(),
    notes: z.string().optional(),
  }),
) {}

export class RenewContractDto extends createZodDto(z.object({ endDate: dateOnly, baseSalary: moneyInput.optional(), notes: z.string().optional() })) {}
export class ConfirmProbationDto extends createZodDto(z.object({ rating: z.string().optional(), notes: z.string().optional() })) {}
export class NonRenewalDto extends createZodDto(z.object({ reason: z.string().min(3), noticeDate: dateOnly.optional() })) {}
export class ContractAlertsDto extends createZodDto(z.object({ days: z.coerce.number().int().min(1).max(365).default(45) })) {}

export const terminationReason = z.enum(['CONTRACT_EXPIRY', 'EMPLOYEE_RESIGNATION', 'DISCIPLINARY_DISMISSAL', 'OBJECTIVE_DISMISSAL', 'MUTUAL_AGREEMENT', 'RETIREMENT', 'DEATH']);
export class StartTerminationDto extends createZodDto(z.object({ employeeId: z.uuid(), reason: terminationReason, noticeDate: dateOnly, lastDay: dateOnly, notes: z.string().optional() })) {}

export class CreateInvoiceDto extends createZodDto(
  z.object({
    supplier: z.string().min(2),
    supplierNif: z.string().optional(),
    number: z.string().min(1),
    description: z.string().optional(),
    dueDate: dateOnly,
    amount: moneyInput,
    withholding: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .default(true)
      .transform((value) => value === true || value === 'true')
      .describe('Aplicar retenção na fonte (IRT Grupo B)'),
  }),
) {}
export class InvoiceStatusQuery extends createZodDto(z.object({ status: z.enum(['PENDING', 'APPROVED', 'PAID', 'REJECTED']).optional() })) {}
