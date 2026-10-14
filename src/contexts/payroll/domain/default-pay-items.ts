import type { PayItemCategory, PayItemKind, PayItemNature } from '@prisma/client';

export interface DefaultPayItem {
  code: string;
  name: string;
  kind: PayItemKind;
  nature: PayItemNature;
  category: PayItemCategory;
  irtSubject?: boolean;
  irtExemptionLimit?: number;
  ssSubject?: boolean;
  holidayAllowance?: boolean;
  christmasAllowance?: boolean;
  proportional?: boolean;
  order: number;
}

/** Pre-configured pay items (docs/04, 4.3). Values are defaults, editable per company. */
export const DEFAULT_PAY_ITEMS: DefaultPayItem[] = [
  { code: 'R001', name: 'Vencimento base', kind: 'EARNING', nature: 'FIXED', category: 'SALARY', holidayAllowance: true, christmasAllowance: true, proportional: true, order: 10 },
  { code: 'R010', name: 'Subsídio de alimentação', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', irtExemptionLimit: 30_000, order: 20 },
  { code: 'R011', name: 'Subsídio de transporte', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', irtExemptionLimit: 30_000, order: 21 },
  { code: 'R012', name: 'Subsídio de habitação', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', order: 22 },
  { code: 'R013', name: 'Subsídio de turno', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', order: 23 },
  { code: 'R014', name: 'Subsídio de isolamento', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', order: 24 },
  { code: 'R015', name: 'Subsídio de risco', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', order: 25 },
  { code: 'R016', name: 'Subsídio de chefia/função', kind: 'EARNING', nature: 'FIXED', category: 'ALLOWANCE', holidayAllowance: true, christmasAllowance: true, order: 26 },
  { code: 'R017', name: 'Subsídio de comunicações', kind: 'EARNING', nature: 'FIXED', category: 'BENEFIT', order: 27 },
  { code: 'R018', name: 'Abono de família', kind: 'EARNING', nature: 'FIXED', category: 'BENEFIT', ssSubject: false, order: 28 },
  { code: 'R020', name: 'Horas extra — dia útil', kind: 'EARNING', nature: 'CALCULATED', category: 'OVERTIME', order: 40 },
  { code: 'R021', name: 'Horas extra — descanso/feriado', kind: 'EARNING', nature: 'CALCULATED', category: 'OVERTIME', order: 41 },
  { code: 'R022', name: 'Trabalho nocturno', kind: 'EARNING', nature: 'CALCULATED', category: 'OVERTIME', order: 42 },
  { code: 'R030', name: 'Subsídio de férias', kind: 'EARNING', nature: 'CALCULATED', category: 'STATUTORY', order: 50 },
  { code: 'R031', name: 'Subsídio de Natal', kind: 'EARNING', nature: 'CALCULATED', category: 'STATUTORY', order: 51 },
  { code: 'R040', name: 'Prémio de desempenho', kind: 'EARNING', nature: 'VARIABLE', category: 'BONUS', order: 60 },
  { code: 'R041', name: 'Comissões', kind: 'EARNING', nature: 'VARIABLE', category: 'BONUS', order: 61 },
  { code: 'R050', name: 'Ajudas de custo', kind: 'EARNING', nature: 'VARIABLE', category: 'ALLOWANCE', ssSubject: false, order: 70 },
  { code: 'R051', name: 'Reembolso de despesas', kind: 'EARNING', nature: 'VARIABLE', category: 'OTHER', irtSubject: false, ssSubject: false, order: 71 },
  { code: 'R060', name: 'Indemnização por cessação', kind: 'EARNING', nature: 'VARIABLE', category: 'OTHER', ssSubject: false, order: 80 },
  { code: 'R070', name: 'Retroactivos', kind: 'EARNING', nature: 'VARIABLE', category: 'SALARY', order: 90 },
  { code: 'D001', name: 'Segurança Social — trabalhador (3%)', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'STATUTORY', order: 200 },
  { code: 'D002', name: 'IRT — retenção na fonte', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'STATUTORY', order: 201 },
  { code: 'D010', name: 'Faltas injustificadas', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'ABSENCE', order: 150 },
  { code: 'D011', name: 'Atrasos', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'ABSENCE', order: 151 },
  { code: 'D012', name: 'Licença sem vencimento', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'ABSENCE', order: 152 },
  { code: 'D020', name: 'Adiantamento salarial', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'LOAN', order: 220 },
  { code: 'D021', name: 'Prestação de empréstimo', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'LOAN', order: 221 },
  { code: 'D030', name: 'Penhora judicial', kind: 'DEDUCTION', nature: 'CALCULATED', category: 'LOAN', order: 210 },
  { code: 'D031', name: 'Quota sindical', kind: 'DEDUCTION', nature: 'VARIABLE', category: 'OTHER', order: 230 },
  { code: 'D040', name: 'Comparticipação do seguro de saúde', kind: 'DEDUCTION', nature: 'VARIABLE', category: 'INSURANCE', order: 231 },
  { code: 'D050', name: 'Outros descontos autorizados', kind: 'DEDUCTION', nature: 'VARIABLE', category: 'OTHER', order: 240 },
  { code: 'E001', name: 'Segurança Social — entidade empregadora (8%)', kind: 'EMPLOYER_CHARGE', nature: 'CALCULATED', category: 'STATUTORY', order: 300 },
  { code: 'E010', name: 'Seguro de acidentes de trabalho', kind: 'EMPLOYER_CHARGE', nature: 'VARIABLE', category: 'INSURANCE', order: 301 },
  { code: 'E011', name: 'Seguro de saúde — parte da empresa', kind: 'EMPLOYER_CHARGE', nature: 'VARIABLE', category: 'INSURANCE', order: 302 },
];
