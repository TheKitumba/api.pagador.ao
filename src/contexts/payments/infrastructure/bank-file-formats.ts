/**
 * Bank file layouts (docs/07, 7.1). One adapter per format; banks map to a format in the `banks`
 * table. Layouts are simplified and must be validated against each bank's current specification.
 */

export interface BankFileInput {
  reference: string;
  company: { name: string; nif: string; iban?: string };
  paymentDate: string;
  instructions: { employeeName: string; iban: string; amount: string; reference: string }[];
}

export interface BankFileFormat {
  code: string;
  extension: string;
  contentType: string;
  render(input: BankFileInput): string;
}

const pad = (value: string, length: number, char = ' ', left = false) => {
  const clean = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().slice(0, length);
  return left ? clean.padStart(length, char) : clean.padEnd(length, char);
};
const cents = (amount: string) => Math.round(Number(amount) * 100).toString();

/** Fixed-width layout (header, detail lines, trailer). */
const fixedWidth: BankFileFormat = {
  code: 'PS2',
  extension: 'txt',
  contentType: 'text/plain; charset=utf-8',
  render: (input) => {
    const total = input.instructions.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2);
    const header = `H${pad(input.company.nif, 14)}${pad(input.company.name, 40)}${input.paymentDate.replace(/-/g, '')}${pad(input.reference, 30)}`;
    const lines = input.instructions.map((item, index) => `D${String(index + 1).padStart(6, '0')}${pad(item.iban, 25)}${pad(item.employeeName, 40)}${pad(cents(item.amount), 15, '0', true)}${pad(item.reference, 20)}`);
    const trailer = `T${String(input.instructions.length).padStart(6, '0')}${pad(cents(total), 18, '0', true)}`;
    return [header, ...lines, trailer].join('\r\n') + '\r\n';
  },
};

/** Semicolon CSV layout. */
const csv: BankFileFormat = {
  code: 'CSV',
  extension: 'csv',
  contentType: 'text/csv; charset=utf-8',
  render: (input) =>
    [
      'iban;beneficiario;valor;referencia;data_valor',
      ...input.instructions.map((item) => [item.iban, item.employeeName, item.amount, item.reference, input.paymentDate].join(';')),
    ].join('\n') + '\n',
};

export const BANK_FILE_FORMATS: Record<string, BankFileFormat> = { PS2: fixedWidth, CSV: csv };

export function formatFor(code: string) {
  return BANK_FILE_FORMATS[code] ?? csv;
}
