/**
 * 「别拿第六张」— pure-rules card game. Everyone picks a card at once; cards are placed on four
 * rows in ascending order; whoever would place a row's sixth card takes the row as penalty.
 * No content library, no AI. Rule spec: docs/games/rowcards.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const DECK_SIZE = 100;
export const HAND_SIZE = 10;
export const ROWS = 4;
export const ROW_LIMIT = 5;
export const POINTS_HAND_WIN = 3;

/** Penalty carried by a card. */
export function penaltyOf(card: number): number {
  if (card % 11 === 0) return 5;
  if (card % 10 === 0) return 3;
  if (card % 5 === 0) return 2;
  return 1;
}
const rowPenalty = (row: number[]) => row.reduce((sum, c) => sum + penaltyOf(c), 0);

const configSchema = z.object({
  hands: z.number().int().min(1).max(10).default(1),
  chooseSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play"), step: z.number().int(), card: z.number().int() }),
  /** Host: stop waiting (absent players play their lowest card) / deal the next hand. */
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface Placement {
  playerId: PlayerId;
  card: number;
  row: number;
  /** Cards the player had to take, if any. */
  took: number[] | null;
}

export interface RowCardsState {
  config: Config;
  hand: number;
  trick: number;
  step: number;
  phase: "choose" | "handOver" | "finished";
  players: PlayerId[];
  hands: Record<PlayerId, number[]>;
  rows: number[][];
  chosen: Record<PlayerId, number>;
  penalties: Record<PlayerId, number>;
  lastTrick: Placement[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface RowCardsView {
  hand: number;
  totalHands: number;
  trick: number;
  step: number;
  phase: RowCardsState["phase"];
  players: PlayerId[];
  rows: number[][];
  /** The viewer's own cards only. */
  myHand: number[];
  myCard: number | null;
  /** Who has picked a card this trick (not which). */
  submitted: PlayerId[];
  penalties: Record<PlayerId, number>;
  lastTrick: Placement[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

function deal(state: RowCardsState, ctx: GameContext) {
  const deck = shuffle(
    Array.from({ length: DECK_SIZE }, (_, i) => i + 1),
    ctx.random,
  );
  state.players = [...ctx.players];
  state.hands = {};
  for (const p of state.players) state.hands[p] = deck.splice(0, HAND_SIZE).sort((a, b) => a - b);
  state.rows = deck
    .splice(0, ROWS)
    .sort((a, b) => a - b)
    .map((c) => [c]);
  state.chosen = {};
  state.penalties = Object.fromEntries(state.players.map((p) => [p, 0]));
  state.lastTrick = [];
  state.winners = [];
  state.trick = 1;
  state.phase = "choose";
  state.step += 1;
  state.deadlineAt = timer(state.config.chooseSeconds, ctx);
}

function resolveTrick(state: RowCardsState, ctx: GameContext): GameResult<RowCardsState> {
  const plays = Object.entries(state.chosen)
    .map(([playerId, card]) => ({ playerId, card }))
    .sort((a, b) => a.card - b.card);
  state.lastTrick = [];
  for (const { playerId, card } of plays) {
    // Target: the row whose last card is the highest one still below this card.
    let target = -1;
    state.rows.forEach((row, i) => {
      const last = row.at(-1) as number;
      if (last < card && (target === -1 || last > (state.rows[target]?.at(-1) as number))) target = i;
    });
    let took: number[] | null = null;
    if (target === -1) {
      // Lower than every row: the player takes the cheapest row (first one on ties).
      target = 0;
      state.rows.forEach((row, i) => {
        if (rowPenalty(row) < rowPenalty(state.rows[target] as number[])) target = i;
      });
      took = state.rows[target] as number[];
      state.rows[target] = [card];
    } else if ((state.rows[target] as number[]).length >= ROW_LIMIT) {
      took = state.rows[target] as number[];
      state.rows[target] = [card];
    } else {
      (state.rows[target] as number[]).push(card);
    }
    if (took) state.penalties[playerId] = (state.penalties[playerId] ?? 0) + rowPenalty(took);
    state.hands[playerId] = (state.hands[playerId] ?? []).filter((c) => c !== card);
    state.lastTrick.push({ playerId, card, row: target, took });
  }
  state.chosen = {};
  state.step += 1;

  if (state.players.some((p) => (state.hands[p] ?? []).length > 0)) {
    state.trick += 1;
    state.deadlineAt = timer(state.config.chooseSeconds, ctx);
    return { ok: true, state };
  }
  state.phase = "handOver";
  state.deadlineAt = null;
  const best = Math.min(...state.players.map((p) => state.penalties[p] ?? 0));
  state.winners = state.players.filter((p) => (state.penalties[p] ?? 0) === best);
  const scores: ScoreAward[] = state.winners.map((p) => ({
    playerId: p,
    points: POINTS_HAND_WIN,
    reason: "罚分最少",
    key: `h${state.hand}:win:${p}`,
  }));
  return { ok: true, state, scores };
}

/** Absent players play their lowest card so nobody can stall the table. */
function forceTrick(state: RowCardsState, ctx: GameContext): GameResult<RowCardsState> {
  for (const p of state.players) {
    const lowest = (state.hands[p] ?? [])[0];
    if (!(p in state.chosen) && lowest !== undefined) state.chosen[p] = lowest;
  }
  return resolveTrick(state, ctx);
}

export const rowCardsGame = defineGame<RowCardsState, Action, RowCardsView, Config>({
  meta: {
    id: "rowcards",
    name: "别拿第六张",
    description:
      "纯规则卡牌：所有人同时出牌，按大小依次接到四行牌的末尾——谁放下某一行的第六张，谁就把那一行收走吃罚分。",
    minPlayers: 2,
    maxPlayers: 8,
    rulesSummary: `牌是 1–${DECK_SIZE} 的数字，每人 ${HAND_SIZE} 张，桌上 ${ROWS} 行各 1 张起始牌。每墩所有人同时暗出一张，然后从小到大依次放置：放到「末尾牌比它小且最接近」的那一行；如果那一行已有 ${ROW_LIMIT} 张，你收走这 ${ROW_LIMIT} 张，你的牌成为该行新的第一张；如果你的牌比所有行的末尾都小，你收走罚分最少的一行。每张牌的罚分：11 的倍数 5 分，10 的倍数 3 分，5 的倍数 2 分，其余 1 分。${HAND_SIZE} 墩打完一局。本游戏不使用题库，也不能投票跳过。`,
    scoringSummary: `每局罚分最少的玩家 +${POINTS_HAND_WIN} 分（并列都得）。罚分只在局内比较，不计入聚会积分。`,
    options: [
      { key: "hands", label: "局数", min: 1, max: 10, default: 1 },
      secondsOption("chooseSeconds", "出牌时限", 45),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 2) return { ok: false, error: "至少需要 2 名玩家" };
    const state: RowCardsState = {
      config,
      hand: 1,
      trick: 1,
      step: 0,
      phase: "choose",
      players: [],
      hands: {},
      rows: [],
      chosen: {},
      penalties: {},
      lastTrick: [],
      winners: [],
      deadlineAt: null,
    };
    deal(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的一墩" };
    const me = actor.playerId;
    switch (action.type) {
      case "play": {
        if (state.phase !== "choose") return { ok: false, error: "现在不能出牌" };
        if (!state.players.includes(me)) return { ok: false, error: "你将从下一局开始参与" };
        if (me in state.chosen) return { ok: false, error: "这一墩你已经出过牌了" };
        if (!(state.hands[me] ?? []).includes(action.card)) return { ok: false, error: "你手里没有这张牌" };
        state.chosen[me] = action.card;
        return state.players.every((p) => p in state.chosen) ? resolveTrick(state, ctx) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "choose") return forceTrick(state, ctx);
        if (state.hand >= state.config.hands || ctx.players.length < 2) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.hand += 1;
        deal(state, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "handOver",
  deadline: (state) => (state.phase === "choose" ? state.deadlineAt : null),
  onTimeout: (state, ctx) => (state.phase === "choose" ? forceTrick(state, ctx) : { ok: true, state }),
  onResume(state, ctx) {
    if (state.phase === "choose") state.deadlineAt = timer(state.config.chooseSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    return {
      hand: state.hand,
      totalHands: state.config.hands,
      trick: state.trick,
      step: state.step,
      phase: state.phase,
      players: state.players,
      rows: state.rows,
      myHand: state.hands[viewer] ?? [],
      myCard: state.chosen[viewer] ?? null,
      submitted: Object.keys(state.chosen),
      penalties: state.penalties,
      lastTrick: state.lastTrick,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    return `别拿第六张 第 ${state.hand} 局第 ${state.trick} 墩，阶段：${state.phase}，已出牌 ${Object.keys(state.chosen).length}/${state.players.length} 人（手牌与本墩暗出的牌未公开）`;
  },
});
