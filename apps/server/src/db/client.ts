import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { MIGRATIONS_DIR } from "../paths.ts";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

/**
 * Opens the database and applies pending migrations.
 * - `databaseUrl` set   -> real PostgreSQL (Docker / production).
 * - otherwise           -> embedded PGlite (Postgres compiled to WASM) for zero-setup dev and tests.
 *   `pgliteDir` undefined means in-memory.
 */
export async function openDb(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const { default: pg } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as Db, kind: "postgres", close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = new PGlite(opts.pgliteDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Db, kind: "pglite", close: () => client.close() };
}

export { schema };
