/**
 * 「合作吃墩」— cooperative trick-taking. Everyone wins or loses together: each task says
 * which player must win the trick containing a given card. Pure rules; no content, no AI.
 * Rule spec: docs/games/crew.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const COLORS = ["red", "blue", "green", "yellow"] as const;
export type Suit = (typeof COLORS)[number] | "trump";
/** A card id like "red-7" or "trump-4". */
export type Card = string;
export const POINTS_MISSION = 3;

export const suitOf = (c: Card) => c.split("-")[0] as Suit;
export const rankOf = (c: Card) => Number(c.split("-")[1]);
export const DECK: Card[] = [
  ...COLORS.flatMap((s) => Array.from({ length: 9 }, (_, i) => `${s}-${i + 1}`)),
  ...[1, 2, 3, 4].map((n) => `trump-${n}`),
];

const configSchema = z.object({
  missions: z.number().int().min(1).max(10).default(3),
  /** Tasks in the first mission; each successful mission adds one. */
  tasks: z.number().int().min(1).max(6).default(2),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("takeTask"), step: z.number().int(), card: z.string() }),
  z.object({ type: z.literal("play"), step: z.number().int(), card: z.string() }),
  /** Once per mission, between tricks: show one coloured card and whether it is your highest, lowest or only one. */
  z.object({ type: z.literal("signal"), step: z.number().int(), card: z.string() }),
  /** Host: continue after a mission ends. */
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export type SignalKind = "highest" | "lowest" | "only";

export interface Task {
  card: Card;
  owner: PlayerId | null;
  done: boolean;
}

export interface CrewState {
  config: Config;
  mission: number;
  step: number;
  phase: "tasks" | "play" | "missionOver" | "finished";
  players: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  commander: PlayerId;
  tasks: Task[];
  /** Whose turn: picking a task or playing a card. */
  current: PlayerId;
  trick: { playerId: PlayerId; card: Card }[];
  lastTrick: { winner: PlayerId; cards: { playerId: PlayerId; card: Card }[] } | null;
  tricksWon: Record<PlayerId, number>;
  signals: Record<PlayerId, { card: Card; kind: SignalKind }>;
  result: "success" | "failure" | null;
  failedTask: Card | null;
  successes: number;
  deadlineAt: number | null;
}

export interface CrewView extends Omit<CrewState, "config" | "hands"> {
  totalMissions: number;
  myHand: Card[];
  /** Cards the viewer may legally play right now. */
  playable: Card[];
  handSizes: Record<PlayerId, number>;
  /** Whether the viewer may still signal this mission (and can right now). */
  canSignal: boolean;
}

/** Signal a card qualifies for, or null. Trumps cannot be signalled. */
export function signalKind(hand: Card[], card: Card): SignalKind | null {
  const suit = suitOf(card);
  if (suit === "trump" || !hand.includes(card)) return null;
  const same = hand.filter((c) => suitOf(c) === suit).map(rankOf);
  if (same.length === 1) return "only";
  if (rankOf(card) === Math.max(...same)) return "highest";
  if (rankOf(card) === Math.min(...same)) return "lowest";
  return null;
}

export function legalCards(state: CrewState, p: PlayerId): Card[] {
  const hand = state.hands[p] ?? [];
  const led = state.trick[0];
  if (!led) return hand;
  const follow = hand.filter((c) => suitOf(c) === suitOf(led.card));
  return follow.length > 0 ? follow : hand;
}

export function trickWinner(trick: { playerId: PlayerId; card: Card }[]): PlayerId {
  const ledSuit = suitOf((trick[0] as { card: Card }).card);
  const trumps = trick.filter((t) => suitOf(t.card) === "trump");
  const contenders = trumps.length > 0 ? trumps : trick.filter((t) => suitOf(t.card) === ledSuit);
  return contenders.reduce((best, t) => (rankOf(t.card) > rankOf(best.card) ? t : best)).playerId;
}

const nextPlayer = (state: CrewState, p: PlayerId) =>
  state.players[(state.players.indexOf(p) + 1) % state.players.length] as PlayerId;

function deal(state: CrewState, ctx: GameContext) {
  state.players = [...ctx.players];
  const deck = shuffle(DECK, ctx.random);
  state.hands = Object.fromEntries(state.players.map((p) => [p, [] as Card[]]));
  for (const [i, card] of deck.entries()) state.hands[state.players[i % state.players.length] as PlayerId]?.push(card);
  for (const p of state.players) (state.hands[p] as Card[]).sort((a, b) => DECK.indexOf(a) - DECK.indexOf(b));
  state.commander = state.players.find((p) => state.hands[p]?.includes("trump-4")) as PlayerId;
  const count = Math.min(state.config.tasks + state.successes, 10);
  const coloured = shuffle(
    DECK.filter((c) => suitOf(c) !== "trump"),
    ctx.random,
  );
  state.tasks = coloured.slice(0, count).map((card) => ({ card, owner: null, done: false }));
  state.current = state.commander;
  state.trick = [];
  state.lastTrick = null;
  state.tricksWon = Object.fromEntries(state.players.map((p) => [p, 0]));
  state.signals = {};
  state.result = null;
  state.failedTask = null;
  state.phase = "tasks";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function endMission(state: CrewState, result: "success" | "failure"): GameResult<CrewState> {
  state.result = result;
  state.phase = "missionOver";
  state.step += 1;
  state.deadlineAt = null;
  if (result === "failure") return { ok: true, state };
  state.successes += 1;
  return {
    ok: true,
    state,
    scores: state.players.map((p) => ({
      playerId: p,
      points: POINTS_MISSION,
      reason: "合作任务成功",
      key: `m${state.mission}:team:${p}`,
    })),
  };
}

function play(state: CrewState, p: PlayerId, card: Card, ctx: GameContext): GameResult<CrewState> {
  state.hands[p] = (state.hands[p] ?? []).filter((c) => c !== card);
  state.trick.push({ playerId: p, card });
  state.step += 1;
  if (state.trick.length < state.players.length) {
    state.current = nextPlayer(state, p);
    state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return { ok: true, state };
  }
  const winner = trickWinner(state.trick);
  state.tricksWon[winner] = (state.tricksWon[winner] ?? 0) + 1;
  state.lastTrick = { winner, cards: state.trick };
  for (const task of state.tasks) {
    if (!state.trick.some((t) => t.card === task.card)) continue;
    if (task.owner !== winner) {
      state.failedTask = task.card;
      state.trick = [];
      return endMission(state, "failure");
    }
    task.done = true;
  }
  state.trick = [];
  if (state.tasks.every((t) => t.done)) return endMission(state, "success");
  state.current = winner;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function takeTask(state: CrewState, p: PlayerId, card: Card, ctx: GameContext): GameResult<CrewState> {
  const task = state.tasks.find((t) => t.card === card && t.owner === null);
  if (!task) return { ok: false, error: "这个任务不能认领" };
  task.owner = p;
  state.step += 1;
  if (state.tasks.every((t) => t.owner !== null)) {
    state.phase = "play";
    state.current = state.commander;
  } else {
    state.current = nextPlayer(state, p);
  }
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

export const crewGame = defineGame<CrewState, Action, CrewView, Config>({
  meta: {
    id: "crew",
    name: "合作吃墩",
    description: "所有人是一个团队：打牌赢墩，让每个任务都由指定的人拿下，谁拿错一墩大家一起失败。",
    minPlayers: 3,
    maxPlayers: 5,
    rulesSummary:
      "牌：红蓝绿黄 1–9 各一张，外加王牌 1–4，全部发完。拿到王牌 4 的人是队长。每次任务开始时翻出若干张任务牌，从队长起轮流认领。打牌：领出的花色必须跟，没有才可以出别的；有王牌时最大的王牌赢，否则领出花色中最大的赢，赢家领下一墩。某个任务的牌被它的认领人赢下，任务完成；被别人赢下，整个任务立即失败。每人每次任务可以在两墩之间公开一张彩色手牌，并由系统标明它是你这个颜色里「最大 / 最小 / 唯一」的一张（不满足就不能公开）。按规则，打牌时请不要在语音里透露手牌。",
    scoringSummary: `团队计分：任务全部完成，所有人 +${POINTS_MISSION} 分；失败不得分。每成功一次，下一次多一张任务牌。`,
    options: [
      { key: "missions", label: "任务次数", min: 1, max: 10, default: 3 },
      { key: "tasks", label: "首次任务牌数", min: 1, max: 6, default: 2 },
      secondsOption("turnSeconds", "每次出牌时限", 0),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3 || ctx.players.length > 5) return { ok: false, error: "需要 3–5 名玩家" };
    const state: CrewState = {
      config,
      mission: 1,
      step: 0,
      phase: "tasks",
      players: [],
      hands: {},
      commander: "",
      tasks: [],
      current: "",
      trick: [],
      lastTrick: null,
      tricksWon: {},
      signals: {},
      result: null,
      failedTask: null,
      successes: 0,
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
      case "takeTask": {
        if (state.phase !== "tasks") return { ok: false, error: "现在不是认领任务的时候" };
        if (me !== state.current) return { ok: false, error: "还没轮到你认领" };
        return takeTask(state, me, action.card, ctx);
      }
      case "play": {
        if (state.phase !== "play") return { ok: false, error: "现在不能出牌" };
        if (me !== state.current) return { ok: false, error: "还没轮到你出牌" };
        if (!legalCards(state, me).includes(action.card)) {
          return {
            ok: false,
            error: (state.hands[me] ?? []).includes(action.card) ? "必须跟出领出的花色" : "你没有这张牌",
          };
        }
        return play(state, me, action.card, ctx);
      }
      case "signal": {
        if (state.phase !== "play") return { ok: false, error: "现在不能公开手牌" };
        if (state.trick.length > 0) return { ok: false, error: "只能在两墩之间公开" };
        if (!state.players.includes(me)) return { ok: false, error: "你不在这次任务里" };
        if (me in state.signals) return { ok: false, error: "这次任务你已经公开过一张了" };
        const kind = signalKind(state.hands[me] ?? [], action.card);
        if (!kind) return { ok: false, error: "只能公开你某个颜色里最大、最小或唯一的一张彩色牌" };
        state.signals[me] = { card: action.card, kind };
        return { ok: true, state };
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.phase !== "missionOver") return { ok: false, error: "任务还没结束" };
        if (state.mission >= state.config.missions || ctx.players.length < 3 || ctx.players.length > 5) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.mission += 1;
        deal(state, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "missionOver",
  deadline: (state) => (state.phase === "tasks" || state.phase === "play" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    // An absent player's move is made for them: first free task, or the first legal card.
    if (state.phase === "tasks") {
      const free = state.tasks.find((t) => t.owner === null);
      return free ? takeTask(state, state.current, free.card, ctx) : { ok: true, state };
    }
    if (state.phase === "play") return play(state, state.current, legalCards(state, state.current)[0] as Card, ctx);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "tasks" || state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const { config, hands, ...rest } = state;
    const mine = hands[viewer] ?? [];
    return {
      ...rest,
      totalMissions: config.missions,
      myHand: mine,
      playable: state.phase === "play" && state.current === viewer ? legalCards(state, viewer) : [],
      handSizes: Object.fromEntries(state.players.map((p) => [p, hands[p]?.length ?? 0])),
      canSignal:
        state.phase === "play" &&
        state.trick.length === 0 &&
        state.players.includes(viewer) &&
        !(viewer in state.signals),
    };
  },

  publicSummary(state) {
    const tasks = state.tasks
      .map((t) => `${t.card}${t.owner ? `（${t.done ? "已完成" : "进行中"}）` : "（未认领）"}`)
      .join("、");
    return `合作吃墩 第 ${state.mission} 次任务，阶段：${state.phase}，任务：${tasks}${state.result ? `，结果：${state.result === "success" ? "成功" : "失败"}` : ""}（手牌未公开）`;
  },
});
