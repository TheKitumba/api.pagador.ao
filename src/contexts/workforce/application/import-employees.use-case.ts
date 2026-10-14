import { Injectable } from '@nestjs/common';

import { authorize } from '@/shared/application/permissions';
import { ValidationError } from '@/shared/domain/errors';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';

import { validateHire } from '../domain/employee';
import { HireEmployeeUseCase } from './employees.use-cases';

const COLUMNS = ['nome', 'bi', 'nif', 'telemovel', 'email', 'admissao', 'tipo_contrato', 'fim_contrato', 'vencimento_base', 'banco', 'iban'] as const;
const CONTRACT_TYPES: Record<string, 'INDEFINITE' | 'FIXED_TERM'> = { indeterminado: 'INDEFINITE', determinado: 'FIXED_TERM', termo: 'FIXED_TERM' };

function parseCsv(content: string) {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  const separator = lines[0]?.includes(';') ? ';' : ',';
  const header = lines[0]?.split(separator).map((cell) => cell.trim().toLowerCase()) ?? [];
  return lines.slice(1).map((line) => {
    const cells = line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
  });
}

/**
 * Bulk hire from a CSV export of the spreadsheet (docs/07, 7.10). Validates every row first;
 * with `dryRun` nothing is created, so the user can fix errors before importing.
 */
@Injectable()
export class ImportEmployeesUseCase {
  constructor(
    private readonly actors: ActorContext,
    private readonly hire: HireEmployeeUseCase,
  ) {}

  template() {
    return `${COLUMNS.join(';')}\nAna Mateus;006512378LA041;006512378LA041;+244 923 456 781;ana.mateus@empresa.co.ao;2026-10-01;indeterminado;;300000;BFA;AO06 0006 0000 4512 3781 0118 7\n`;
  }

  async execute(content: string, dryRun: boolean) {
    authorize(this.actors.current, 'employees.write');
    const rows = parseCsv(content);
    if (rows.length === 0) throw new ValidationError('Ficheiro vazio', { file: ['Sem linhas para importar'] });
    if (rows.length > 2000) throw new ValidationError('Demasiadas linhas', { file: ['Máximo de 2000 linhas por importação'] });

    const results = rows.map((row, index) => {
      const input = {
        fullName: row.nome,
        idDocumentNumber: row.bi || undefined,
        nif: row.nif || row.bi || undefined,
        phone: row.telemovel || undefined,
        email: row.email || undefined,
        hireDate: row.admissao,
        contract: { type: CONTRACT_TYPES[row.tipo_contrato?.toLowerCase()] ?? 'INDEFINITE', endDate: row.fim_contrato || undefined, baseSalary: row.vencimento_base || '0' },
        bank: row.iban ? { bankCode: row.banco || 'BFA', iban: row.iban } : undefined,
      };
      try {
        if (!input.fullName) throw new ValidationError('Nome em falta', { nome: ['Obrigatório'] });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.hireDate ?? '')) throw new ValidationError('Data de admissão inválida', { admissao: ['Formato AAAA-MM-DD'] });
        validateHire(input);
        return { line: index + 2, input, errors: null as Record<string, string[]> | null };
      } catch (error) {
        return { line: index + 2, input, errors: error instanceof ValidationError ? error.fieldErrors : { _: [(error as Error).message] } };
      }
    });

    const valid = results.filter((result) => !result.errors);
    const invalid = results.filter((result) => result.errors).map((result) => ({ line: result.line, name: result.input.fullName, errors: result.errors }));
    if (dryRun) return { valid: valid.length, invalid, imported: 0 };

    for (const result of valid) await this.hire.execute(result.input);
    return { valid: valid.length, invalid, imported: valid.length };
  }
}
