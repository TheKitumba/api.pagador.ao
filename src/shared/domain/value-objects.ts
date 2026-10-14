import { ValidationError } from './errors';

/** Angolan personal NIF / BI number: 9 digits, 2 letters (province), 3 digits. */
const PERSONAL_NIF = /^\d{9}[A-Z]{2}\d{3}$/;
/** Company NIF: 10 digits. */
const COMPANY_NIF = /^\d{10}$/;

export class Nif {
  private constructor(readonly value: string) {}

  static personal(raw: string) {
    const value = raw.trim().toUpperCase();
    if (!PERSONAL_NIF.test(value)) {
      throw new ValidationError('NIF inválido', { nif: ['Formato: 9 dígitos, 2 letras e 3 dígitos (ex.: 006512378LA041)'] }, 'invalid_nif');
    }
    return new Nif(value);
  }

  static company(raw: string) {
    const value = raw.trim();
    if (!COMPANY_NIF.test(value)) {
      throw new ValidationError('NIF da empresa inválido', { nif: ['O NIF da empresa tem 10 dígitos'] }, 'invalid_nif');
    }
    return new Nif(value);
  }

  toString() {
    return this.value;
  }
}

/** Angolan IBAN: AO + 2 check digits + 21 digits, validated with ISO 13616 mod-97. */
export class Iban {
  private constructor(readonly value: string) {}

  static isValid(raw: string) {
    const iban = raw.replace(/\s/g, '').toUpperCase();
    if (!/^AO\d{23}$/.test(iban)) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
    let remainder = 0;
    for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
    return remainder === 1;
  }

  static create(raw: string) {
    if (!Iban.isValid(raw)) {
      throw new ValidationError('IBAN inválido', { iban: ['Confirme os 25 caracteres (AO06…) e os dígitos de controlo'] }, 'invalid_iban');
    }
    return new Iban(raw.replace(/\s/g, '').toUpperCase());
  }

  /** Bank code embedded in the IBAN (positions 5–8). */
  get bankCode() {
    return this.value.slice(4, 8);
  }

  /** "AO06 0040 0000 …" for display. */
  get formatted() {
    return this.value.replace(/(.{4})/g, '$1 ').trim();
  }

  toString() {
    return this.value;
  }
}

/** Angolan mobile number, stored in E.164 (+2449XXXXXXXX). */
export class PhoneNumber {
  private constructor(readonly value: string) {}

  static create(raw: string) {
    const digits = raw.replace(/[\s-]/g, '');
    const match = /^(?:\+?244)?(9\d{8})$/.exec(digits);
    if (!match) {
      throw new ValidationError('Telemóvel inválido', { phone: ['Formato: +244 9XX XXX XXX'] }, 'invalid_phone');
    }
    return new PhoneNumber(`+244${match[1]}`);
  }

  toString() {
    return this.value;
  }
}
