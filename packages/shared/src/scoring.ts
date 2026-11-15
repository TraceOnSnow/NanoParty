/**
 * Party scoring (version "rank-v1").
 *
 * A game keeps its own raw results. When a game segment is settled, its placement is turned
 * into party points with one shared table; raw scores never go into the party total directly.
 * Points are handled in tenths (integers) so shared placements such as 8.5 stay exact.
 * Everything about the default reward lives here, so it can be tuned in one place.
 */
import type { PlayerId } from "./game.ts";

export const SCORING_VERSION = "rank-v1";
/** Reward of the first place; the last place gets 0. */
export const TOP_REWARD = 10;

/** Reward (in tenths) for places 1..n: round(10 × (n − r) / (n − 1)). Empty for fewer than 2 players. */
export function placeRewards(n: number): number[] {
  if (n < 2) return [];
  return Array.from({ length: n }, (_, i) => Math.round((TOP_REWARD * (n - 1 - i)) / (n - 1)) * 10);
}

export interface SettlementRow {
  playerId: PlayerId;
  /** Raw result in the game (its own points). */
  raw: number;
  /** 1-based place; tied players share the best place of their group. */
  rank: number;
  tied: boolean;
  /** Party reward in tenths. */
  tenths: number;
}

export interface Settlement {
  version: typeof SCORING_VERSION;
  rows: SettlementRow[];
  /** Why there is no base reward, or a caveat about it; null when it is a plain ranking. */
  note: string | null;
}

/**
 * Ranks the participants by raw result (higher is better; the game decides what "raw" means)
 * and assigns party rewards. Tied players split the rewards of the places they occupy
 * (rounded to one decimal). Nobody is separated at random.
 */
export function settle(participants: PlayerId[], raw: Record<PlayerId, number>, hasResult: boolean): Settlement {
  const players = [...new Set(participants)];
  const base = (note: string): Settlement => ({
    version: SCORING_VERSION,
    rows: players.map((playerId) => ({
      playerId,
      raw: raw[playerId] ?? 0,
      rank: 1,
      tied: players.length > 1,
      tenths: 0,
    })),
    note,
  });
  if (!hasResult) return base("这一场还没有完成任何计分单元，不发基础派对积分。");
  if (players.length < 2) return base("参与人数不足 2 人，不产生名次奖励。");

  const rewards = placeRewards(players.length);
  const sorted = [...players].sort((a, b) => (raw[b] ?? 0) - (raw[a] ?? 0));
  const rows: SettlementRow[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && (raw[sorted[j] as PlayerId] ?? 0) === (raw[sorted[i] as PlayerId] ?? 0)) j++;
    const share = rewards.slice(i, j).reduce((sum, r) => sum + r, 0) / (j - i);
    for (let k = i; k < j; k++) {
      const playerId = sorted[k] as PlayerId;
      rows.push({ playerId, raw: raw[playerId] ?? 0, rank: i + 1, tied: j - i > 1, tenths: Math.round(share) });
    }
    i = j;
  }
  const allTied = rows.every((r) => r.rank === 1);
  return {
    version: SCORING_VERSION,
    rows,
    note: allTied ? "所有人成绩相同，尚无可靠区分，按并列平分奖励。觉得不公平可以协商调整。" : null,
  };
}

/** Tenths → display text with at most one decimal, e.g. 85 → "8.5", 100 → "10", -5 → "-0.5". */
export const formatTenths = (tenths: number): string => (tenths / 10).toFixed(1).replace(/\.0$/, "");

/** Upper bound for a single adjustment item, as a safety limit rather than a product rule. */
export const MAX_ADJUST_TENTHS = 10_000;

/** Converts a human-entered point value to tenths; null when it is not a usable number. */
export function toTenths(points: unknown): number | null {
  if (typeof points !== "number" || !Number.isFinite(points)) return null;
  const tenths = Math.round(points * 10);
  if (tenths === 0 || Math.abs(tenths) > MAX_ADJUST_TENTHS) return null;
  return tenths;
}
