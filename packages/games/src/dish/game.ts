/**
 * 「黑暗料理」— slide a card face down to someone and say what it is, truthfully or not.
 * They either call it (true or false) or peek and pass it on with a claim of their own.
 * Whoever is wrong keeps the card; four of a kind in front of you and you have lost.
 * Pure rules; no content, no AI. Rule spec: docs/games/dish.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const DISH_KINDS = ["香菜", "榴莲", "苦瓜", "折耳根", "臭豆腐", "螺蛳粉", "皮蛋", "芥末"];
const COPIES = 8;
export const DISH_LIMIT = 4;
const POINTS_SAFE = 1;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const configSchema = z.object({
  games: z.number().int().min(1).max(5).default(1),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  /** Start a pass: a card from your hand, who gets it, and what you say it is. */
  z.object({
    type: z.literal("offer"),
    kind: z.string(),
    target: z.string(),
    claim: z.string(),
    step: z.number().int(),
  }),
  /** Say whether the last claim is true. */
  z.object({ type: z.literal("call"), truth: z.boolean(), step: z.number().int() }),
  /** Look at the card instead of calling it; it must then be passed on. */
  z.object({ type: z.literal("peek"), step: z.number().int() }),
  z.object({ type: z.literal("relay"), target: z.string(), claim: z.string(), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface DishState {
  config: Config;
  game: number;
  step: number;
  /** offer: start a pass. respond: call or peek. relay: has peeked, must pass on. */
  phase: "offer" | "respond" | "relay" | "gameOver" | "finished";
  players: PlayerId[];
  current: PlayerId;
  hands: Record<PlayerId, string[]>;
  /** Cards face up in front of each player, by kind. */
  table: Record<PlayerId, Record<string, number>>;
  pass: {
    card: string;
    claim: string;
    /** Who made the current claim. */
    sender: PlayerId;
    holder: PlayerId;
    /** Everyone who has looked at the card, the first passer included. */
    seen: PlayerId[];
  } | null;
  last: { card: string; claim: string; sender: PlayerId; caller: PlayerId; truth: boolean; taker: PlayerId } | null;
  loser: PlayerId | null;
  lostBy: "four" | "empty" | null;
  deadlineAt: number | null;
}

export interface DishView {
  game: number;
  totalGames: number;
  step: number;
  phase: DishState["phase"];
  players: PlayerId[];
  kinds: string[];
  current: PlayerId;
  myHand: string[] | null;
  handCounts: Record<PlayerId, number>;
  table: Record<PlayerId, Record<string, number>>;
  pass: {
    claim: string;
    sender: PlayerId;
    holder: PlayerId;
    seen: PlayerId[];
    /** The real card, only for those who have looked at it. */
    card: string | null;
  } | null;
  last: DishState["last"];
  loser: PlayerId | null;
  lostBy: DishState["lostBy"];
  deadlineAt: number | null;
}

const isKind = (kind: string) => DISH_KINDS.includes(kind);
export const dishTargets = (state: DishState, me: PlayerId) =>
  state.players.filter((p) => p !== me && !(state.pass?.seen ?? []).includes(p));

function lose(state: DishState, loser: PlayerId, by: "four" | "empty"): GameResult<DishState> {
  state.loser = loser;
  state.lostBy = by;
  state.pass = null;
  state.phase = "gameOver";
  state.step += 1;
  state.deadlineAt = null;
  const scores: ScoreAward[] = state.players
    .filter((p) => p !== loser)
    .map((p) => ({ playerId: p, points: POINTS_SAFE, reason: "没有输", key: `g${state.game}:safe:${p}` }));
  return { ok: true, state, scores };
}

function deal(state: DishState, ctx: GameContext) {
  state.players = [...ctx.players];
  const deck = shuffle(
    DISH_KINDS.flatMap((kind) => Array<string>(COPIES).fill(kind)),
    ctx.random,
  );
  state.hands = Object.fromEntries(state.players.map((p) => [p, [] as string[]]));
  deck.forEach((card, i) => {
    (state.hands[state.players[i % state.players.length] as PlayerId] as string[]).push(card);
  });
  for (const p of state.players) (state.hands[p] as string[]).sort();
  state.table = Object.fromEntries(state.players.map((p) => [p, {}]));
  state.pass = null;
  state.last = null;
  state.loser = null;
  state.lostBy = null;
  state.current = state.players[(state.game - 1) % state.players.length] as PlayerId;
  state.phase = "offer";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function offer(state: DishState, me: PlayerId, kind: string, target: PlayerId, claim: string, ctx: GameContext) {
  const hand = state.hands[me] as string[];
  hand.splice(hand.indexOf(kind), 1);
  state.pass = { card: kind, claim, sender: me, holder: target, seen: [me] };
  state.phase = "respond";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function call(state: DishState, truth: boolean, ctx: GameContext): GameResult<DishState> {
  const pass = state.pass as NonNullable<DishState["pass"]>;
  const caller = pass.holder;
  const right = truth === (pass.card === pass.claim);
  // A right call sends the card back to whoever made the claim.
  const taker = right ? pass.sender : caller;
  const pile = state.table[taker] as Record<string, number>;
  pile[pass.card] = (pile[pass.card] ?? 0) + 1;
  state.last = { card: pass.card, claim: pass.claim, sender: pass.sender, caller, truth, taker };
  state.pass = null;
  if ((pile[pass.card] ?? 0) >= DISH_LIMIT) return lose(state, taker, "four");
  // The taker starts the next pass, and loses at once with nothing left to pass.
  if ((state.hands[taker] ?? []).length === 0) return lose(state, taker, "empty");
  state.current = taker;
  state.phase = "offer";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function relay(state: DishState, target: PlayerId, claim: string, ctx: GameContext): GameResult<DishState> {
  const pass = state.pass as NonNullable<DishState["pass"]>;
  pass.sender = pass.holder;
  pass.holder = target;
  pass.claim = claim;
  state.phase = "respond";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const dishGame = defineGame<DishState, Action, DishView, Config>({
  meta: {
    id: "dish",
    name: "黑暗料理",
    description:
      "把一张牌扣着推给别人，说「这是香菜」——可能是真的，也可能是骗人。对方要么猜你说没说实话，要么偷看一眼再甩给下一个人。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `一共 ${DISH_KINDS.length} 种黑暗料理（${DISH_KINDS.join("、")}），每种 ${COPIES} 张，全部发完。轮到你时，从手里选一张扣着推给任何一个人，并说它是哪一种（可以说谎）。收到的人二选一：一，直接判断「你说的是真的」或「你在骗人」，然后翻开——判断对了，这张牌回到说话的人面前；判断错了，牌留在自己面前。二，偷看这张牌，再推给一个还没看过它的人，并说它是哪一种（可以改口）。所有人都看过了，最后一个人就只能判断。牌到了谁面前，下一轮就由谁开始。面前有 ${DISH_LIMIT} 张同一种料理的人输；轮到自己开始却没有手牌的人也输。这个游戏只有一个输家。`,
    scoringSummary: `每局输家以外的玩家各 +${POINTS_SAFE} 分。`,
    options: [{ key: "games", label: "局数", min: 1, max: 5, default: 1 }, secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: DishState = {
      config,
      game: 1,
      step: 0,
      phase: "offer",
      players: [],
      current: "",
      hands: {},
      table: {},
      pass: null,
      last: null,
      loser: null,
      lostBy: null,
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
      case "offer": {
        if (state.phase !== "offer") return { ok: false, error: "现在不能开始推牌" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (!(state.hands[me] ?? []).includes(action.kind)) return { ok: false, error: "你手里没有这张牌" };
        if (!isKind(action.claim)) return { ok: false, error: "没有这种料理" };
        if (action.target === me || !state.players.includes(action.target))
          return { ok: false, error: "不能推给这位玩家" };
        offer(state, me, action.kind, action.target, action.claim, ctx);
        return { ok: true, state };
      }
      case "call":
        if (state.phase !== "respond" || state.pass?.holder !== me) return { ok: false, error: "这张牌不在你面前" };
        return call(state, action.truth, ctx);
      case "peek": {
        if (state.phase !== "respond" || state.pass?.holder !== me) return { ok: false, error: "这张牌不在你面前" };
        if (dishTargets(state, me).length === 0) return { ok: false, error: "所有人都看过了，你只能判断真假" };
        state.pass.seen.push(me);
        state.phase = "relay";
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "relay": {
        if (state.phase !== "relay" || state.pass?.holder !== me) return { ok: false, error: "这张牌不在你面前" };
        if (!isKind(action.claim)) return { ok: false, error: "没有这种料理" };
        if (!dishTargets(state, me).includes(action.target)) return { ok: false, error: "这位玩家已经看过这张牌了" };
        return relay(state, action.target, action.claim, ctx);
      }
      case "next": {
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
    }
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "gameOver" || state.phase === "finished" ? null : state.deadlineAt),
  // An absent player passes their first card truthfully, believes what they are told, and passes on unchanged.
  onTimeout(state, ctx) {
    const pass = state.pass;
    if (state.phase === "offer") {
      const me = state.current;
      const kind = (state.hands[me] as string[])[0] as string;
      const target = state.players[(state.players.indexOf(me) + 1) % state.players.length] as PlayerId;
      offer(state, me, kind, target, kind, ctx);
      return { ok: true, state };
    }
    if (state.phase === "respond" && pass) return call(state, true, ctx);
    if (state.phase === "relay" && pass)
      return relay(state, dishTargets(state, pass.holder)[0] as PlayerId, pass.claim, ctx);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase !== "gameOver" && state.phase !== "finished")
      state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    return {
      game: state.game,
      totalGames: state.config.games,
      step: state.step,
      phase: state.phase,
      players: state.players,
      kinds: DISH_KINDS,
      current: state.current,
      myHand: state.hands[viewer] ?? null,
      handCounts: Object.fromEntries(state.players.map((p) => [p, state.hands[p]?.length ?? 0])),
      table: state.table,
      pass: state.pass
        ? {
            claim: state.pass.claim,
            sender: state.pass.sender,
            holder: state.pass.holder,
            seen: state.pass.seen,
            card: state.pass.seen.includes(viewer) ? state.pass.card : null,
          }
        : null,
      last: state.last,
      loser: state.loser,
      lostBy: state.lostBy,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const pass = state.pass
      ? `，${state.pass.sender} 正把一张牌推给 ${state.pass.holder}，说是「${state.pass.claim}」`
      : "";
    return `黑暗料理 第 ${state.game} 局，阶段：${state.phase}${pass}（手牌和扣着的牌未公开）`;
  },
});
