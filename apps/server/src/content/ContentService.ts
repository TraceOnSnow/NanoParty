/**
 * Content library boundary.
 *
 * Today: seeds bundled content and selects unused items for a party session.
 * Planned behind the same boundary: structured import, AI generation as a background job
 * (results saved here with their real source), and feedback-driven selection.
 * Game modules never see this service; the runtime hands them a synchronous `drawContent`.
 */
import type { BundledContent } from "@apr/games";
import type { ContentItem } from "@apr/shared";
import { and, eq } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { contentItems, contentUsage } from "../db/schema.ts";

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

  /** Records shown content inside the caller's transaction (same commit as the game state). */
  async recordUsage(tx: Tx, sessionId: string, segmentId: string, items: ContentItem[]): Promise<void> {
    if (items.length === 0) return;
    await tx
      .insert(contentUsage)
      .values(items.map((i) => ({ sessionId, segmentId, contentId: i.id, contentVersion: i.version })))
      .onConflictDoNothing();
  }
}
