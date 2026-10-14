import { Injectable } from '@nestjs/common';
import type { LegalTable, LegalTableKind } from '@prisma/client';

import { BusinessRuleViolation } from '@/shared/domain/errors';
import { Database } from '@/shared/infrastructure/prisma/database';

import type { IrtBracket, LegalParameters, OvertimeRates, SocialSecurityRates } from '../domain/calculation/legal-tables';

const MAX_DEDUCTIBLE_RATIO = 1 / 3;

/**
 * Loads the legal tables in force at a reference date. Tenant-specific versions take precedence
 * over global ones; the versions used are stored with each run so it can be reproduced.
 */
@Injectable()
export class LegalParametersProvider {
  constructor(private readonly db: Database) {}

  private async current(kind: LegalTableKind, at: Date): Promise<LegalTable | null> {
    return this.db.tx.legalTable.findFirst({
      where: { kind, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
      orderBy: [{ tenantId: { sort: 'desc', nulls: 'last' } }, { effectiveFrom: 'desc' }],
    });
  }

  async resolve(at: Date): Promise<{ parameters: LegalParameters; snapshot: Record<string, string | null> }> {
    const [irt, ss, overtime, minimumWage] = await Promise.all([
      this.current('IRT_GROUP_A', at),
      this.current('SOCIAL_SECURITY', at),
      this.current('OVERTIME_RATES', at),
      this.current('MINIMUM_WAGE', at),
    ]);
    if (!irt) throw new BusinessRuleViolation('Tabela legal de IRT inexistente para a data de referência', 'missing_irt_table');
    if (!ss) throw new BusinessRuleViolation('Tabela legal de Segurança Social inexistente para a data de referência', 'missing_ss_table');

    const overtimeData = (overtime?.data ?? {}) as Partial<OvertimeRates>;
    return {
      parameters: {
        irt: { version: irt.version, brackets: (irt.data as unknown as { brackets: IrtBracket[] }).brackets },
        socialSecurity: { version: ss.version, ...(ss.data as unknown as SocialSecurityRates) },
        overtime: {
          version: overtime?.version ?? 'por omissão',
          weekday: overtimeData.weekday ?? 1.5,
          restDay: overtimeData.restDay ?? 2,
          holiday: overtimeData.holiday ?? 2,
          night: overtimeData.night ?? 1.25,
          monthlyLimitHours: overtimeData.monthlyLimitHours ?? 30,
          annualLimitHours: overtimeData.annualLimitHours ?? 200,
        },
        minimumWage: minimumWage ? { version: minimumWage.version, amount: (minimumWage.data as { amount: number }).amount } : null,
        maxDeductibleRatio: MAX_DEDUCTIBLE_RATIO,
      },
      snapshot: { irt: irt.version, socialSecurity: ss.version, overtime: overtime?.version ?? null, minimumWage: minimumWage?.version ?? null },
    };
  }
}
