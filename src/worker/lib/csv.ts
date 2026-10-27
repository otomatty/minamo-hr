export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // 表計算ソフトで数式として解釈されないようにする (CSV インジェクション対策)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
