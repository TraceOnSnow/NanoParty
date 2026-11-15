/**
 * Party bookkeeping (database side): the party-points ledger, settlements and adjustment
 * proposals. RoomRuntime decides WHEN these happen and checks permissions; this module makes
 * each of them a single, idempotent database step.
 */
import { games } from "@apr/games";
import {
  type AdjustmentView,
  DEFAULT_PREFS,
  type PartyPrefs,
  type PlayerId,
  type Settlement,
  settle,
} from "@apr/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client.ts";
import { adjustments, partyPoints, partySessions, scoreEvents, segments } from "../db/schema.ts";
import { newId } from "../util/tokens.ts";

export type Scoring = "raw-v1" | "rank-v1";

export interface PendingAdjustment {
  id: string;
  segmentId: string | null;
  items: { playerId: PlayerId; tenths: number }[];
  reason: string;
  /** "agent", "host" or a player id. */
  proposedBy: string;
}

export const normalisePrefs = (value: unknown): PartyPrefs => ({
  ...DEFAULT_PREFS,
  ...(value && typeof value === "object" ? (value as Partial<PartyPrefs>) : {}),
});

/** Party totals in tenths, by player. */
export async function partyTotals(db: Db, sessionId: string): Promise<Map<PlayerId, number>> {
  const rows = await db
    .select({ playerId: partyPoints.playerId, tenths: sql<number>`sum(${partyPoints.tenths})::int` })
    .from(partyPoints)
    .where(eq(partyPoints.sessionId, sessionId))
    .groupBy(partyPoints.playerId);
  return new Map(rows.map((r) => [r.playerId, r.tenths]));
}

export async function rawScores(db: Db, segmentId: string): Promise<Record<PlayerId, number>> {
  const rows = await db
    .select({ playerId: scoreEvents.playerId, points: sql<number>`sum(${scoreEvents.points})::int` })
    .from(scoreEvents)
    .where(eq(scoreEvents.segmentId, segmentId))
    .groupBy(scoreEvents.playerId);
  return Object.fromEntries(rows.map((r) => [r.playerId, r.points]));
}

/**
 * The settlement of a segment from what is on record: who took part (the members when it
 * started, plus anyone who scored, minus whoever the game says was not competing) ranked by raw result.
 */
export async function computeSettlement(
  db: Db,
  segmentId: string,
  endedReason: "finished" | "ended",
): Promise<Settlement & { gameId: string }> {
  const [seg] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!seg) throw new Error("segment not found");
  const raw = await rawScores(db, segmentId);
  const excluded = games[seg.gameId]?.settlement?.(seg.state).exclude ?? [];
  const participants = [...new Set([...(seg.participants as PlayerId[]), ...Object.keys(raw)])].filter(
    (p) => !excluded.includes(p),
  );
  // A game that ran to its end has a result even if nobody scored; one cut short needs at least one scored unit.
  const hasResult = endedReason === "finished" || Object.keys(raw).length > 0;
  return { ...settle(participants, raw, hasResult), gameId: seg.gameId };
}

export async function pendingAdjustments(db: Db, sessionId: string): Promise<PendingAdjustment[]> {
  const rows = await db
    .select()
    .from(adjustments)
    .where(and(eq(adjustments.sessionId, sessionId), eq(adjustments.status, "pending")))
    .orderBy(adjustments.createdAt);
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segmentId,
    items: r.items as PendingAdjustment["items"],
    reason: r.reason,
    proposedBy: r.proposedBy,
  }));
}

/** Credits an approved proposal. The award key makes a repeat a no-op. */
export async function creditAdjustment(
  tx: Tx,
  sessionId: string,
  adj: PendingAdjustment,
  approvedBy: PlayerId,
  kind: "adjust" | "correction",
): Promise<void> {
  await tx
    .insert(partyPoints)
    .values(
      adj.items.map((item) => ({
        id: newId("pp"),
        sessionId,
        segmentId: adj.segmentId,
        playerId: item.playerId,
        tenths: item.tenths,
        kind,
        reason: adj.reason,
        proposedBy: adj.proposedBy,
        approvedBy,
        adjustmentId: adj.id,
        awardKey: `adj:${adj.id}:${item.playerId}`,
      })),
    )
    .onConflictDoNothing();
  await tx
    .update(adjustments)
    .set({ status: "approved", decidedBy: approvedBy, decidedAt: new Date() })
    .where(and(eq(adjustments.id, adj.id), eq(adjustments.status, "pending")));
}

/** Credits a segment's placement rewards (once) and closes the segment with a snapshot of what was applied. */
export async function creditSettlement(
  tx: Tx,
  sessionId: string,
  segmentId: string,
  settlement: Settlement,
  endedReason: "finished" | "ended",
  approvedBy: PlayerId,
  adjustmentId: string | null,
): Promise<void> {
  if (settlement.rows.length > 0) {
    await tx
      .insert(partyPoints)
      .values(
        settlement.rows.map((row) => ({
          id: newId("pp"),
          sessionId,
          segmentId,
          playerId: row.playerId,
          tenths: row.tenths,
          kind: "rank" as const,
          reason: `第 ${row.rank} 名${row.tied ? "（并列）" : ""}`,
          approvedBy,
          awardKey: `seg:${segmentId}:rank:${row.playerId}`,
        })),
      )
      .onConflictDoNothing();
  }
  await tx
    .update(segments)
    .set({
      status: "finished",
      endedAt: new Date(),
      settlement: { ...settlement, endedReason, adjustmentId },
    })
    .where(eq(segments.id, segmentId));
}

export async function partyNumbers(db: Db, roomId: string, sessionId: string) {
  const sessions = await db
    .select({ id: partySessions.id, status: partySessions.status })
    .from(partySessions)
    .where(eq(partySessions.roomId, roomId))
    .orderBy(desc(partySessions.createdAt));
  const [played] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(segments)
    .where(and(eq(segments.sessionId, sessionId), eq(segments.status, "finished")));
  return {
    number: sessions.length,
    gamesPlayed: played?.n ?? 0,
    lastEndedSessionId: sessions.find((s) => s.status === "ended")?.id ?? null,
  };
}

export const toAdjustmentView = (adj: PendingAdjustment, name: (id: string) => string): AdjustmentView => ({
  id: adj.id,
  items: adj.items,
  reason: adj.reason,
  proposedBy: adj.proposedBy === "agent" ? "AI 主持" : adj.proposedBy === "host" ? "房主" : name(adj.proposedBy),
  segmentId: adj.segmentId,
});
