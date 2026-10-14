import { Injectable } from '@nestjs/common';

import { Nif } from '@/shared/domain/value-objects';
import { Database } from '@/shared/infrastructure/prisma/database';

import { SIZE_FROM_LABEL } from '../application/organization.service';

/** Public facade used by identity-access during account registration. */
@Injectable()
export class CompanyProvisioning {
  constructor(private readonly db: Database) {}

  async createCompany(input: { legalName: string; nif: string; size: string; province: string }) {
    const slug = input.legalName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const company = await this.db.tx.company.create({
      data: {
        tenantId: this.db.tenantId,
        legalName: input.legalName,
        tradeName: input.legalName.replace(/,?\s*(lda|s\.a|sa)\.?$/i, ''),
        nif: Nif.company(input.nif).value,
        sizeClass: SIZE_FROM_LABEL[input.size] ?? 'SMALL',
        province: input.province,
        careersSlug: `${slug}-${Math.random().toString(36).slice(2, 6)}`,
      },
    });
    await this.db.tx.establishment.create({ data: { tenantId: company.tenantId, companyId: company.id, name: `Sede — ${input.province}`, province: input.province } });
    return company.id;
  }
}
