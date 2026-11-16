/**
 * 「贪心登顶」— roll four dice, split them into two pairs, and push up to three climbers up the
 * columns of the two sums. Stop to bank the progress, or roll again and risk losing all of it.
 * Pure rules; no content, no AI, no hidden information. Rule spec: docs/games/climb.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, timer } from "../util.ts";

export const COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/** Steps to the top: the likelier the sum, the longer the column. */
export const heightOf = (column: number) => 13 - 2 * Math.abs(7 - column);
export const CLIMBERS = 3;
export const COLUMNS_TO_WIN = 3;
const POINTS_WIN = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const configSchema = z.object({
  games: z.number().int().min(1).max(5).default(1),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll"), step: z.number().int() }),
  z.object({ type: z.literal("move"), option: z.number().int().min(0), step: z.number().int() }),
  z.object({ type: z.literal("stop"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

/** One way to use a roll: the columns to advance, in order (a column twice = two steps). */
export type MoveOption = number[];

export interface ClimbState {
  config: Config;
  game: number;
  step: number;
  /** decide: roll (or stop). move: pick how to use the dice. */
  phase: "decide" | "move" | "gameOver" | "finished";
  players: PlayerId[];
  current: PlayerId;
  /** Banked height per player per column. */
  saved: Record<PlayerId, Record<number, number>>;
  /** This turn's climbers: column → height reached (not banked yet). */
  climbers: Record<number, number>;
  /** Columns that are finished, and by whom. */
  claimed: Record<number, PlayerId>;
  dice: number[] | null;
  options: MoveOption[];
  /** What happened last, for the table to read out. */
  last: { by: PlayerId; kind: "bust" | "stop" | "roll" | "move"; dice?: number[]; columns?: number[] } | null;
  winners: PlayerId[];
  deadlineAt: number | null;
}

export type ClimbView = Omit<ClimbState, "config"> & { totalGames: number; heights: Record<number, number> };

const usable = (state: ClimbState, climbers: Record<number, number>, column: number) => {
  if (state.claimed[column] !== undefined) return false;
  const at = climbers[column];
  if (at !== undefined) return at < heightOf(column);
  return Object.keys(climbers).length < CLIMBERS;
};

const advance = (state: ClimbState, climbers: Record<number, number>, column: number) => {
  const from = climbers[column] ?? state.saved[state.current]?.[column] ?? 0;
  climbers[column] = Math.min(heightOf(column), from + 1);
};

/** Every distinct legal way to use four dice. Both sums of a pairing must be used when possible. */
export function optionsFor(state: ClimbState, dice: number[]): MoveOption[] {
  const [a, b, c, d] = dice as [number, number, number, number];
  const out = new Map<string, MoveOption>();
  const add = (columns: MoveOption) => out.set([...columns].sort((x, y) => x - y).join("+"), columns);
  for (const [first, second] of [
    [a + b, c + d],
    [a + c, b + d],
    [a + d, b + c],
  ] as [number, number][]) {
    const both = (x: number, y: number) => {
      if (!usable(state, state.climbers, x)) return false;
      const trial = { ...state.climbers };
      advance(state, trial, x);
      return usable(state, trial, y);
    };
    if (both(first, second) || both(second, first)) add([first, second]);
    else {
      if (usable(state, state.climbers, first)) add([first]);
      if (usable(state, state.climbers, second)) add([second]);
    }
  }
  return [...out.values()];
}

function startTurn(state: ClimbState, player: PlayerId, ctx: GameContext) {
  state.current = player;
  state.climbers = {};
  state.dice = null;
  state.options = [];
  state.phase = "decide";
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function deal(state: ClimbState, ctx: GameContext) {
  state.players = [...ctx.players];
  state.saved = Object.fromEntries(state.players.map((p) => [p, {}]));
  state.claimed = {};
  state.winners = [];
  state.last = null;
  state.step += 1;
  startTurn(state, state.players[(state.game - 1) % state.players.length] as PlayerId, ctx);
}

const nextPlayer = (state: ClimbState) =>
  state.players[(state.players.indexOf(state.current) + 1) % state.players.length] as PlayerId;

function roll(state: ClimbState, ctx: GameContext): GameResult<ClimbState> {
  const dice = Array.from({ length: 4 }, () => 1 + Math.floor(ctx.random() * 6));
  state.step += 1;
  state.dice = dice;
  state.options = optionsFor(state, dice);
  if (state.options.length === 0) {
    // Nothing fits: this turn's climbers are lost.
    state.last = { by: state.current, kind: "bust", dice };
    startTurn(state, nextPlayer(state), ctx);
    state.dice = dice;
    return { ok: true, state };
  }
  state.last = { by: state.current, kind: "roll", dice };
  state.phase = "move";
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function move(state: ClimbState, option: number, ctx: GameContext): GameResult<ClimbState> {
  const columns = state.options[option];
  if (!columns) return { ok: false, error: "没有这个走法" };
  for (const column of columns) advance(state, state.climbers, column);
  state.last = { by: state.current, kind: "move", dice: state.dice ?? undefined, columns };
  state.options = [];
  state.phase = "decide";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function stop(state: ClimbState, ctx: GameContext): GameResult<ClimbState> {
  const me = state.current;
  const mine = state.saved[me] as Record<number, number>;
  const topped: number[] = [];
  for (const [key, height] of Object.entries(state.climbers)) {
    const column = Number(key);
    mine[column] = height;
    if (height >= heightOf(column)) {
      state.claimed[column] = me;
      topped.push(column);
    }
  }
  state.last = { by: me, kind: "stop", columns: topped };
  state.step += 1;
  const count = Object.values(state.claimed).filter((p) => p === me).length;
  if (count >= COLUMNS_TO_WIN) {
    state.phase = "gameOver";
    state.climbers = {};
    state.dice = null;
    state.deadlineAt = null;
    state.winners = [me];
    const scores: ScoreAward[] = [
      { playerId: me, points: POINTS_WIN, reason: "先登顶三列", key: `g${state.game}:win:${me}` },
    ];
    return { ok: true, state, scores };
  }
  startTurn(state, nextPlayer(state), ctx);
  return { ok: true, state };
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const climbGame = defineGame<ClimbState, Action, ClimbView, Config>({
  meta: {
    id: "climb",
    name: "贪心登顶",
    description: "掷四颗骰子，两两相加，往上爬。见好就收能保住进度；再掷一次，可能更高，也可能这回合白爬。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `棋盘有 2–12 共十一列，越靠中间越长（7 那列 13 步，2 和 12 只有 3 步）。轮到你时掷四颗骰子，自己分成两对，两对的和就是可以前进的两列。每回合最多同时爬 ${CLIMBERS} 列。每次前进之后选一样：停下，把这回合的进度存下来；或者再掷。如果掷出来的骰子怎么分都走不了，这回合爬的全部作废。谁停下时到了某一列的顶，这一列就归谁，别人不能再走。先拿下 ${COLUMNS_TO_WIN} 列的人赢。`,
    scoringSummary: `先拿下 ${COLUMNS_TO_WIN} 列的玩家 +${POINTS_WIN} 分。`,
    options: [{ key: "games", label: "局数", min: 1, max: 5, default: 1 }, secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: ClimbState = {
      config,
      game: 1,
      step: 0,
      phase: "decide",
      players: [],
      current: "",
      saved: {},
      climbers: {},
      claimed: {},
      dice: null,
      options: [],
      last: null,
      winners: [],
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
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
      if (state.phase !== "gameOver") return { ok: false, error: "这一局还没结束" };
      if (state.game >= state.config.games || !countOk(ctx.players.length)) {
        state.phase = "finished";
        state.step += 1;
        return { ok: true, state, finished: true };
      }
      state.game += 1;
      deal(state, ctx);
      return { ok: true, state };
    }
    if (state.phase === "gameOver") return { ok: false, error: "这一局已经结束" };
    if (me !== state.current) return { ok: false, error: "还没轮到你" };
    switch (action.type) {
      case "roll":
        if (state.phase !== "decide") return { ok: false, error: "先决定怎么用这次的骰子" };
        return roll(state, ctx);
      case "move":
        if (state.phase !== "move") return { ok: false, error: "先掷骰子" };
        return move(state, action.option, ctx);
      case "stop":
        if (state.phase !== "decide") return { ok: false, error: "先决定怎么用这次的骰子" };
        if (Object.keys(state.climbers).length === 0) return { ok: false, error: "还没爬就停下？先掷一次" };
        return stop(state, ctx);
    }
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "decide" || state.phase === "move" ? state.deadlineAt : null),
  // An absent player takes the first way to use the dice, then banks; with nothing to bank they roll once.
  onTimeout(state, ctx) {
    if (state.phase === "move") return move(state, 0, ctx);
    if (state.phase !== "decide") return { ok: true, state };
    return Object.keys(state.climbers).length > 0 ? stop(state, ctx) : roll(state, ctx);
  },
  onResume(state, ctx) {
    if (state.phase === "decide" || state.phase === "move") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state) {
    const { config, ...rest } = state;
    return { ...rest, totalGames: config.games, heights: Object.fromEntries(COLUMNS.map((c) => [c, heightOf(c)])) };
  },

  publicSummary(state) {
    const held = state.players
      .map((p) => `${p} ${Object.values(state.claimed).filter((q) => q === p).length} 列`)
      .join("，");
    return `贪心登顶 第 ${state.game} 局，阶段：${state.phase}，轮到 ${state.current}；已拿下：${held}`;
  },
});
