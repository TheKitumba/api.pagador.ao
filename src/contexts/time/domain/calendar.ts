import { ValidationError } from '@/shared/domain/errors';

export interface Holiday {
  date: string;
  name: string;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Working days between two dates (inclusive), excluding weekends and public holidays. */
export function countWorkingDays(start: Date, end: Date, holidays: Holiday[]) {
  if (end < start) throw new ValidationError('A data de fim é anterior ao início', { endDate: ['Tem de ser igual ou posterior ao início'] });
  const holidaySet = new Set(holidays.map((holiday) => holiday.date));
  let days = 0;
  for (let day = new Date(start); day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidaySet.has(iso(day))) days += 1;
  }
  return days;
}

export function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end };
}

/** Leave types that need a balance, are paid, and count as justified (docs/02, 2.2.5–2.2.6). */
export const LEAVE_RULES = {
  VACATION: { usesBalance: true, paid: true, justified: true, label: 'Férias' },
  SICK: { usesBalance: false, paid: true, justified: true, label: 'Falta justificada — doença' },
  MARRIAGE: { usesBalance: false, paid: true, justified: true, label: 'Falta justificada — casamento' },
  BEREAVEMENT: { usesBalance: false, paid: true, justified: true, label: 'Falta justificada — luto' },
  MATERNITY: { usesBalance: false, paid: false, justified: true, label: 'Licença de maternidade' },
  PATERNITY: { usesBalance: false, paid: true, justified: true, label: 'Licença de paternidade' },
  UNPAID: { usesBalance: false, paid: false, justified: true, label: 'Licença sem vencimento' },
  UNJUSTIFIED: { usesBalance: false, paid: false, justified: false, label: 'Falta injustificada' },
  OTHER_JUSTIFIED: { usesBalance: false, paid: true, justified: true, label: 'Outra falta justificada' },
} as const;
