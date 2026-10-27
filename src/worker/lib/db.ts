// D1 の薄いヘルパー
export type Row = Record<string, any>;

export async function all<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function first<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export async function insert(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const res = await db.prepare(sql).bind(...params).run();
  return Number(res.meta.last_row_id);
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** IN 句用のプレースホルダ */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/** 部分更新用: 許可されたキーだけを SET 句にする */
export function buildUpdate(table: string, allowed: string[], body: Row, where: string): { sql: string; values: unknown[] } | null {
  const keys = allowed.filter((k) => k in body);
  if (keys.length === 0) return null;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = body[k];
    if (v === undefined || v === "") return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "object" && v !== null) return JSON.stringify(v);
    return v;
  });
  return { sql: `UPDATE ${table} SET ${sets} WHERE ${where}`, values };
}
