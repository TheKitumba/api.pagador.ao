import { z } from 'zod';

/** Cursor pagination (docs/07, 7.9). Ids are UUID v7, so ordering by id is ordering by creation. */
export const paginationSchema = z.object({
  cursor: z.uuid().optional().describe('Id do último registo da página anterior'),
  limit: z.coerce.number().int().min(1).max(200).default(50).describe('Registos por página (máx. 200)'),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function pageArgs({ cursor, limit }: Pagination) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: 'desc' as const },
  };
}

export function toPage<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
}

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.uuid().nullable().describe('Passe como `cursor` para obter a página seguinte'),
  });
}
