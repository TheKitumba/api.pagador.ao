import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Reusable schema fragments so every endpoint documents values the same way. */
export const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/).describe('Valor monetário em string decimal, ex.: "371800.70"');
export const moneyInput = z.union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/)]).describe('Valor em Kz, ex.: 300000 ou "300000.00"');
export const dateOnly = z.iso.date().describe('Data no formato AAAA-MM-DD');
export const dateTime = z.iso.datetime({ offset: true }).describe('Data e hora ISO 8601');
export const uuid = z.uuid();

/** Instant in responses: a Date in the code, an ISO 8601 string on the wire (use with `createZodDto(…, { codec: true })`). */
export const timestamp = z.codec(dateTime, z.date(), { decode: (value) => new Date(value), encode: (value) => value.toISOString() });

/** Query bound accepting a date or a date-time, delivered as a Date. */
export const dateBound = z.union([dateOnly, dateTime]).transform((value) => new Date(value)).describe('Data (AAAA-MM-DD) ou data e hora ISO 8601');

export class IdParam extends createZodDto(z.object({ id: z.uuid().describe('Identificador (UUID)') })) {}

export class ReasonDto extends createZodDto(z.object({ reason: z.string().trim().min(3).max(1000).describe('Justificação (obrigatória para rejeições e devoluções)') })) {}

export class OkDto extends createZodDto(z.object({ ok: z.literal(true) })) {}
