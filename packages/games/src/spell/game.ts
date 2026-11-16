/**
 * 「盲念咒语」— everyone can see your spell stones except you. Call a number: if you hold that
 * stone the spell goes off, if not you get hurt. Keep calling equal or higher numbers, or stop.
 * Pure rules; no content, no AI. Rule spec: docs/games/spell.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const SPELL_LIFE = 6;
export const SPELL_HAND = 5;
export const SPELL_SECRET = 4;
/** Stones shown face up at the start, so small tables have something to count from. */
export const revealedAtStart = (players: number) => (players === 2 ? 12 : players === 3 ? 6 : 0);
const POINTS_WIN = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const LOG_SIZE = 6;

/** Number n has n stones: 36 in all. */
export const allStones = () => Array.from({ length: 8 }, (_, i) => Array<number>(i + 1).fill(i + 1)).flat();

const configSchema = z.object({
  target: z.number().int().min(3).max(15).default(8),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cast"), number: z.number().int().min(1).max(8), step: z.number().int() }),
  z.object({ type: z.literal("end"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SpellEvent {
  by: PlayerId;
  number: number;
  hit: boolean;
  /** The die, for the spells (and the failure) that roll it. */
  roll?: number;
}

export interface SpellState {
  config: Config;
  round: number;
  step: number;
  phase: "play" | "roundOver" | "gameOver" | "finished";
  players: PlayerId[];
  current: PlayerId;
  life: Record<PlayerId, number>;
  /** Each player's stones. Hidden from the player who holds them. */
  hands: Record<PlayerId, number[]>;
  supply: number[];
  /** Stones nobody has seen; spell 4 lets its caster take one. */
  secret: number[];
  taken: Record<PlayerId, number[]>;
  /** Stones face up on the board: how many of each number are out. */
  board: Record<number, number>;
  /** The lowest number that may be called next this turn (0 = any). */
  floor: number;
  casts: number;
  points: Record<PlayerId, number>;
  /** Points handed out by the round just finished. */
  gained: Record<PlayerId, number> | null;
  /** Who ended the round, if it was not ended by that player's own fall. */
  roundWinner: PlayerId | null;
  log: SpellEvent[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface SpellView {
  round: number;
  step: number;
  phase: SpellState["phase"];
  target: number;
  players: PlayerId[];
  current: PlayerId;
  life: Record<PlayerId, number>;
  /** Everyone else's stones; the viewer's own are replaced by a count. */
  hands: Record<PlayerId, number[]>;
  myCount: number | null;
  supplyLeft: number;
  secretLeft: number;
  /** The secret stones the viewer took, and how many each other player took. */
  myTaken: number[];
  takenCount: Record<PlayerId, number>;
  board: Record<number, number>;
  floor: number;
  casts: number;
  points: Record<PlayerId, number>;
  gained: Record<PlayerId, number> | null;
  roundWinner: PlayerId | null;
  log: SpellEvent[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

const die = (ctx: GameContext) => 1 + Math.floor(ctx.random() * 3);
const seat = (state: SpellState, from: PlayerId, offset: number) =>
  state.players[(state.players.indexOf(from) + offset + state.players.length) % state.players.length] as PlayerId;
const hurt = (state: SpellState, p: PlayerId, amount: number) => {
  state.life[p] = Math.max(0, (state.life[p] ?? 0) - amount);
};
const heal = (state: SpellState, p: PlayerId, amount: number) => {
  state.life[p] = Math.min(SPELL_LIFE, (state.life[p] ?? 0) + amount);
};

/** The eight spells. Left is the next player in turn order, right the previous one. */
function effect(state: SpellState, me: PlayerId, number: number, ctx: GameContext): number | undefined {
  const others = state.players.filter((p) => p !== me);
  switch (number) {
    case 1: {
      const roll = die(ctx);
      for (const p of others) hurt(state, p, roll);
      return roll;
    }
    case 2:
      for (const p of others) hurt(state, p, 1);
      heal(state, me, 1);
      return;
    case 3: {
      const roll = die(ctx);
      heal(state, me, roll);
      return roll;
    }
    case 4: {
      const stone = state.secret.shift();
      if (stone !== undefined) (state.taken[me] as number[]).push(stone);
      return;
    }
    case 5:
      for (const p of new Set([seat(state, me, 1), seat(state, me, -1)])) if (p !== me) hurt(state, p, 1);
      return;
    case 6:
      if (seat(state, me, 1) !== me) hurt(state, seat(state, me, 1), 1);
      return;
    case 7:
      if (seat(state, me, -1) !== me) hurt(state, seat(state, me, -1), 1);
      return;
    case 8:
      heal(state, me, 1);
      return;
  }
}

function refill(state: SpellState, p: PlayerId) {
  const hand = state.hands[p] as number[];
  while (hand.length < SPELL_HAND && state.supply.length > 0) hand.push(state.supply.shift() as number);
}

function startTurn(state: SpellState, p: PlayerId, ctx: GameContext) {
  state.current = p;
  state.floor = 0;
  state.casts = 0;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function deal(state: SpellState, ctx: GameContext) {
  state.players = [...ctx.players];
  const stones = shuffle(allStones(), ctx.random);
  state.secret = stones.splice(0, SPELL_SECRET);
  state.board = {};
  for (const stone of stones.splice(0, revealedAtStart(state.players.length))) {
    state.board[stone] = (state.board[stone] ?? 0) + 1;
  }
  state.hands = Object.fromEntries(state.players.map((p) => [p, stones.splice(0, SPELL_HAND)]));
  state.supply = stones;
  state.taken = Object.fromEntries(state.players.map((p) => [p, []]));
  state.life = Object.fromEntries(state.players.map((p) => [p, SPELL_LIFE]));
  for (const p of state.players) state.points[p] ??= 0;
  state.gained = null;
  state.roundWinner = null;
  state.winners = [];
  state.log = [];
  state.phase = "play";
  state.step += 1;
  startTurn(state, state.players[(state.round - 1) % state.players.length] as PlayerId, ctx);
}

/** Survivors get a point (three for whoever ended the round) plus one per secret stone taken. */
function endRound(state: SpellState, by: PlayerId, cleared: boolean): GameResult<SpellState> {
  if (cleared) for (const p of state.players) if (p !== by) state.life[p] = 0;
  const alive = (p: PlayerId) => (state.life[p] ?? 0) > 0;
  state.roundWinner = alive(by) ? by : null;
  state.gained = Object.fromEntries(
    state.players.map((p) => [p, alive(p) ? (p === by ? 3 : 1) + (state.taken[p]?.length ?? 0) : 0]),
  );
  for (const p of state.players) state.points[p] = (state.points[p] ?? 0) + (state.gained[p] ?? 0);
  state.deadlineAt = null;
  state.step += 1;
  const best = Math.max(...state.players.map((p) => state.points[p] ?? 0));
  if (best < state.config.target) {
    state.phase = "roundOver";
    return { ok: true, state };
  }
  state.phase = "gameOver";
  state.winners = state.players.filter((p) => state.points[p] === best);
  const scores: ScoreAward[] = state.winners.map((p) => ({
    playerId: p,
    points: POINTS_WIN,
    reason: "先到目标分",
    key: `win:${p}`,
  }));
  return { ok: true, state, scores };
}

function pass(state: SpellState, ctx: GameContext): GameResult<SpellState> {
  refill(state, state.current);
  state.step += 1;
  startTurn(state, seat(state, state.current, 1), ctx);
  return { ok: true, state };
}

function cast(state: SpellState, number: number, ctx: GameContext): GameResult<SpellState> {
  const me = state.current;
  const hand = state.hands[me] as number[];
  const index = hand.indexOf(number);
  if (index < 0) {
    // A wrong call hurts; calling the dragon wrongly hurts as much as the dragon would.
    const roll = number === 1 ? die(ctx) : undefined;
    hurt(state, me, roll ?? 1);
    state.log = [...state.log, { by: me, number, hit: false, ...(roll ? { roll } : {}) }].slice(-LOG_SIZE);
    if ((state.life[me] ?? 0) <= 0) return endRound(state, me, false);
    return pass(state, ctx);
  }
  hand.splice(index, 1);
  state.board[number] = (state.board[number] ?? 0) + 1;
  const roll = effect(state, me, number, ctx);
  state.log = [...state.log, { by: me, number, hit: true, ...(roll ? { roll } : {}) }].slice(-LOG_SIZE);
  state.floor = number;
  state.casts += 1;
  if (state.players.some((p) => (state.life[p] ?? 0) <= 0)) return endRound(state, me, false);
  if (hand.length === 0) return endRound(state, me, true);
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;
const over = (state: SpellState) => state.phase === "roundOver" || state.phase === "gameOver";

export const spellGame = defineGame<SpellState, Action, SpellView, Config>({
  meta: {
    id: "spell",
    name: "盲念咒语",
    description:
      "每个人面前五块咒语石，只有自己看不到。喊一个数字：有，咒语生效；没有，自己掉血。全靠看别人的石头推理自己的。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `咒语石共 36 块：数字几就有几块（1 只有一块，8 有八块）。每人面前 ${SPELL_HAND} 块，自己看不到，别人都看得到；另有 ${SPELL_SECRET} 块谁也没见过的秘密石。每人 ${SPELL_LIFE} 点生命。轮到你时喊一个数字：你面前有这块石头，它被移到桌面并发动咒语，你可以接着喊不小于它的数字，或者收手；没有，你掉 1 点生命（喊 1 喊错则掷骰掉血），回合结束。回合结束时把石头补回 ${SPELL_HAND} 块。咒语：1 古龙——掷骰（1–3），其他人各掉这么多；2 夜行者——其他人各掉 1，你回 1；3 美梦——掷骰，你回这么多；4 夜莺——拿走一块秘密石，只有你知道是几；5 雷暴——左右两人各掉 1；6 暴雪——下家掉 1；7 火球——上家掉 1；8 药水——你回 1。有人生命归零，或有人把面前的石头全部喊完，这一轮结束。`,
    scoringSummary: `每轮：活着的人各得 1 分，结束这一轮的人改得 3 分（把自己喊死的不算），活着的人每拿过一块秘密石再加 1 分。先到目标分的玩家 +${POINTS_WIN} 分（并列都得）。`,
    options: [
      { key: "target", label: "目标分", min: 3, max: 15, default: 8 },
      secondsOption("turnSeconds", "每步时限", 0),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: SpellState = {
      config,
      round: 1,
      step: 0,
      phase: "play",
      players: [],
      current: "",
      life: {},
      hands: {},
      supply: [],
      secret: [],
      taken: {},
      board: {},
      floor: 0,
      casts: 0,
      points: {},
      gained: null,
      roundWinner: null,
      log: [],
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
      if (!over(state)) return { ok: false, error: "这一轮还没结束" };
      if (state.phase === "gameOver" || !countOk(ctx.players.length)) {
        state.phase = "finished";
        state.step += 1;
        return { ok: true, state, finished: true };
      }
      state.round += 1;
      deal(state, ctx);
      return { ok: true, state };
    }
    if (state.phase !== "play") return { ok: false, error: "这一轮已经结束" };
    if (me !== state.current) return { ok: false, error: "还没轮到你" };
    if (action.type === "end") {
      if (state.casts === 0) return { ok: false, error: "至少要喊一次咒语" };
      return pass(state, ctx);
    }
    if (action.number < state.floor) return { ok: false, error: `接下来只能喊 ${state.floor} 或更大的数字` };
    return cast(state, action.number, ctx);
  },

  atSafePoint: (state) => over(state),
  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  // An absent player stops if they may; otherwise they call 8, the commonest stone.
  onTimeout: (state, ctx) =>
    state.phase !== "play" ? { ok: true, state } : state.casts > 0 ? pass(state, ctx) : cast(state, 8, ctx),
  onResume(state, ctx) {
    if (state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    // Once a round is over the stones no longer matter, so everyone may see their own.
    const open = state.phase !== "play";
    return {
      round: state.round,
      step: state.step,
      phase: state.phase,
      target: state.config.target,
      players: state.players,
      current: state.current,
      life: state.life,
      hands: Object.fromEntries(Object.entries(state.hands).filter(([p]) => open || p !== viewer)),
      myCount: state.hands[viewer]?.length ?? null,
      supplyLeft: state.supply.length,
      secretLeft: state.secret.length,
      myTaken: state.taken[viewer] ?? [],
      takenCount: Object.fromEntries(state.players.map((p) => [p, state.taken[p]?.length ?? 0])),
      board: state.board,
      floor: state.floor,
      casts: state.casts,
      points: state.points,
      gained: state.gained,
      roundWinner: state.roundWinner,
      log: state.log,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const life = state.players.map((p) => `${p} ${state.life[p]} 命 ${state.points[p] ?? 0} 分`).join("，");
    return `盲念咒语 第 ${state.round} 轮，阶段：${state.phase}，轮到 ${state.current}；${life}（各人面前的石头和秘密石不公开）`;
  },
});
