/**
 * Three states, told apart, because they need three different answers.
 *
 * A fresh clone with Postgres running and no tables used to look exactly like a
 * Postgres that was not running, so the setup page told people to start a
 * database they had already started. `select 1` succeeds on an empty database, so
 * it is not enough on its own: the tables have to be looked for separately.
 */

export type DatabaseState = 'unreachable' | 'no-tables' | 'ready';

export interface DatabaseReport {
  state: DatabaseState;
  /** Host from DATABASE_URL, for the "connected to x" line. */
  host?: string;
  /** Why the connection failed, when it did. */
  error?: string;
}

/** The three tables nothing works without. Checked by name, not by querying them. */
const CORE_TABLES = ['users', 'brands', 'drafts'];

export const DB_PUSH_FIX = [
  'Postgres is running and Lore can reach it. The tables are not there yet.',
  'Create them: `npm run db:push`',
  'Then restart Lore. On a fresh clone `npm run setup` does the same thing plus the env file.',
];

export async function databaseState(): Promise<DatabaseReport> {
  const url = process.env.DATABASE_URL?.trim();
  const host = (() => {
    try {
      return url ? new URL(url).host : undefined;
    } catch {
      return undefined;
    }
  })();

  try {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const rows = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = current_schema()
        and table_name in ('users', 'brands', 'drafts')
    `);
    const found = new Set(
      // postgres-js returns the rows themselves, other drivers wrap them in `.rows`.
      (Array.isArray(rows) ? rows : ((rows as { rows?: { table_name: string }[] }).rows ?? [])).map(
        (r) => r.table_name,
      ),
    );
    const missing = CORE_TABLES.filter((t) => !found.has(t));
    return { state: missing.length ? 'no-tables' : 'ready', host };
  } catch (err) {
    return { state: 'unreachable', host, error: reason(err) };
  }
}

/**
 * Drizzle wraps a failure as "Failed query: <the whole SQL>" and keeps the real
 * one on `cause`. The SQL is no use to someone whose Postgres is not running.
 */
function reason(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause as (Error & { code?: string }) | undefined;
  // A refused connection arrives as an AggregateError with an empty message and the
  // code on the side, which is the one case people hit most.
  const raw = (cause?.message || (err instanceof Error ? err.message : String(err)))
    .replace(/Failed query:[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [cause?.code, raw].filter(Boolean).join(' ') || 'the connection failed';
}
