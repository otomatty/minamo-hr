// 起動時にスキーマを自動適用する (wrangler d1 migrations apply を実行しなくてもデプロイだけで動くように)
import init0001 from "../../../migrations/0001_init.sql?raw";

const MIGRATIONS: Array<{ name: string; sql: string }> = [{ name: "0001_init.sql", sql: init0001 }];

let migrated = false;

export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function ensureMigrated(db: D1Database): Promise<void> {
  if (migrated) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
  // wrangler の d1_migrations テーブルで適用済みなら記録だけ合わせる
  const applied = new Set(
    ((await db.prepare("SELECT name FROM _app_migrations").all<{ name: string }>()).results ?? []).map((r) => r.name),
  );
  try {
    const wr = await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>();
    for (const r of wr.results ?? []) applied.add(r.name);
  } catch {
    // d1_migrations が無い場合は無視
  }
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    const stmts = splitSql(m.sql).map((s) => db.prepare(s));
    stmts.push(db.prepare("INSERT OR IGNORE INTO _app_migrations (name) VALUES (?)").bind(m.name));
    await db.batch(stmts);
  }
  migrated = true;
}
