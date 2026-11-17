/**
 * 「吹牛骰子」— everyone shakes five dice under a cup. Bids go up ("five 4s") until somebody
 * calls the last one a lie; then all the dice are counted. The traditional bar game.
 * Pure rules; no content, no AI. Rule spec: docs/games/liar.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { roundsOption, secondsOption, timer } from "../util.ts";

export const LIAR_DICE = 5;
const POINTS_WIN = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

const configSchema = z.object({
  rounds: z.number().int().min(0).max(30).default(8),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bid"),
    quantity: z.number().int().min(1),
    face: z.number().int().min(1).max(6),
    step: z.number().int(),
  }),
  z.object({ type: z.literal("open"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
  z.object({ type: z.literal("end"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface LiarBid {
  by: PlayerId;
  quantity: number;
  face: number;
}

export interface LiarState {
  config: Config;
  round: number;
  step: number;
  phase: "bid" | "reveal" | "finished";
  players: PlayerId[];
  current: PlayerId;
  /** Each player's dice; only theirs to see until the cups are lifted. */
  dice: Record<PlayerId, number[]>;
  bid: LiarBid | null;
  history: LiarBid[];
  /** 1s count as any face until somebody bids on 1s. */
  onesWild: boolean;
  /** How the round ended. */
  result: { opener: PlayerId; bid: LiarBid; count: number; loser: PlayerId } | null;
  /** Rounds lost per player. Fewest wins. */
  losses: Record<PlayerId, number>;
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface LiarView {
  round: number;
  totalRounds: number;
  step: number;
  phase: LiarState["phase"];
  players: PlayerId[];
  current: PlayerId;
  myDice: number[] | null;
  /** Everyone's dice, only once the cups are lifted. */
  dice: Record<PlayerId, number[]> | null;
  totalDice: number;
  minOpening: number;
  bid: LiarBid | null;
  history: LiarBid[];
  onesWild: boolean;
  result: LiarState["result"];
  losses: Record<PlayerId, number>;
  winners: PlayerId[];
  deadlineAt: number | null;
}

/** Faces rank 2 < 3 < 4 < 5 < 6 < 1 when the quantity stays the same. */
const rank = (face: number) => (face === 1 ? 7 : face);
export const liarRaises = (prev: LiarBid | null, quantity: number, face: number, players: number) =>
  prev ? quantity > prev.quantity || (quantity === prev.quantity && rank(face) > rank(prev.face)) : quantity >= players;
export function liarCount(dice: Record<PlayerId, number[]>, face: number, onesWild: boolean): number {
  return Object.values(dice)
    .flat()
    .filter((d) => d === face || (onesWild && face !== 1 && d === 1)).length;
}

function shake(state: LiarState, starter: PlayerId, ctx: GameContext) {
  state.players = [...ctx.players];
  state.dice = Object.fromEntries(
    state.players.map((p) => [p, Array.from({ length: LIAR_DICE }, () => 1 + Math.floor(ctx.random() * 6)).sort()]),
  );
  for (const p of state.players) state.losses[p] ??= 0;
  state.bid = null;
  state.history = [];
  state.onesWild = true;
  state.result = null;
  state.current = state.players.includes(starter) ? starter : (state.players[0] as PlayerId);
  state.phase = "bid";
  state.round += 1;
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function bid(state: LiarState, me: PlayerId, quantity: number, face: number, ctx: GameContext): GameResult<LiarState> {
  const total = state.players.length * LIAR_DICE;
  if (quantity > total) return { ok: false, error: `桌上一共只有 ${total} 颗骰子` };
  if (!liarRaises(state.bid, quantity, face, state.players.length)) {
    return {
      ok: false,
      error: state.bid ? "要比上家叫得大：个数更多，或者个数一样、点数更大" : `起叫至少 ${state.players.length} 个`,
    };
  }
  state.bid = { by: me, quantity, face };
  state.history.push(state.bid);
  if (face === 1) state.onesWild = false;
  state.current = state.players[(state.players.indexOf(me) + 1) % state.players.length] as PlayerId;
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function open(state: LiarState, me: PlayerId): GameResult<LiarState> {
  const called = state.bid as LiarBid;
  const count = liarCount(state.dice, called.face, state.onesWild);
  const loser = count >= called.quantity ? me : called.by;
  state.losses[loser] = (state.losses[loser] ?? 0) + 1;
  state.result = { opener: me, bid: called, count, loser };
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

function finish(state: LiarState): GameResult<LiarState> {
  state.phase = "finished";
  state.step += 1;
  const fewest = Math.min(...state.players.map((p) => state.losses[p] ?? 0));
  state.winners = state.players.filter((p) => (state.losses[p] ?? 0) === fewest);
  const scores: ScoreAward[] = state.winners.map((p) => ({
    playerId: p,
    points: POINTS_WIN,
    reason: "输得最少",
    key: `win:${p}`,
  }));
  return { ok: true, state, finished: true, scores };
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const liarGame = defineGame<LiarState, Action, LiarView, Config>({
  meta: {
    id: "liar",
    name: "吹牛骰子",
    description:
      "每人五颗骰子扣在杯子里，只看得到自己的。轮流往上叫「几个几」，觉得上家在吹牛就开——数一数全桌的骰子，看谁输。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `每人 ${LIAR_DICE} 颗骰子，只有自己看得到。从上一轮输的人开始，轮流叫「几个几」，意思是全桌所有骰子里至少有这么多个这个点数。起叫的个数不能少于人数。之后每次都要比上家大：个数更多；或者个数一样、点数更大（2 < 3 < 4 < 5 < 6 < 1）。1 点是万能的，可以当任何点数——但只要有人叫了 1，这一轮 1 就不再万能。不想往上叫，就「开」上家：全桌亮骰子，够数则开的人输，不够则被开的人输。`,
    scoringSummary: `打完所有轮后，输的轮数最少的玩家 +${POINTS_WIN} 分（并列都得）。`,
    options: [roundsOption(8), secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: LiarState = {
      config,
      round: 0,
      step: 0,
      phase: "bid",
      players: [],
      current: "",
      dice: {},
      bid: null,
      history: [],
      onesWild: true,
      result: null,
      losses: {},
      winners: [],
      deadlineAt: null,
    };
    shake(state, ctx.players[0] as PlayerId, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    switch (action.type) {
      case "bid":
        if (state.phase !== "bid") return { ok: false, error: "这一轮已经开了" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        return bid(state, me, action.quantity, action.face, ctx);
      case "open":
        if (state.phase !== "bid") return { ok: false, error: "这一轮已经开了" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (!state.bid) return { ok: false, error: "还没有人叫，没法开" };
        return open(state, me);
      case "next":
      case "end": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.phase !== "reveal") return { ok: false, error: "这一轮还没开" };
        const last = state.config.rounds > 0 && state.round >= state.config.rounds;
        if (action.type === "end" || last || !countOk(ctx.players.length)) return finish(state);
        shake(state, state.result?.loser ?? state.current, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "reveal",
  deadline: (state) => (state.phase === "bid" ? state.deadlineAt : null),
  // An absent player opens the bid in front of them, or makes the lowest opening bid.
  onTimeout(state, ctx) {
    if (state.phase !== "bid") return { ok: true, state };
    return state.bid ? open(state, state.current) : bid(state, state.current, state.players.length, 2, ctx);
  },
  onResume(state, ctx) {
    if (state.phase === "bid") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      players: state.players,
      current: state.current,
      myDice: state.dice[viewer] ?? null,
      dice: state.phase === "bid" ? null : state.dice,
      totalDice: state.players.length * LIAR_DICE,
      minOpening: state.players.length,
      bid: state.bid,
      history: state.history,
      onesWild: state.onesWild,
      result: state.result,
      losses: state.losses,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const called = state.bid ? `当前叫到 ${state.bid.quantity} 个 ${state.bid.face}` : "还没人叫";
    const losses = state.players.map((p) => `${p} 输 ${state.losses[p] ?? 0}`).join("，");
    return `吹牛骰子 第 ${state.round} 轮，阶段：${state.phase}，${called}；${losses}（各人的骰子未公开）`;
  },
});
