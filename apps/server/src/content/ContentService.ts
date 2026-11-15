/**
 * Content library boundary.
 *
 * Today: seeds bundled content and selects unused items for a party session.
 * Planned behind the same boundary: structured import, AI generation as a background job
 * (results saved here with their real source), and feedback-driven selection.
 * Game modules never see this service; the runtime hands them a synchronous `drawContent`.
 */
import { type BundledContent, contentTypes } from "@apr/games";
import type { CandidateRecord, ContentItem, FeedbackKind } from "@apr/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { candidateHistory, contentFeedback, contentItems, contentUsage } from "../db/schema.ts";
import { newId } from "../util/tokens.ts";

export class ContentService {
  constructor(
    private readonly db: Db,
    private readonly random: () => number = Math.random,
  ) {}

  /** Idempotent: existing (id, version) rows are left untouched, so shown content never changes. */
  async seed(items: BundledContent[]): Promise<void> {
    if (items.length === 0) return;
    await this.db
      .insert(contentItems)
      .values(
        items.map((i) => ({
          id: i.id,
          version: i.version,
          type: i.type,
          theme: i.theme,
          source: i.source,
          verification: i.verification,
          payload: i.payload,
        })),
      )
      .onConflictDoNothing();
  }

  /** Active items of a type (latest version each) not yet used in this party session, shuffled. */
  async pool(type: string, sessionId: string): Promise<ContentItem[]> {
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.type, type), eq(contentItems.status, "active")));
    const used = new Set(
      (
        await this.db
          .select({ id: contentUsage.contentId })
          .from(contentUsage)
          .where(eq(contentUsage.sessionId, sessionId))
      ).map((r) => r.id),
    );
    const latest = new Map<string, ContentItem>();
    for (const r of rows) {
      const current = latest.get(r.id);
      if (!current || r.version > current.version) {
        latest.set(r.id, { id: r.id, version: r.version, type: r.type, theme: r.theme, payload: r.payload });
      }
    }
    const items = [...latest.values()].filter((i) => !used.has(i.id));
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j] as ContentItem, items[i] as ContentItem];
    }
    return items;
  }

  /**
   * Adds new content to the library after validating each payload against its content type.
   * `source` says truthfully where it came from (a player, a model). New content is always
   * "unverified". Returns the saved items and the reasons for any that were rejected.
   */
  async save(
    exec: Db | Tx,
    items: { type: string; theme: string; payload: unknown }[],
    source: string,
  ): Promise<{ saved: ContentItem[]; rejected: string[] }> {
    const saved: ContentItem[] = [];
    const rejected: string[] = [];
    for (const [index, item] of items.entries()) {
      const def = contentTypes[item.type];
      if (!def) {
        rejected.push(`第 ${index + 1} 条：未知的内容类型 ${item.type}`);
        continue;
      }
      const parsed = def.schema.safeParse(item.payload);
      if (!parsed.success) {
        const why = parsed.error.issues.map((i) => `${i.path.join(".") || "payload"} ${i.message}`).join("；");
        rejected.push(`第 ${index + 1} 条格式不对：${why}`);
        continue;
      }
      saved.push({
        id: newId("cnt"),
        version: 1,
        type: item.type,
        theme: item.theme.slice(0, 40) || "未分类",
        payload: parsed.data,
      });
    }
    if (saved.length > 0) {
      await exec.insert(contentItems).values(saved.map((i) => ({ ...i, source, verification: "unverified" as const })));
    }
    return { saved, rejected };
  }

  /** Latest version of each requested item that exists and is active. */
  async getByIds(ids: string[]): Promise<ContentItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(and(inArray(contentItems.id, ids), eq(contentItems.status, "active")));
    const latest = new Map<string, ContentItem>();
    for (const r of rows) {
      if ((latest.get(r.id)?.version ?? 0) < r.version) {
        latest.set(r.id, { id: r.id, version: r.version, type: r.type, theme: r.theme, payload: r.payload });
      }
    }
    return ids.map((id) => latest.get(id)).filter((i): i is ContentItem => i !== undefined);
  }

  /** Stores a player's lightweight feedback on a content item (used later for selection and revision). */
  async recordFeedback(sessionId: string, contentId: string, playerId: string, kind: FeedbackKind): Promise<void> {
    const [latest] = await this.db
      .select({ version: sql<number>`max(${contentItems.version})::int` })
      .from(contentItems)
      .where(eq(contentItems.id, contentId));
    await this.db.insert(contentFeedback).values({
      id: newId("fb"),
      sessionId,
      contentId,
      contentVersion: latest?.version ?? 1,
      playerId,
      kind,
    });
  }

  /** Records shown content inside the caller's transaction (same commit as the game state). */
  async recordUsage(tx: Tx, sessionId: string, segmentId: string, items: ContentItem[]): Promise<void> {
    if (items.length === 0) return;
    await tx
      .insert(contentUsage)
      .values(items.map((i) => ({ sessionId, segmentId, contentId: i.id, contentVersion: i.version })))
      .onConflictDoNothing();
  }

  /** A party's candidate history for one content type, newest first. */
  async history(sessionId: string, type: string): Promise<CandidateRecord[]> {
    const rows = await this.db
      .select()
      .from(candidateHistory)
      .where(and(eq(candidateHistory.sessionId, sessionId), eq(candidateHistory.contentType, type)))
      .orderBy(sql`${candidateHistory.updatedAt} desc`);
    const items = new Map((await this.getByIds(rows.map((r) => r.contentId))).map((i) => [i.id, i]));
    return rows.flatMap((r) => {
      const item = items.get(r.contentId);
      return item ? [{ item, status: r.status, seenBy: r.seenBy as string[] | null, origin: r.origin }] : [];
    });
  }

  /** Writes the given history records (insert or replace), inside the caller's transaction. */
  async recordCandidates(exec: Db | Tx, sessionId: string, records: CandidateRecord[]): Promise<void> {
    for (const r of records) {
      const values = { status: r.status, seenBy: r.seenBy, origin: r.origin, updatedAt: new Date() };
      await exec
        .insert(candidateHistory)
        .values({ sessionId, contentType: r.item.type, contentId: r.item.id, ...values })
        .onConflictDoUpdate({ target: [candidateHistory.sessionId, candidateHistory.contentId], set: values });
    }
  }
}
