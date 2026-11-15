/**
 * Play report export (read-only). Produces a folder with a readable summary, a file index and
 * detail files, for a developer (or a coding agent) to look into what happened in a party.
 *
 *   node dist/report.js --list                      recent parties
 *   node dist/report.js --party <sessionId> --out <dir>
 *   node dist/report.js --since 2026-11-14 --out <dir>      every party since a date
 *   options: --issues (only parties with feedback or rejected actions)
 *            --with-chat (include chat text)   --with-state (include raw game state: SECRETS)
 *
 * Safety: the PostgreSQL connection is opened read-only and no migration is run. Credentials
 * never leave the database: invite tokens, session token hashes and keys are not selected.
 * Players appear as P1, P2, … (stable within a room). Chat text and game state are left out
 * unless asked for, and the index says so when they are included.
 */
import { mkdirSync } from "node:fs";
import { and, desc, gte, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { exportParty } from "./reportExport.ts";
import { listParties } from "./rooms/recap.ts";

const { events, feedback, partySessions, rooms } = schema;

async function openReadOnly(): Promise<{ db: Db; close(): Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    // Every statement of this session runs in a read-only transaction: writes are refused by the database.
    const pool = new pg.Pool({ connectionString: url, max: 2, options: "-c default_transaction_read_only=on" });
    return { db: drizzle(pool, { schema }) as unknown as Db, close: () => pool.end() };
  }
  const dir = process.env.PGLITE_DIR;
  if (!dir) throw new Error("set DATABASE_URL (or PGLITE_DIR for a local development database)");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dir);
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close() };
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function main() {
  const { db, close } = await openReadOnly();
  try {
    if (flag("--list")) {
      const recent = await db.select().from(partySessions).orderBy(desc(partySessions.createdAt)).limit(30);
      const roomNames = new Map(
        (
          await db
            .select({ id: rooms.id })
            .from(rooms)
            .where(inArray(rooms.id, recent.map((r) => r.roomId).concat("-")))
        ).map((r) => [r.id, r.id]),
      );
      for (const s of recent) {
        const number = (await listParties(db, s.roomId)).find((p) => p.sessionId === s.id)?.number;
        console.log(`${s.id}  room=${roomNames.get(s.roomId)}  #${number}  ${s.status}  ${s.createdAt.toISOString()}`);
      }
      return;
    }
    const out = value("--out");
    if (!out) throw new Error("--out <dir> is required");
    let ids: string[] = [];
    const party = value("--party");
    const since = value("--since");
    if (party) ids = [party];
    else if (since) {
      ids = (
        await db
          .select({ id: partySessions.id })
          .from(partySessions)
          .where(gte(partySessions.createdAt, new Date(since)))
      ).map((r) => r.id);
    } else throw new Error("give --party <sessionId> or --since <date>");
    if (flag("--issues") && ids.length > 0) {
      const withFeedback = await db
        .select({ id: feedback.sessionId })
        .from(feedback)
        .where(inArray(feedback.sessionId, ids));
      const withEvents = await db
        .select({ id: events.sessionId, data: events.data })
        .from(events)
        .where(and(inArray(events.sessionId, ids), isNotNull(events.sessionId)));
      const keep = new Set([
        ...withFeedback.map((r) => r.id),
        ...withEvents.filter((e) => (e.data as { rejected?: string }).rejected).map((e) => e.id),
      ]);
      ids = ids.filter((id) => keep.has(id));
    }
    mkdirSync(out, { recursive: true });
    for (const id of ids) {
      const r = await exportParty(db, id, out, { withChat: flag("--with-chat"), withState: flag("--with-state") });
      console.log(`${r.dir}  feedback=${r.feedback} rejected=${r.rejected}`);
    }
    if (ids.length === 0) console.log("no matching parties");
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`report failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
