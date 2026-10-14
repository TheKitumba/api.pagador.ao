import { Injectable } from '@nestjs/common';
import type { CompanySize, OrgUnitKind } from '@prisma/client';

import { authorize } from '@/shared/application/permissions';
import { NotFoundError } from '@/shared/domain/errors';
import { Nif } from '@/shared/domain/value-objects';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';

export const SIZE_FROM_LABEL: Record<string, CompanySize> = {
  '1–10 trabalhadores': 'MICRO',
  '11–50 trabalhadores': 'SMALL',
  '51–250 trabalhadores': 'MEDIUM',
  'Mais de 250 trabalhadores': 'LARGE',
};

/** Company profile, establishments, units, cost centers and positions (M01, M24). */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  private get actor() {
    return this.actors.current;
  }

  // Company -------------------------------------------------------------------

  async getCompany() {
    authorize(this.actor, 'organization.read');
    const company = await this.db.tx.company.findUnique({ where: { id: this.actor.companyId } });
    if (!company) throw new NotFoundError('Empresa');
    return company;
  }

  async updateCompany(input: { legalName?: string; tradeName?: string; nif?: string; socialSecurityNumber?: string | null; activityCode?: string | null; province?: string | null; address?: string | null; careersSlug?: string | null }) {
    authorize(this.actor, 'settings.write');
    const before = await this.getCompany();
    const updated = await this.db.tx.company.update({
      where: { id: before.id },
      data: { ...input, ...(input.nif ? { nif: Nif.company(input.nif).value } : {}) },
    });
    await this.audit.record({ action: 'company.update', entityType: 'company', entityId: before.id, before, after: updated });
    return updated;
  }

  // Establishments ------------------------------------------------------------

  listEstablishments() {
    authorize(this.actor, 'organization.read');
    return this.db.tx.establishment.findMany({ where: { companyId: this.actor.companyId, archivedAt: null }, orderBy: { name: 'asc' } });
  }

  async createEstablishment(input: { name: string; province?: string; address?: string; latitude?: number; longitude?: number; geoPunch?: boolean }) {
    authorize(this.actor, 'organization.write');
    const created = await this.db.tx.establishment.create({ data: { ...input, tenantId: this.actor.tenantId, companyId: this.actor.companyId } });
    await this.audit.record({ action: 'establishment.create', entityType: 'establishment', entityId: created.id, after: created });
    return created;
  }

  async updateEstablishment(id: string, input: Partial<{ name: string; province: string; address: string; latitude: number; longitude: number; geoPunch: boolean }>) {
    authorize(this.actor, 'organization.write');
    const before = await this.findOrFail('establishment', id);
    const updated = await this.db.tx.establishment.update({ where: { id }, data: input });
    await this.audit.record({ action: 'establishment.update', entityType: 'establishment', entityId: id, before, after: updated });
    return updated;
  }

  async archiveEstablishment(id: string) {
    authorize(this.actor, 'organization.write');
    await this.findOrFail('establishment', id);
    await this.db.tx.establishment.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.record({ action: 'establishment.archive', entityType: 'establishment', entityId: id });
  }

  // Org units -----------------------------------------------------------------

  async listOrgUnits() {
    authorize(this.actor, 'organization.read');
    const [units, headcounts] = await Promise.all([
      this.db.tx.orgUnit.findMany({ where: { companyId: this.actor.companyId, archivedAt: null }, orderBy: { name: 'asc' } }),
      this.db.tx.employee.groupBy({ by: ['orgUnitId'], where: { companyId: this.actor.companyId, status: { not: 'TERMINATED' } }, _count: true }),
    ]);
    const counts = new Map(headcounts.map((row) => [row.orgUnitId, row._count]));
    return units.map((unit) => ({ ...unit, headcount: counts.get(unit.id) ?? 0 }));
  }

  async createOrgUnit(input: { name: string; kind?: OrgUnitKind; parentId?: string; headEmployeeId?: string; costCenterId?: string }) {
    authorize(this.actor, 'organization.write');
    const created = await this.db.tx.orgUnit.create({ data: { ...input, tenantId: this.actor.tenantId, companyId: this.actor.companyId } });
    await this.audit.record({ action: 'org_unit.create', entityType: 'org_unit', entityId: created.id, after: created });
    return created;
  }

  async updateOrgUnit(id: string, input: Partial<{ name: string; kind: OrgUnitKind; parentId: string | null; headEmployeeId: string | null; costCenterId: string | null }>) {
    authorize(this.actor, 'organization.write');
    const before = await this.findOrFail('orgUnit', id);
    const updated = await this.db.tx.orgUnit.update({ where: { id }, data: input });
    await this.audit.record({ action: 'org_unit.update', entityType: 'org_unit', entityId: id, before, after: updated });
    return updated;
  }

  async archiveOrgUnit(id: string) {
    authorize(this.actor, 'organization.write');
    await this.findOrFail('orgUnit', id);
    await this.db.tx.orgUnit.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.record({ action: 'org_unit.archive', entityType: 'org_unit', entityId: id });
  }

  // Cost centers --------------------------------------------------------------

  listCostCenters() {
    authorize(this.actor, 'organization.read');
    return this.db.tx.costCenter.findMany({ where: { companyId: this.actor.companyId, archivedAt: null }, orderBy: { code: 'asc' } });
  }

  async createCostCenter(input: { code: string; name: string }) {
    authorize(this.actor, 'organization.write');
    const created = await this.db.tx.costCenter.create({ data: { ...input, tenantId: this.actor.tenantId, companyId: this.actor.companyId } });
    await this.audit.record({ action: 'cost_center.create', entityType: 'cost_center', entityId: created.id, after: created });
    return created;
  }

  async updateCostCenter(id: string, input: Partial<{ code: string; name: string }>) {
    authorize(this.actor, 'organization.write');
    await this.findOrFail('costCenter', id);
    return this.db.tx.costCenter.update({ where: { id }, data: input });
  }

  async archiveCostCenter(id: string) {
    authorize(this.actor, 'organization.write');
    await this.findOrFail('costCenter', id);
    await this.db.tx.costCenter.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  // Positions -----------------------------------------------------------------

  async listPositions() {
    authorize(this.actor, 'organization.read');
    const [positions, occupied] = await Promise.all([
      this.db.tx.jobPosition.findMany({ where: { companyId: this.actor.companyId, archivedAt: null }, orderBy: { title: 'asc' } }),
      this.db.tx.employee.groupBy({ by: ['positionId'], where: { companyId: this.actor.companyId, status: { not: 'TERMINATED' } }, _count: true }),
    ]);
    const counts = new Map(occupied.map((row) => [row.positionId, row._count]));
    return positions.map((position) => ({ ...position, occupied: counts.get(position.id) ?? 0 }));
  }

  async createPosition(input: { title: string; orgUnitId?: string; grade?: string }) {
    authorize(this.actor, 'organization.write');
    const created = await this.db.tx.jobPosition.create({ data: { ...input, tenantId: this.actor.tenantId, companyId: this.actor.companyId } });
    await this.audit.record({ action: 'position.create', entityType: 'position', entityId: created.id, after: created });
    return created;
  }

  async updatePosition(id: string, input: Partial<{ title: string; orgUnitId: string | null; grade: string | null }>) {
    authorize(this.actor, 'organization.write');
    await this.findOrFail('jobPosition', id);
    return this.db.tx.jobPosition.update({ where: { id }, data: input });
  }

  async archivePosition(id: string) {
    authorize(this.actor, 'organization.write');
    await this.findOrFail('jobPosition', id);
    await this.db.tx.jobPosition.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  // Reference data ------------------------------------------------------------

  async referenceData() {
    const [banks, provinces] = await Promise.all([this.db.tx.bank.findMany({ orderBy: { name: 'asc' } }), this.db.tx.province.findMany({ orderBy: { name: 'asc' } })]);
    return { banks, provinces };
  }

  private async findOrFail(model: 'establishment' | 'orgUnit' | 'costCenter' | 'jobPosition', id: string) {
    const delegate = this.db.tx[model] as unknown as { findFirst(args: object): Promise<object | null> };
    const row = await delegate.findFirst({ where: { id, companyId: this.actor.companyId } });
    if (!row) throw new NotFoundError('Registo', id);
    return row;
  }
}
