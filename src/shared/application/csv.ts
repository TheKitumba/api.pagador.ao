type Cell = string | number | boolean | null | undefined;

/** CSV with ";" separators and UTF-8 BOM, so Excel configured for pt-AO opens it correctly. */
export function toCsv(rows: Record<string, Cell>[]) {
  if (rows.length === 0) return '﻿';
  const headers = Object.keys(rows[0]);
  const escape = (value: Cell) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[headers.join(';'), ...rows.map((row) => headers.map((header) => escape(row[header])).join(';'))].join('\n')}\n`;
}
