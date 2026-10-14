import { Injectable } from '@nestjs/common';
import type { EmployeeStatus, Prisma } from '@prisma/client';

import { type Actor, authorize, can } from '@/shared/application/permissions';
import { type Pagination, pageArgs, toPage } from '@/shared/application/pagination';
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { Iban, Nif, PhoneNumber } from '@/shared/domain/value-objects';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

import { addDays, DEFAULT_PROBATION_DAYS, type HireInput, initialStatus, validateHire } from '../domain/employee';

/** Data scope (docs/05, 5.1): HR sees the company; a line manager sees the team. */
export function employeeScope(actor: Actor): Prisma.EmployeeWhereInput {
  if (can(actor, 'employees.read')) return { companyId: actor.companyId };
  if (can(actor, 'team.read') && actor.employeeId) return { companyId: actor.companyId, managerId: actor.employeeId };
  throw new ForbiddenError('Sem acesso a dados de trabalhadores', 'missing_permission');
}

@Injectable()
export class HireEmployeeUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async execute(input: HireInput) {
    const actor = this.actors.current;
    authorize(actor, 'employees.write');
    const { nif, idDocument, phone, iban, salary } = validateHire(input);
    const tx = this.db.tx;

    const count = await tx.employee.count({ where: { companyId: actor.companyId } });
    const hireDate = toDate(input.hireDate);
    const probationDays = input.contract.probationDays ?? DEFAULT_PROBATION_DAYS[input.contract.type] ?? 0;
    const probationEndDate = probationDays > 0 ? addDays(hireDate, probationDays) : null;

    const employee = await tx.employee.create({
      data: {
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        employeeNumber: String(count + 1).padStart(4, '0'),
        fullName: input.fullName.trim(),
        gender: input.gender,
        birthDate: input.birthDate ? toDate(input.birthDate) : null,
        idDocumentNumber: idDocument,
        nif: nif ?? idDocument,
        socialSecurityNumber: input.socialSecurityNumber,
        phone,
        email: input.email?.trim().toLowerCase(),
        province: input.province,
        municipality: input.municipality,
        address: input.address,
        hireDate,
        seniorityDate: hireDate,
        status: initialStatus(probationEndDate, hireDate),
        positionId: input.positionId,
        orgUnitId: input.orgUnitId,
        establishmentId: input.establishmentId,
        managerId: input.managerId,
        contracts: {
          create: {
            tenantId: actor.tenantId,
            contractType: input.contract.type,
            startDate: hireDate,
            endDate: input.contract.endDate ? toDate(input.contract.endDate) : null,
            probationEndDate,
            positionId: input.positionId,
            baseSalary: salary.toString(),
            weeklyHours: input.contract.weeklyHours ?? 44,
          },
        },
        ...(input.bank && iban
          ? { bankAccounts: { create: { tenantId: actor.tenantId, bankCode: input.bank.bankCode, iban, holderName: input.fullName.trim(), validatedAt: new Date() } } }
          : {}),
      },
    });

    await tx.leaveBalance.create({ data: { tenantId: actor.tenantId, employeeId: employee.id, year: hireDate.getUTCFullYear(), entitledDays: 22 } }).catch(() => undefined);
    await this.outbox.publish('employee.created', { employeeId: employee.id, name: employee.fullName });
    await this.audit.record({ action: 'employee.hire', entityType: 'employee', entityId: employee.id, after: { name: employee.fullName, contract: input.contract.type }, sensitive: true });
    return { id: employee.id, employeeNumber: employee.employeeNumber };
  }
}

export interface UpdateEmployeeInput {
  fullName?: string;
  gender?: 'FEMALE' | 'MALE' | null;
  birthDate?: string | null;
  maritalStatus?: string | null;
  idDocumentNumber?: string | null;
  idDocumentExpiry?: string | null;
  nif?: string | null;
  socialSecurityNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  province?: string | null;
  municipality?: string | null;
  address?: string | null;
  positionId?: string | null;
  orgUnitId?: string | null;
  establishmentId?: string | null;
  costCenterId?: string | null;
  managerId?: string | null;
  scheduleId?: string | null;
  dependents?: number;
  status?: EmployeeStatus;
}

@Injectable()
export class UpdateEmployeeUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async execute(id: string, input: UpdateEmployeeInput) {
    const actor = this.actors.current;
    authorize(actor, 'employees.write');
    const before = await this.db.tx.employee.findFirst({ where: { id, companyId: actor.companyId } });
    if (!before) throw new NotFoundError('Trabalhador', id);
    if (input.managerId === id) throw new ValidationError('Um trabalhador não pode ser a sua própria chefia', { managerId: ['Inválido'] });

    const data: Prisma.EmployeeUncheckedUpdateInput = {
      ...input,
      birthDate: input.birthDate === undefined ? undefined : input.birthDate ? toDate(input.birthDate) : null,
      idDocumentExpiry: input.idDocumentExpiry === undefined ? undefined : input.idDocumentExpiry ? toDate(input.idDocumentExpiry) : null,
      nif: input.nif ? Nif.personal(input.nif).value : input.nif,
      idDocumentNumber: input.idDocumentNumber ? Nif.personal(input.idDocumentNumber).value : input.idDocumentNumber,
      phone: input.phone ? PhoneNumber.create(input.phone).value : input.phone,
      email: input.email?.trim().toLowerCase() ?? input.email,
    };
    const updated = await this.db.tx.employee.update({ where: { id }, data });
    await this.outbox.publish('employee.updated', { employeeId: id });
    await this.audit.record({ action: 'employee.update', entityType: 'employee', entityId: id, before, after: updated });
    return updated;
  }
}

/** IBAN changes are sensitive: audited, and flagged to the approver if close to payday (docs/05, 5.4 rule 4). */
@Injectable()
export class ChangeBankAccountUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async execute(employeeId: string, input: { bankCode: string; iban: string; holderName?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'employees.sensitive');
    const employee = await this.db.tx.employee.findFirst({ where: { id: employeeId, companyId: actor.companyId }, include: { bankAccounts: { where: { isPrimary: true } } } });
    if (!employee) throw new NotFoundError('Trabalhador', employeeId);
    const iban = Iban.create(input.iban);

    await this.db.tx.bankAccount.updateMany({ where: { employeeId, isPrimary: true }, data: { isPrimary: false } });
    const account = await this.db.tx.bankAccount.create({
      data: { tenantId: actor.tenantId, employeeId, bankCode: input.bankCode, iban: iban.value, holderName: input.holderName ?? employee.fullName, validatedAt: new Date() },
    });
    await this.outbox.publish('employee.iban_changed', { employeeId, name: employee.fullName });
    await this.audit.record({ action: 'employee.bank_account_change', entityType: 'employee', entityId: employeeId, before: { bank: employee.bankAccounts[0]?.bankCode }, after: { bank: input.bankCode }, sensitive: true });
    return { id: account.id, bankCode: account.bankCode, iban: iban.formatted };
  }
}

@Injectable()
export class EmployeeQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  async list(filter: Pagination & { status?: EmployeeStatus; orgUnitId?: string; establishmentId?: string; q?: string }) {
    const actor = this.actors.current;
    const where: Prisma.EmployeeWhereInput = {
      ...employeeScope(actor),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.orgUnitId ? { orgUnitId: filter.orgUnitId } : {}),
      ...(filter.establishmentId ? { establishmentId: filter.establishmentId } : {}),
      ...(filter.q
        ? {
            OR: [
              { fullName: { contains: filter.q, mode: 'insensitive' } },
              { employeeNumber: { contains: filter.q } },
              { nif: { contains: filter.q, mode: 'insensitive' } },
              { email: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.db.tx.employee.findMany({
      where,
      ...pageArgs(filter),
      include: { contracts: { where: { status: 'ACTIVE' }, orderBy: { startDate: 'desc' }, take: 1 } },
    });
    const page = toPage(rows, filter.limit);
    const lookups = await this.lookups(page.data);
    const showSalary = can(actor, 'employees.sensitive');

    return {
      nextCursor: page.nextCursor,
      data: page.data.map((employee) => ({
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        email: employee.email,
        phone: employee.phone,
        status: employee.status,
        hireDate: isoDate(employee.hireDate),
        position: employee.positionId ? (lookups.positions.get(employee.positionId) ?? null) : null,
        orgUnit: employee.orgUnitId ? (lookups.units.get(employee.orgUnitId) ?? null) : null,
        establishment: employee.establishmentId ? (lookups.sites.get(employee.establishmentId) ?? null) : null,
        contractType: employee.contracts[0]?.contractType ?? null,
        baseSalary: showSalary ? decimal(employee.contracts[0]?.baseSalary) : null,
      })),
    };
  }

  async get(id: string) {
    const actor = this.actors.current;
    const employee = await this.db.tx.employee.findFirst({
      where: { id, ...employeeScope(actor) },
      include: {
        contracts: { orderBy: { startDate: 'desc' }, include: { payItems: true } },
        bankAccounts: { where: { isPrimary: true } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!employee) throw new NotFoundError('Trabalhador', id);
    const lookups = await this.lookups([employee]);
    const manager = employee.managerId ? await this.db.tx.employee.findUnique({ where: { id: employee.managerId }, select: { id: true, fullName: true } }) : null;
    const sensitive = can(actor, 'employees.sensitive');
    const iban = employee.bankAccounts[0]?.iban;

    return {
      ...employee,
      birthDate: isoDate(employee.birthDate),
      hireDate: isoDate(employee.hireDate),
      seniorityDate: isoDate(employee.seniorityDate),
      idDocumentExpiry: isoDate(employee.idDocumentExpiry),
      position: employee.positionId ? (lookups.positions.get(employee.positionId) ?? null) : null,
      orgUnit: employee.orgUnitId ? (lookups.units.get(employee.orgUnitId) ?? null) : null,
      establishment: employee.establishmentId ? (lookups.sites.get(employee.establishmentId) ?? null) : null,
      manager: manager ? { id: manager.id, name: manager.fullName } : null,
      contracts: employee.contracts.map((contract) => ({
        id: contract.id,
        contractType: contract.contractType,
        status: contract.status,
        startDate: isoDate(contract.startDate),
        endDate: isoDate(contract.endDate),
        probationEndDate: isoDate(contract.probationEndDate),
        renewalsCount: contract.renewalsCount,
        weeklyHours: contract.weeklyHours.toString(),
        baseSalary: sensitive ? decimal(contract.baseSalary) : null,
        payItems: sensitive ? contract.payItems.map((item) => ({ payItemId: item.payItemId, amount: decimal(item.amount) })) : [],
      })),
      bankAccount: iban ? { bankCode: employee.bankAccounts[0].bankCode, iban: sensitive ? Iban.create(iban).formatted : `•••• ${iban.slice(-4)}` } : null,
      bankAccounts: undefined,
      documents: employee.documents.map((document) => ({ id: document.id, category: document.category, fileName: document.fileName, size: document.size, expiresAt: isoDate(document.expiresAt), createdAt: document.createdAt })),
    };
  }

  async exportRows() {
    const actor = this.actors.current;
    authorize(actor, 'employees.read');
    const rows = await this.db.tx.employee.findMany({ where: employeeScope(actor), orderBy: { employeeNumber: 'asc' } });
    const lookups = await this.lookups(rows);
    return rows.map((employee) => ({
      numero: employee.employeeNumber,
      nome: employee.fullName,
      nif: employee.nif ?? '',
      telemovel: employee.phone ?? '',
      email: employee.email ?? '',
      cargo: employee.positionId ? (lookups.positions.get(employee.positionId)?.title ?? '') : '',
      departamento: employee.orgUnitId ? (lookups.units.get(employee.orgUnitId)?.name ?? '') : '',
      admissao: isoDate(employee.hireDate) ?? '',
      estado: employee.status,
    }));
  }

  private async lookups(employees: { positionId: string | null; orgUnitId: string | null; establishmentId: string | null }[]) {
    const ids = (key: 'positionId' | 'orgUnitId' | 'establishmentId') => [...new Set(employees.map((e) => e[key]).filter((v): v is string => Boolean(v)))];
    const [positions, units, sites] = await Promise.all([
      this.db.tx.jobPosition.findMany({ where: { id: { in: ids('positionId') } }, select: { id: true, title: true } }),
      this.db.tx.orgUnit.findMany({ where: { id: { in: ids('orgUnitId') } }, select: { id: true, name: true } }),
      this.db.tx.establishment.findMany({ where: { id: { in: ids('establishmentId') } }, select: { id: true, name: true } }),
    ]);
    return {
      positions: new Map(positions.map((p) => [p.id, p])),
      units: new Map(units.map((u) => [u.id, u])),
      sites: new Map(sites.map((s) => [s.id, s])),
    };
  }
}
