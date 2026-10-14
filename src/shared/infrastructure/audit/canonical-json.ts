/** JSON with object keys sorted recursively, so a hash survives a round trip through jsonb. */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(
      Object.keys(input as Record<string, unknown>)
        .filter((key) => (input as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => [key, normalize((input as Record<string, unknown>)[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}
