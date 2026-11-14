/**
 * 「翻牌诈唬」— everyone stacks face-down discs (flowers and one skull), then bids how many
 * flowers they can flip without hitting a skull. Pure rules. Rule spec: docs/games/skull.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId } from "@apr/shared";
import { z } from "zod";
import { secondsOption, timer } from "../util.ts";

export type Disc = "flower" | "skull";
export const WINS_NEEDED = 2;
const POINTS_WIN = 3;

const configSchema = z.object({ turnSeconds: z.number().int().min(0).max(600).default(0) });
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), step: z.number().int(), disc: z.enum(["flower", "skull"]) }),
  z.object({ type: z.literal("bid"), step: z.number().int(), value: z.number().int().min(1) }),
  z.object({ type: z.literal("pass"), step: z.number().int() }),
  z.object({ type: z.literal("flip"), step: z.number().int(), owner: z.string() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SkullState {
  config: Config;
  round: number;
  step: number;
  /** setup: everyone lays a first disc at once; turns: add or bid; bidding; flipping; roundOver. */
  phase: "setup" | "turns" | "bidding" | "flipping" | "roundOver" | "finished";
  players: PlayerId[];
  /** Discs each player still owns. */
  owned: Record<PlayerId, { flowers: number; skull: boolean }>;
  /** Face-down stacks, bottom first. Secret except to the owner. */
  stacks: Record<PlayerId, Disc[]>;
  current: PlayerId;
  bid: { player: PlayerId; value: number } | null;
  passed: PlayerId[];
  flipped: { owner: PlayerId; disc: Disc }[];
  result: { challenger: PlayerId; success: boolean; lostDisc: Disc | null; eliminated: boolean } | null;
  wins: Record<PlayerId, number>;
  winner: PlayerId | null;
  deadlineAt: number | null;
}

export interface SkullView {
  round: number;
  step: number;
  phase: SkullState["phase"];
  players: PlayerId[];
  /** How many discs each player still owns (the mix is secret). */
  discCounts: Record<PlayerId, number>;
  stackSizes: Record<PlayerId, number>;
  myDiscs: { flowers: number; skull: boolean } | null;
  myStack: Disc[];
  /** Who has laid their first disc during setup. */
  placed: PlayerId[];
  current: PlayerId;
  bid: SkullState["bid"];
  passed: PlayerId[];
  flipped: SkullState["flipped"];
  result: SkullState["result"];
  wins: Record<PlayerId, number>;
  winner: PlayerId | null;
  deadlineAt: number | null;
}

const count = (o: { flowers: number; skull: boolean }) => o.flowers + (o.skull ? 1 : 0);
const alive = (state: SkullState) =>
  state.players.filter((p) => count(state.owned[p] as { flowers: number; skull: boolean }) > 0);
const totalPlaced = (state: SkullState) => Object.values(state.stacks).reduce((n, s) => n + s.length, 0);

function nextAlive(state: SkullState, after: PlayerId, skip: PlayerId[] = []): PlayerId {
  const order = state.players;
  for (let i = 1; i <= order.length; i++) {
    const p = order[(order.indexOf(after) + i) % order.length] as PlayerId;
    if (alive(state).includes(p) && !skip.includes(p)) return p;
  }
  return after;
}

/** Whether `p` still has a disc of this kind that is not already on the table. */
function canPlace(state: SkullState, p: PlayerId, disc: Disc): boolean {
  const owned = state.owned[p] as { flowers: number; skull: boolean };
  const stack = state.stacks[p] ?? [];
  if (disc === "skull") return owned.skull && !stack.includes("skull");
  return stack.filter((d) => d === "flower").length < owned.flowers;
}

function startRound(state: SkullState, starter: PlayerId, ctx: GameContext) {
  state.stacks = Object.fromEntries(state.players.map((p) => [p, []]));
  state.bid = null;
  state.passed = [];
  state.flipped = [];
  state.result = null;
  state.current = starter;
  state.phase = "setup";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function endChallenge(
  state: SkullState,
  success: boolean,
  skullOwner: PlayerId | null,
  ctx: GameContext,
): GameResult<SkullState> {
  const challenger = (state.bid as { player: PlayerId }).player;
  let lostDisc: Disc | null = null;
  if (success) {
    state.wins[challenger] = (state.wins[challenger] ?? 0) + 1;
  } else {
    // A random disc of the challenger's is lost for good.
    const owned = state.owned[challenger] as { flowers: number; skull: boolean };
    const pool: Disc[] = [...Array<Disc>(owned.flowers).fill("flower"), ...(owned.skull ? (["skull"] as Disc[]) : [])];
    lostDisc = pool[Math.floor(ctx.random() * pool.length)] as Disc;
    if (lostDisc === "skull") owned.skull = false;
    else owned.flowers -= 1;
  }
  const eliminated = count(state.owned[challenger] as { flowers: number; skull: boolean }) === 0;
  state.result = { challenger, success, lostDisc, eliminated };
  state.phase = "roundOver";
  state.step += 1;
  state.deadlineAt = null;
  const survivors = alive(state);
  const winner =
    (state.wins[challenger] ?? 0) >= WINS_NEEDED
      ? challenger
      : survivors.length === 1
        ? (survivors[0] as PlayerId)
        : null;
  // The next round starts with the challenger, or whoever placed the skull if the challenger is out.
  state.current = eliminated
    ? skullOwner && skullOwner !== challenger
      ? skullOwner
      : nextAlive(state, challenger)
    : challenger;
  if (!winner) return { ok: true, state };
  state.winner = winner;
  return { ok: true, state, scores: [{ playerId: winner, points: POINTS_WIN, reason: "诈唬之王", key: "win" }] };
}

function flipOne(state: SkullState, owner: PlayerId, ctx: GameContext): GameResult<SkullState> {
  const stack = state.stacks[owner] as Disc[];
  const remaining = stack.length - state.flipped.filter((f) => f.owner === owner).length;
  const disc = stack[remaining - 1] as Disc;
  state.flipped.push({ owner, disc });
  state.step += 1;
  if (disc === "skull") return endChallenge(state, false, owner, ctx);
  if (state.flipped.length >= (state.bid as { value: number }).value) return endChallenge(state, true, null, ctx);
  return { ok: true, state };
}

/** The challenger flips their whole own stack first, top to bottom. */
function beginFlipping(state: SkullState, ctx: GameContext): GameResult<SkullState> {
  const challenger = (state.bid as { player: PlayerId }).player;
  state.phase = "flipping";
  state.current = challenger;
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  for (let i = (state.stacks[challenger] ?? []).length; i > 0; i--) {
    const r = flipOne(state, challenger, ctx);
    if (state.phase !== "flipping") return r;
  }
  return { ok: true, state };
}

export const skullGame = defineGame<SkullState, Action, SkullView, Config>({
  meta: {
    id: "skull",
    name: "翻牌诈唬",
    description: "每人三朵花一个骷髅，暗着叠起来，然后喊价：你敢翻几张而不碰到骷髅？",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每人有 4 张圆牌：3 张花、1 张骷髅。每轮所有人先同时暗放一张。然后从起始玩家开始轮流：再暗放一张，或者喊价「我能翻开 N 张花」（N 不超过桌上总数）。一旦有人喊价，之后只能加价或放弃，直到只剩一人（或有人喊到上限）。喊价者先翻开自己的所有牌，再挑别人的牌堆从上往下翻，凑够 N 张花就成功；翻到骷髅就失败，随机失去自己的一张牌（牌是谁放的谁知道，别人只看得到张数）。成功两次的人获胜；失去所有牌的人出局，只剩一人时 TA 获胜。",
    scoringSummary: `获胜者 +${POINTS_WIN} 分。`,
    options: [secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: SkullState = {
      config,
      round: 1,
      step: 0,
      phase: "setup",
      players: [...ctx.players],
      owned: Object.fromEntries(ctx.players.map((p) => [p, { flowers: 3, skull: true }])),
      stacks: {},
      current: ctx.players[0] as PlayerId,
      bid: null,
      passed: [],
      flipped: [],
      result: null,
      wins: Object.fromEntries(ctx.players.map((p) => [p, 0])),
      winner: null,
      deadlineAt: null,
    };
    startRound(state, state.current, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    const playing = alive(state).includes(me);
    switch (action.type) {
      case "place": {
        if (!playing) return { ok: false, error: "你已经出局了" };
        if (state.phase === "setup") {
          if ((state.stacks[me] ?? []).length > 0) return { ok: false, error: "你已经放好了" };
          if (!canPlace(state, me, action.disc)) return { ok: false, error: "你没有这张牌" };
          (state.stacks[me] as Disc[]).push(action.disc);
          if (alive(state).every((p) => (state.stacks[p] ?? []).length > 0)) {
            state.phase = "turns";
            state.step += 1;
            state.deadlineAt = timer(state.config.turnSeconds, ctx);
          }
          return { ok: true, state };
        }
        if (state.phase !== "turns") return { ok: false, error: "已经有人喊价，不能再放牌" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (!canPlace(state, me, action.disc)) return { ok: false, error: "你没有这张牌可以放了" };
        (state.stacks[me] as Disc[]).push(action.disc);
        state.current = nextAlive(state, me);
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "bid": {
        if (state.phase !== "turns" && state.phase !== "bidding") return { ok: false, error: "现在不能喊价" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (action.value > totalPlaced(state)) return { ok: false, error: `最多只能喊 ${totalPlaced(state)}` };
        if (state.bid && action.value <= state.bid.value) return { ok: false, error: `要比 ${state.bid.value} 高` };
        state.bid = { player: me, value: action.value };
        state.phase = "bidding";
        if (action.value === totalPlaced(state) || alive(state).every((p) => p === me || state.passed.includes(p))) {
          return beginFlipping(state, ctx);
        }
        state.current = nextAlive(state, me, state.passed);
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "pass": {
        if (state.phase !== "bidding") return { ok: false, error: "现在不能放弃" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        state.passed.push(me);
        const bidder = (state.bid as { player: PlayerId }).player;
        if (alive(state).every((p) => p === bidder || state.passed.includes(p))) return beginFlipping(state, ctx);
        state.current = nextAlive(state, me, state.passed);
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "flip": {
        if (state.phase !== "flipping") return { ok: false, error: "现在不是翻牌的时候" };
        if (me !== state.current) return { ok: false, error: "只有喊价者可以翻牌" };
        const left =
          (state.stacks[action.owner]?.length ?? 0) - state.flipped.filter((f) => f.owner === action.owner).length;
        if (action.owner === me || left <= 0) return { ok: false, error: "这一堆不能翻了" };
        return flipOne(state, action.owner, ctx);
      }
      case "next": {
        if (state.phase !== "roundOver") return { ok: false, error: "这一轮还没结束" };
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.winner) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.round += 1;
        startRound(state, state.current, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "roundOver",
  deadline: (state) =>
    state.phase === "roundOver" || state.phase === "finished" || state.phase === "setup" ? null : state.deadlineAt,
  onTimeout(state, ctx) {
    const me = state.current;
    if (state.phase === "turns") {
      // An absent player stops adding and bids the minimum.
      const value = 1;
      state.bid = { player: me, value };
      state.phase = "bidding";
      if (value === totalPlaced(state)) return beginFlipping(state, ctx);
      state.current = nextAlive(state, me);
      state.step += 1;
      state.deadlineAt = timer(state.config.turnSeconds, ctx);
      return { ok: true, state };
    }
    if (state.phase === "bidding") {
      state.passed.push(me);
      const bidder = (state.bid as { player: PlayerId }).player;
      if (alive(state).every((p) => p === bidder || state.passed.includes(p))) return beginFlipping(state, ctx);
      state.current = nextAlive(state, me, state.passed);
      state.step += 1;
      state.deadlineAt = timer(state.config.turnSeconds, ctx);
      return { ok: true, state };
    }
    if (state.phase === "flipping") {
      const owner = state.players.find(
        (p) => p !== me && (state.stacks[p]?.length ?? 0) > state.flipped.filter((f) => f.owner === p).length,
      );
      return owner ? flipOne(state, owner, ctx) : { ok: true, state };
    }
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (["turns", "bidding", "flipping"].includes(state.phase)) state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const mine = state.owned[viewer];
    return {
      round: state.round,
      step: state.step,
      phase: state.phase,
      players: state.players,
      discCounts: Object.fromEntries(
        state.players.map((p) => [p, count(state.owned[p] as { flowers: number; skull: boolean })]),
      ),
      stackSizes: Object.fromEntries(state.players.map((p) => [p, state.stacks[p]?.length ?? 0])),
      myDiscs: mine ? { ...mine } : null,
      myStack: state.stacks[viewer] ?? [],
      placed: state.players.filter((p) => (state.stacks[p] ?? []).length > 0),
      current: state.current,
      bid: state.bid,
      passed: state.passed,
      flipped: state.flipped,
      result: state.result,
      wins: state.wins,
      winner: state.winner,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    return `翻牌诈唬 第 ${state.round} 轮，阶段：${state.phase}，桌上 ${totalPlaced(state)} 张${state.bid ? `，当前喊价 ${state.bid.value}` : ""}（暗牌内容未公开）`;
  },
});
