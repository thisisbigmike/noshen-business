import pg from "pg";

export type Db = pg.ClientBase;

/** Opens one connection (through Hyperdrive in the Worker), runs fn, and always closes it. */
export async function withDb<T>(connectionString: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export type Actor = { type: "buyer" | "seller" | "staff" | "system" | "partner"; id?: string | null };

export interface Tx {
  db: Db;
  /** Work to do only once the transaction has committed: SMS, partner calls, timers. */
  after(fn: () => Promise<unknown>): void;
}

/**
 * Runs fn in one database transaction, naming the actor for the deal timeline (noshen.actor).
 * After-commit work runs only if the commit succeeds; its failures are logged, never thrown,
 * because the money state is already safely recorded.
 */
export async function inTx<T>(db: Db, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const queued: Array<() => Promise<unknown>> = [];
  await db.query("begin");
  let result: T;
  try {
    await db.query("select set_config('noshen.actor', $1, true), set_config('noshen.actor_id', $2, true)", [
      actor.type,
      actor.id ?? "",
    ]);
    result = await fn({ db, after: (f) => queued.push(f) });
    await db.query("commit");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
  for (const f of queued) {
    try {
      await f();
    } catch (e) {
      console.error("after-commit task failed", e);
    }
  }
  return result;
}

export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

export async function many<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
