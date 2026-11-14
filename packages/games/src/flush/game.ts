/**
 * 「压牌出清」— play a card in front of you; a higher card knocks out weaker ones, whose
 * owners must draw. Equal cards team up. A card that survives a full round is discarded.
 * First to run out of cards wins. Pure rules. Rule spec: docs/games/flush.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const LOWEST = 2;
export const HIGHEST = 20;
export const COPIES = 3;
export const HAND = 6;
const POINTS_WIN = 3;

const configSchema = z.object({
  games: z.number().int().min(1).max(5).default(1),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play"), step: z.number().int(), card: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface FlushState {
  config: Config;
  game: number;
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: PlayerId[];
  hands: Record<PlayerId, number[]>;
  drawPile: number[];
  discard: number[];
  /** The card each player has in front of them, if any. */
  table: Record<PlayerId, number | null>;
  current: PlayerId;
  last: { playerId: PlayerId; card: number; knocked: PlayerId[] } | null;
  winner: PlayerId | null;
  deadlineAt: number | null;
}

export interface FlushView extends Omit<FlushState, "config" | "hands" | "drawPile" | "discard"> {
  totalGames: number;
  myHand: number[];
  handSizes: Record<PlayerId, number>;
  drawLeft: number;
}

/** A card's strength: its value times the number of equal cards on the table. */
export function strength(table: Record<PlayerId, number | null>, value: number): number {
  return value * Object.values(table).filter((v) => v === value).length;
}

function draw(state: FlushState, p: PlayerId) {
  if (state.drawPile.length === 0) return;
  (state.hands[p] as number[]).push(state.drawPile.shift() as number);
  (state.hands[p] as number[]).sort((a, b) => a - b);
}

function deal(state: FlushState, ctx: GameContext) {
  state.players = [...ctx.players];
  const deck = shuffle(
    Array.from({ length: (HIGHEST - LOWEST + 1) * COPIES }, (_, i) => LOWEST + Math.floor(i / COPIES)),
    ctx.random,
  );
  state.hands = Object.fromEntries(state.players.map((p) => [p, deck.splice(0, HAND).sort((a, b) => a - b)]));
  state.drawPile = deck;
  state.discard = [];
  state.table = Object.fromEntries(state.players.map((p) => [p, null]));
  state.current = state.players[(state.game - 1) % state.players.length] as PlayerId;
  state.last = null;
  state.winner = null;
  state.phase = "play";
  state.step += 1;
  beginTurn(state, ctx);
}

/** At the start of a turn your surviving card is discarded; with no cards left you win. */
function beginTurn(state: FlushState, ctx: GameContext): GameResult<FlushState> {
  const p = state.current;
  const survivor = state.table[p];
  if (survivor != null) {
    state.discard.push(survivor);
    state.table[p] = null;
  }
  if ((state.hands[p] ?? []).length === 0) {
    state.winner = p;
    state.phase = "gameOver";
    state.step += 1;
    state.deadlineAt = null;
    return {
      ok: true,
      state,
      scores: [{ playerId: p, points: POINTS_WIN, reason: "最先出清手牌", key: `g${state.game}:win` }],
    };
  }
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function play(state: FlushState, p: PlayerId, card: number, ctx: GameContext): GameResult<FlushState> {
  const hand = state.hands[p] as number[];
  hand.splice(hand.indexOf(card), 1);
  state.table[p] = card;
  const mine = strength(state.table, card);
  const knocked = state.players.filter((q) => {
    const v = state.table[q];
    return q !== p && v != null && v !== card && strength(state.table, v) < mine;
  });
  for (const q of knocked) {
    state.discard.push(state.table[q] as number);
    state.table[q] = null;
    draw(state, q);
  }
  state.last = { playerId: p, card, knocked };
  state.current = state.players[(state.players.indexOf(p) + 1) % state.players.length] as PlayerId;
  state.step += 1;
  return beginTurn(state, ctx);
}

export const flushGame = defineGame<FlushState, Action, FlushView, Config>({
  meta: {
    id: "flush",
    name: "压牌出清",
    description: "把牌打到面前，比你小的牌全被压掉、主人要摸牌；撑过一整圈的牌就能扔掉。先出清的人赢。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary: `牌是 ${LOWEST}–${HIGHEST}，每种 ${COPIES} 张，每人 ${HAND} 张。轮到你时：如果你面前还有牌（撑过了一圈），先把它扔掉；手里没牌了你就赢了。然后打一张牌到面前：桌上所有比它弱的牌被压掉，主人各摸一张。相同点数的牌会互相支援，强度 = 点数 × 桌上同点数的张数（同点数的牌不会互相压）。`,
    scoringSummary: `最先出清的玩家 +${POINTS_WIN} 分。`,
    options: [{ key: "games", label: "局数", min: 1, max: 5, default: 1 }, secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: FlushState = {
      config,
      game: 1,
      step: 0,
      phase: "play",
      players: [],
      hands: {},
      drawPile: [],
      discard: [],
      table: {},
      current: "",
      last: null,
      winner: null,
      deadlineAt: null,
    };
    deal(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    switch (action.type) {
      case "play": {
        if (state.phase !== "play") return { ok: false, error: "这一局已经结束" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (!(state.hands[me] ?? []).includes(action.card)) return { ok: false, error: "你没有这张牌" };
        return play(state, me, action.card, ctx);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.phase !== "gameOver") return { ok: false, error: "这一局还没结束" };
        if (state.game >= state.config.games || ctx.players.length < 3) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.game += 1;
        deal(state, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  // An absent player plays their lowest card.
  onTimeout: (state, ctx) =>
    state.phase === "play"
      ? play(state, state.current, (state.hands[state.current] as number[])[0] as number, ctx)
      : { ok: true, state },
  onResume(state, ctx) {
    if (state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const { config, hands, drawPile, discard, ...rest } = state;
    return {
      ...rest,
      totalGames: config.games,
      myHand: hands[viewer] ?? [],
      handSizes: Object.fromEntries(state.players.map((p) => [p, hands[p]?.length ?? 0])),
      drawLeft: drawPile.length,
    };
  },

  publicSummary(state) {
    return `压牌出清 第 ${state.game} 局，轮到出牌的人：${state.current}，阶段：${state.phase}（手牌未公开）`;
  },
});
