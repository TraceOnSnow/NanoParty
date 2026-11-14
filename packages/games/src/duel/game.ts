/**
 * 「暗牌对决」— hold one card; on your turn draw one and play one, using its effect to knock
 * others out. Last one standing, or highest card when the deck runs out, wins the round.
 * Pure rules; card names and wording are our own. Rule spec: docs/games/duel.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const CARDS: Record<number, { name: string; count: number; text: string }> = {
  1: { name: "侦察", count: 5, text: "指定一名玩家并猜一个 2–8 的点数，猜中则 TA 出局" },
  2: { name: "窥探", count: 2, text: "偷看一名玩家的手牌" },
  3: { name: "比拼", count: 2, text: "和一名玩家私下比点数，小的出局" },
  4: { name: "护盾", count: 2, text: "直到你下个回合前，别人的牌对你无效" },
  5: { name: "弃牌令", count: 2, text: "让一名玩家（可以是自己）弃掉手牌重摸一张" },
  6: { name: "交换", count: 1, text: "和一名玩家交换手牌" },
  7: { name: "顾问", count: 1, text: "无效果；但手里同时有 5 或 6 时必须打出它" },
  8: { name: "王牌", count: 1, text: "打出或被弃掉就出局" },
};
export const POINTS_ROUND = 1;
export const POINTS_GAME = 2;

const configSchema = z.object({
  tokens: z.number().int().min(1).max(7).default(3),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play"),
    step: z.number().int(),
    card: z.number().int().min(1).max(8),
    target: z.string().optional(),
    guess: z.number().int().min(2).max(8).optional(),
  }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface PlayLog {
  by: PlayerId;
  card: number;
  target: PlayerId | null;
  guess: number | null;
  /** Players knocked out by this play. */
  out: PlayerId[];
  /** Card discarded by the target of a 5. */
  discarded: number | null;
}

export interface DuelState {
  config: Config;
  round: number;
  step: number;
  phase: "play" | "roundOver" | "finished";
  players: PlayerId[];
  alive: PlayerId[];
  hands: Record<PlayerId, number[]>;
  deck: number[];
  setAside: number | null;
  discards: Record<PlayerId, number[]>;
  shielded: PlayerId[];
  current: PlayerId;
  log: PlayLog[];
  /** Private knowledge from peeks and comparisons. */
  seen: Record<PlayerId, { about: PlayerId; card: number }[]>;
  tokens: Record<PlayerId, number>;
  roundWinners: PlayerId[];
  showdown: Record<PlayerId, number> | null;
  champion: PlayerId | null;
  deadlineAt: number | null;
}

export interface DuelView {
  round: number;
  tokensToWin: number;
  step: number;
  phase: DuelState["phase"];
  players: PlayerId[];
  alive: PlayerId[];
  myHand: number[];
  deckLeft: number;
  discards: Record<PlayerId, number[]>;
  shielded: PlayerId[];
  current: PlayerId;
  log: PlayLog[];
  mySeen: { about: PlayerId; card: number }[];
  tokens: Record<PlayerId, number>;
  roundWinners: PlayerId[];
  /** Everyone's last card when the deck ran out. */
  showdown: Record<PlayerId, number> | null;
  champion: PlayerId | null;
  deadlineAt: number | null;
}

const DECK = Object.entries(CARDS).flatMap(([v, c]) => Array<number>(c.count).fill(Number(v)));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function drawFor(state: DuelState, p: PlayerId) {
  const card = state.deck.length > 0 ? state.deck.shift() : state.setAside;
  if (card === undefined || card === null) return;
  if (state.deck.length === 0 && card === state.setAside) state.setAside = null;
  (state.hands[p] as number[]).push(card);
}

function startRound(state: DuelState, starter: PlayerId, ctx: GameContext) {
  state.alive = [...state.players];
  const deck = shuffle(DECK, ctx.random);
  state.setAside = deck.shift() ?? null;
  state.hands = Object.fromEntries(state.players.map((p) => [p, [deck.shift() as number]]));
  state.deck = deck;
  state.discards = Object.fromEntries(state.players.map((p) => [p, []]));
  state.shielded = [];
  state.log = [];
  state.seen = Object.fromEntries(state.players.map((p) => [p, []]));
  state.roundWinners = [];
  state.showdown = null;
  state.current = starter;
  state.phase = "play";
  state.step += 1;
  drawFor(state, starter);
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function knockOut(state: DuelState, p: PlayerId) {
  state.alive = state.alive.filter((q) => q !== p);
  state.discards[p]?.push(...(state.hands[p] ?? []));
  state.hands[p] = [];
}

function endRound(state: DuelState, winners: PlayerId[]): GameResult<DuelState> {
  state.roundWinners = winners;
  state.phase = "roundOver";
  state.step += 1;
  state.deadlineAt = null;
  const scores: ScoreAward[] = [];
  for (const w of winners) {
    state.tokens[w] = (state.tokens[w] ?? 0) + 1;
    scores.push({ playerId: w, points: POINTS_ROUND, reason: "赢下一轮", key: `r${state.round}:win:${w}` });
  }
  const champ = winners.find((w) => (state.tokens[w] ?? 0) >= state.config.tokens);
  if (champ) {
    state.champion = champ;
    scores.push({ playerId: champ, points: POINTS_GAME, reason: "赢得对决", key: "champion" });
  }
  return { ok: true, state, scores };
}

function afterPlay(state: DuelState, p: PlayerId, ctx: GameContext): GameResult<DuelState> {
  if (state.alive.length === 1) return endRound(state, state.alive);
  if (state.deck.length === 0) {
    state.showdown = Object.fromEntries(state.alive.map((q) => [q, (state.hands[q] as number[])[0] as number]));
    const best = Math.max(...Object.values(state.showdown));
    let top = state.alive.filter((q) => state.showdown?.[q] === best);
    const bestDiscard = Math.max(...top.map((q) => sum(state.discards[q] ?? [])));
    top = top.filter((q) => sum(state.discards[q] ?? []) === bestDiscard);
    return endRound(state, top);
  }
  const order = state.players;
  let next = p;
  for (let i = 1; i <= order.length; i++) {
    const q = order[(order.indexOf(p) + i) % order.length] as PlayerId;
    if (state.alive.includes(q)) {
      next = q;
      break;
    }
  }
  state.current = next;
  state.shielded = state.shielded.filter((q) => q !== next);
  drawFor(state, next);
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

/** Players a card may target. */
export function targetsFor(state: DuelState, p: PlayerId, card: number): PlayerId[] {
  const others = state.alive.filter((q) => q !== p && !state.shielded.includes(q));
  return card === 5 ? [...others, p] : others;
}

function play(
  state: DuelState,
  p: PlayerId,
  card: number,
  target: PlayerId | undefined,
  guess: number | undefined,
  ctx: GameContext,
): GameResult<DuelState> {
  const hand = state.hands[p] as number[];
  if (!hand.includes(card)) return { ok: false, error: "你没有这张牌" };
  if (card !== 7 && hand.includes(7) && (hand.includes(5) || hand.includes(6)))
    return { ok: false, error: "手里有顾问和弃牌令/交换时，必须打出顾问" };
  const needsTarget = [1, 2, 3, 5, 6].includes(card);
  const targets = targetsFor(state, p, card);
  if (needsTarget && targets.length > 0) {
    if (!target || !targets.includes(target)) return { ok: false, error: "请选一个可以指定的玩家" };
    if (card === 1 && guess === undefined) return { ok: false, error: "请猜一个 2–8 的点数" };
  }
  if (target && !targets.includes(target)) return { ok: false, error: "不能指定这名玩家（已出局或有护盾）" };
  const t = needsTarget && targets.length > 0 ? (target as PlayerId) : null;
  hand.splice(hand.indexOf(card), 1);
  state.discards[p]?.push(card);
  const entry: PlayLog = {
    by: p,
    card,
    target: t,
    guess: card === 1 && t ? (guess as number) : null,
    out: [],
    discarded: null,
  };
  state.log.push(entry);
  const other = t ? ((state.hands[t] as number[])[0] as number) : 0;
  const mine = hand[0] as number;
  switch (card) {
    case 1:
      if (t && other === guess) entry.out.push(t);
      break;
    case 2:
      if (t) state.seen[p]?.push({ about: t, card: other });
      break;
    case 3:
      if (t) {
        state.seen[p]?.push({ about: t, card: other });
        state.seen[t]?.push({ about: p, card: mine });
        if (mine < other) entry.out.push(p);
        if (other < mine) entry.out.push(t);
      }
      break;
    case 4:
      state.shielded.push(p);
      break;
    case 5:
      if (t) {
        const dropped = (state.hands[t] as number[]).shift() as number;
        state.discards[t]?.push(dropped);
        entry.discarded = dropped;
        if (dropped === 8) entry.out.push(t);
        else drawFor(state, t);
      }
      break;
    case 6:
      if (t) [state.hands[p], state.hands[t]] = [state.hands[t] as number[], state.hands[p] as number[]];
      break;
    case 8:
      entry.out.push(p);
      break;
  }
  for (const q of entry.out) knockOut(state, q);
  return afterPlay(state, p, ctx);
}

export const duelGame = defineGame<DuelState, Action, DuelView, Config>({
  meta: {
    id: "duel",
    name: "暗牌对决",
    description: "手里只有一张牌。每回合摸一张、打一张，用它的效果把别人淘汰——一局只要几分钟。",
    minPlayers: 2,
    maxPlayers: 6,
    rulesSummary: `16 张牌，点数 1–8：${Object.entries(CARDS)
      .map(([v, c]) => `${v}「${c.name}」×${c.count}：${c.text}`)
      .join(
        "；",
      )}。开局拿掉一张暗牌不用，每人一张。轮到你时摸一张，再打出两张中的一张并执行效果。只剩一人时 TA 赢下这一轮；牌摸完时，手牌点数最大的赢（平局比弃牌点数和）。先赢下指定轮数的人赢得对决。`,
    scoringSummary: `每赢一轮 +${POINTS_ROUND} 分，赢得对决再 +${POINTS_GAME} 分。`,
    options: [
      { key: "tokens", label: "获胜所需轮数", min: 1, max: 7, default: 3 },
      secondsOption("turnSeconds", "每步时限", 0),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 2 || ctx.players.length > 6) return { ok: false, error: "需要 2–6 名玩家" };
    const state: DuelState = {
      config,
      round: 1,
      step: 0,
      phase: "play",
      players: [...ctx.players],
      alive: [],
      hands: {},
      deck: [],
      setAside: null,
      discards: {},
      shielded: [],
      current: ctx.players[0] as PlayerId,
      log: [],
      seen: {},
      tokens: Object.fromEntries(ctx.players.map((p) => [p, 0])),
      roundWinners: [],
      showdown: null,
      champion: null,
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
    switch (action.type) {
      case "play":
        if (state.phase !== "play") return { ok: false, error: "这一轮已经结束" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        return play(state, me, action.card, action.target, action.guess, ctx);
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.phase !== "roundOver") return { ok: false, error: "这一轮还没结束" };
        if (state.champion) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.round += 1;
        startRound(state, state.roundWinners[0] ?? state.current, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "roundOver",
  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase !== "play") return { ok: true, state };
    // An absent player plays their lower card at the first possible target, guessing 2.
    const p = state.current;
    const hand = state.hands[p] as number[];
    const forced = hand.includes(7) && (hand.includes(5) || hand.includes(6));
    const card = forced ? 7 : (Math.min(...hand.filter((c) => c !== 8)) as number) || 8;
    const target = targetsFor(state, p, card)[0];
    return play(state, p, card, target, 2, ctx);
  },
  onResume(state, ctx) {
    if (state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    return {
      round: state.round,
      tokensToWin: state.config.tokens,
      step: state.step,
      phase: state.phase,
      players: state.players,
      alive: state.alive,
      myHand: state.hands[viewer] ?? [],
      deckLeft: state.deck.length,
      discards: state.discards,
      shielded: state.shielded,
      current: state.current,
      log: state.log,
      mySeen: state.seen[viewer] ?? [],
      tokens: state.tokens,
      roundWinners: state.roundWinners,
      showdown: state.showdown,
      champion: state.champion,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    return `暗牌对决 第 ${state.round} 轮，存活 ${state.alive.length}/${state.players.length} 人，牌堆剩 ${state.deck.length} 张，阶段：${state.phase}（手牌未公开）`;
  },
});
