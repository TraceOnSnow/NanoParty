/**
 * Party recap, built only from what is on record: the score ledgers, settled games and the
 * public event log. Nothing here is generated; the optional AI summary is a separate text
 * stored with the party. Secrets (game state, unrevealed answers) are never read.
 */
import { games } from "@apr/games";
import { formatTenths, type PlayerId } from "@apr/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { adjustments, events, partyPoints, partySessions, players, scoreEvents, segments } from "../db/schema.ts";

export interface RecapGame {
  segmentId: string;
  gameId: string;
  gameName: string;
  status: "finished" | "aborted";
  startedAt: number;
  endedAt: number | null;
  /** Raw result in the game, best first. */
  raw: { playerId: PlayerId; points: number }[];
  /** Placement rewards that were credited (tenths). Empty for abandoned games and legacy parties. */
  rewards: { playerId: PlayerId; rank: number; tied: boolean; tenths: number }[];
  note: string | null;
}

export interface RecapAdjustment {
  segmentId: string | null;
  kind: "adjust" | "correction";
  items: { playerId: PlayerId; tenths: number }[];
  reason: string;
  proposedBy: string;
  approvedBy: string;
  at: number;
}

export interface Recap {
  sessionId: string;
  roomId: string;
  number: number;
  status: "active" | "ended";
  scoring: "raw-v1" | "rank-v1";
  startedAt: number;
  endedAt: number | null;
  names: Record<PlayerId, string>;
  /** Final standings; equal totals share a place. Points in tenths for rank-v1, raw points ×10 for legacy. */
  ranking: { playerId: PlayerId; tenths: number; rank: number }[];
  games: RecapGame[];
  adjustments: RecapAdjustment[];
  /** Running totals after each credited step, in order. */
  timeline: { at: number; label: string; totals: Record<PlayerId, number> }[];
  /** Notable public events, as plain facts. */
  events: { at: number; text: string }[];
  summary: { status: "none" | "pending" | "ok" | "failed"; text: string | null };
}

export interface PartyListItem {
  sessionId: string;
  number: number;
  status: "active" | "ended";
  startedAt: number;
  endedAt: number | null;
  games: number;
}

export async function listParties(db: Db, roomId: string): Promise<PartyListItem[]> {
  const sessions = await db
    .select()
    .from(partySessions)
    .where(eq(partySessions.roomId, roomId))
    .orderBy(asc(partySessions.createdAt));
  const segs = sessions.length
    ? await db
        .select({ sessionId: segments.sessionId, status: segments.status })
        .from(segments)
        .where(
          inArray(
            segments.sessionId,
            sessions.map((s) => s.id),
          ),
        )
    : [];
  return sessions.map((s, i) => ({
    sessionId: s.id,
    number: i + 1,
    status: s.status,
    startedAt: s.createdAt.getTime(),
    endedAt: s.endedAt?.getTime() ?? null,
    games: segs.filter((g) => g.sessionId === s.id && g.status === "finished").length,
  }));
}

export async function buildRecap(db: Db, roomId: string, sessionId: string): Promise<Recap | null> {
  const parties = await listParties(db, roomId);
  const meta = parties.find((p) => p.sessionId === sessionId);
  const [session] = await db.select().from(partySessions).where(eq(partySessions.id, sessionId));
  if (!meta || !session) return null;

  const names = Object.fromEntries(
    (await db.select().from(players).where(eq(players.roomId, roomId))).map((p) => [p.id, p.nickname]),
  );
  const name = (id: string | null) => (id ? (names[id] ?? "已离开的玩家") : "?");
  const segRows = await db
    .select()
    .from(segments)
    .where(eq(segments.sessionId, sessionId))
    .orderBy(asc(segments.createdAt));
  const raw = await db.select().from(scoreEvents).where(eq(scoreEvents.sessionId, sessionId));
  // Rows credited in one step share a timestamp: placement first, then the adjustment made with it.
  const ledger = (
    await db.select().from(partyPoints).where(eq(partyPoints.sessionId, sessionId)).orderBy(asc(partyPoints.createdAt))
  ).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || Number(a.kind !== "rank") - Number(b.kind !== "rank"),
  );

  const gamesOut: RecapGame[] = segRows
    .filter((s) => s.status === "finished" || s.status === "aborted")
    .map((s) => {
      const sums = new Map<string, number>();
      for (const e of raw) if (e.segmentId === s.id) sums.set(e.playerId, (sums.get(e.playerId) ?? 0) + e.points);
      const snapshot = s.settlement as { rows?: RecapGame["rewards"]; note?: string | null } | null;
      return {
        segmentId: s.id,
        gameId: s.gameId,
        gameName: games[s.gameId]?.meta.name ?? s.gameId,
        status: s.status as "finished" | "aborted",
        startedAt: s.createdAt.getTime(),
        endedAt: s.endedAt?.getTime() ?? null,
        raw: [...sums.entries()]
          .map(([playerId, points]) => ({ playerId, points }))
          .sort((a, b) => b.points - a.points),
        rewards: (snapshot?.rows ?? []).map((r) => ({
          playerId: r.playerId,
          rank: r.rank,
          tied: r.tied,
          tenths: r.tenths,
        })),
        note: snapshot?.note ?? null,
      };
    });

  // Approved adjustments, grouped by proposal.
  const approved = await db
    .select()
    .from(adjustments)
    .where(and(eq(adjustments.sessionId, sessionId), eq(adjustments.status, "approved")))
    .orderBy(asc(adjustments.decidedAt));
  const adjustmentsOut: RecapAdjustment[] = approved.map((a) => ({
    segmentId: a.segmentId,
    kind: ledger.find((l) => l.adjustmentId === a.id)?.kind === "correction" ? "correction" : "adjust",
    items: a.items as RecapAdjustment["items"],
    reason: a.reason,
    proposedBy: a.proposedBy === "agent" ? "AI 主持" : a.proposedBy === "host" ? "房主" : name(a.proposedBy),
    approvedBy: name(a.decidedBy),
    at: (a.decidedAt ?? a.createdAt).getTime(),
  }));

  // Totals and timeline. Legacy parties: raw points, per game.
  const totals: Record<string, number> = {};
  const timeline: Recap["timeline"] = [];
  const step = (at: number, label: string) => timeline.push({ at, label, totals: { ...totals } });
  if (session.scoring === "rank-v1") {
    const seen = new Set<string>();
    for (const row of ledger) {
      totals[row.playerId] = (totals[row.playerId] ?? 0) + row.tenths;
      const key = row.kind === "rank" ? `seg:${row.segmentId}` : `adj:${row.adjustmentId}`;
      if (seen.has(key)) {
        (timeline.at(-1) as Recap["timeline"][0]).totals = { ...totals };
        continue;
      }
      seen.add(key);
      const game = gamesOut.find((g) => g.segmentId === row.segmentId)?.gameName;
      step(
        row.createdAt.getTime(),
        row.kind === "rank" ? `「${game ?? "游戏"}」名次奖励` : `房主批准的调整：${row.reason}`,
      );
    }
  } else {
    for (const g of gamesOut) {
      for (const r of g.raw) totals[r.playerId] = (totals[r.playerId] ?? 0) + r.points * 10;
      step(g.endedAt ?? g.startedAt, `「${g.gameName}」原始得分`);
    }
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const ranking = sorted.map(([playerId, tenths]) => ({
    playerId,
    tenths,
    rank: sorted.findIndex(([, t]) => t === tenths) + 1,
  }));

  // Public facts from the event log. Only event types listed here are shown.
  const log = await db.select().from(events).where(eq(events.sessionId, sessionId)).orderBy(asc(events.createdAt));
  const gameOf = (segmentId: string | null) => gamesOut.find((g) => g.segmentId === segmentId)?.gameName ?? "游戏";
  const facts: Recap["events"] = [];
  for (const e of log) {
    const d = e.data as Record<string, unknown>;
    const at = e.createdAt.getTime();
    if (e.type === "game.start") facts.push({ at, text: `开始「${games[String(d.gameId)]?.meta.name ?? d.gameId}」` });
    else if (e.type === "game.end") {
      facts.push({
        at,
        text: `「${gameOf(e.segmentId)}」${d.reason === "aborted" ? "被放弃（不计派对积分）" : d.reason === "ended" ? "由房主提前结束并结算" : "打完了"}`,
      });
    } else if (e.type === "game.skip") facts.push({ at, text: `「${gameOf(e.segmentId)}」里大家投票跳过了一题` });
    else if (e.type === "pick.override") facts.push({ at, text: `房主在「${gameOf(e.segmentId)}」里代题主选了题` });
    else if (e.type === "room.host") facts.push({ at, text: `${name(e.actor)} 成为房主` });
  }
  for (const a of adjustmentsOut) {
    facts.push({
      at: a.at,
      text: `${a.approvedBy} 批准了${a.kind === "correction" ? "更正" : "派对调整"}（${a.proposedBy} 提出）：${a.items
        .map((i) => `${name(i.playerId)} ${i.tenths > 0 ? "+" : ""}${formatTenths(i.tenths)}`)
        .join("、")}，理由「${a.reason}」`,
    });
  }
  facts.sort((a, b) => a.at - b.at);

  return {
    sessionId,
    roomId,
    number: meta.number,
    status: session.status,
    scoring: session.scoring,
    startedAt: session.createdAt.getTime(),
    endedAt: session.endedAt?.getTime() ?? null,
    names,
    ranking,
    games: gamesOut,
    adjustments: adjustmentsOut,
    timeline,
    events: facts,
    summary: { status: session.summaryStatus, text: session.summary },
  };
}

export const SUMMARY_PROMPT = `你是这群朋友聚会的 AI 主持，派对刚结束，写一段回顾发在大厅里。
像一个一起玩的网友在群里说话：短（不超过 150 字），具体，有点调侃；不要客服腔，不要「感谢大家参与」「期待下次」之类的套话，不要逐条复述数据。
只能使用下面【记录】里的事实。记录里没有的事不要写：不知道谁最搞笑、谁发挥最好，就别评；没被批准的提议不算发生过；你听不到语音。
「房主批准的调整」是朋友之间的约定，不代表谁真的做了理由里说的事，转述时保持这个分寸。`;

/** The recap as plain text for the summary model. Contains only what the recap page itself shows. */
export function recapAsText(recap: Recap): string {
  const name = (id: string) => recap.names[id] ?? "?";
  const points = (t: number) => formatTenths(t);
  return [
    "【记录】",
    `第 ${recap.number} 场派对，最终排名：${recap.ranking.map((r) => `第${r.rank}名 ${name(r.playerId)} ${points(r.tenths)}分`).join("；") || "没有人得分"}`,
    ...recap.games.map(
      (g) =>
        `游戏「${g.gameName}」${g.status === "aborted" ? "（被放弃）" : ""}：游戏内成绩 ${g.raw.map((r) => `${name(r.playerId)} ${r.points}`).join("、") || "无"}${
          g.rewards.length
            ? `；名次奖励 ${g.rewards.map((r) => `${name(r.playerId)} +${points(r.tenths)}`).join("、")}`
            : ""
        }`,
    ),
    ...recap.adjustments.map(
      (a) =>
        `房主批准的调整（${a.proposedBy} 提出）：${a.items.map((i) => `${name(i.playerId)} ${i.tenths > 0 ? "+" : ""}${points(i.tenths)}`).join("、")}，理由「${a.reason}」`,
    ),
    ...recap.events.filter((e) => e.text.includes("跳过") || e.text.includes("放弃")).map((e) => `其它：${e.text}`),
  ].join("\n");
}
