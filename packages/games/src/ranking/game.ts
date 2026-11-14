/**
 * 「排排座」— cooperative. Each player secretly holds a number 1–10 and writes an answer whose
 * intensity matches it; the captain must put the answers in order. Rule spec: docs/games/ranking.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import {
  applyPick,
  emptyPick,
  isPickAction,
  offerToPick,
  openPick,
  type PickState,
  type PickView,
  pickActionSchemas,
  pickOnTimeout,
  pickSecondsOption,
  pickView,
} from "../pick.ts";
import { roundsOption, secondsOption, shuffle, timer } from "../util.ts";

export const ANSWER_MAX = 40;
export const POINTS_PERFECT = 3;
export const POINTS_ONE_SLIP = 1;

const payload = z.object({ text: z.string(), low: z.string(), high: z.string() });
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const rankingContentSchema = payload;
const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(4),
  writeSeconds: z.number().int().min(0).max(600).default(120),
  orderSeconds: z.number().int().min(0).max(600).default(120),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("answer"), step: z.number().int(), text: z.string().trim().min(1).max(ANSWER_MAX) }),
  /** Captain: the answers' authors from lowest to highest. */
  z.object({ type: z.literal("order"), step: z.number().int(), order: z.array(z.string()).max(8) }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface RankingState {
  /** Topic choice before each round formally starts. */
  pick: PickState<z.infer<typeof payload>>;
  config: Config;
  round: number;
  step: number;
  phase: "pick" | "write" | "order" | "reveal" | "finished";
  participants: PlayerId[];
  captain: PlayerId;
  turns: Record<PlayerId, number>;
  scenario: { contentId: string | null; text: string; low: string; high: string };
  numbers: Record<PlayerId, number>;
  answers: Record<PlayerId, string>;
  /** Shuffled presentation order for the captain (must not hint at the numbers). */
  shown: PlayerId[];
  placed: PlayerId[] | null;
  /** Number of pairs the captain put in the wrong relative order. */
  slips: number | null;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface RankingView {
  round: number;
  totalRounds: number;
  step: number;
  phase: RankingState["phase"];
  /** Present while this round\'s topic is being chosen. */
  pick: PickView | null;
  participants: PlayerId[];
  captain: PlayerId;
  scenario: { text: string; low: string; high: string };
  /** The viewer's own secret number (writers only). */
  myNumber: number | null;
  myAnswer: string | null;
  submitted: PlayerId[];
  /** Answers in presentation order; visible once writing has closed. */
  answers: { playerId: PlayerId; text: string }[] | null;
  deadlineAt: number | null;
  reveal: { placed: PlayerId[]; numbers: Record<PlayerId, number>; slips: number; points: number } | null;
}

const writers = (state: RankingState) => state.participants.filter((p) => p !== state.captain);
const pointsFor = (slips: number) => (slips === 0 ? POINTS_PERFECT : slips === 1 ? POINTS_ONE_SLIP : 0);

function startRound(state: RankingState, scenario: RankingState["scenario"], ctx: GameContext) {
  state.phase = "write";
  state.step += 1;
  state.scenario = scenario;
  const deck = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ctx.random);
  state.numbers = Object.fromEntries(writers(state).map((p, i) => [p, deck[i] as number]));
  state.answers = {};
  state.shown = [];
  state.placed = null;
  state.slips = null;
  state.deadlineAt = timer(state.config.writeSeconds, ctx);
}

function settle(state: RankingState, placed: PlayerId[]): GameResult<RankingState> {
  let slips = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if ((state.numbers[placed[i] as PlayerId] as number) > (state.numbers[placed[j] as PlayerId] as number)) slips++;
    }
  }
  state.placed = placed;
  state.slips = slips;
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  // Team result: everybody in the round earns the same.
  const points = placed.length >= 2 ? pointsFor(slips) : 0;
  const scores: ScoreAward[] =
    points > 0
      ? state.participants.map((p) => ({
          playerId: p,
          points,
          reason: slips === 0 ? "团队排序全对" : "团队排序只错一处",
          key: `r${state.round}:team:${p}`,
        }))
      : [];
  return { ok: true, state, scores };
}

function beginOrder(state: RankingState, ctx: GameContext): GameResult<RankingState> {
  state.shown = shuffle(Object.keys(state.answers), ctx.random);
  // Nothing to order with fewer than two answers.
  if (state.shown.length < 2) return settle(state, state.shown);
  state.phase = "order";
  state.step += 1;
  state.deadlineAt = timer(state.config.orderSeconds, ctx);
  return { ok: true, state };
}

function finishNoContent(state: RankingState): GameResult<RankingState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = "no-content";
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** Opens a round with the topic choice; the round formally starts once a topic is confirmed. */
function openRound(state: RankingState, ctx: GameContext): GameResult<RankingState> {
  state.phase = "pick";
  state.step += 1;
  state.participants = [...ctx.players];
  let captain = state.participants[0] as PlayerId;
  for (const p of state.participants) if ((state.turns[p] ?? 0) < (state.turns[captain] ?? 0)) captain = p;
  state.turns[captain] = (state.turns[captain] ?? 0) + 1;
  state.captain = captain;
  openPick(state.pick, state.captain, payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

const PICK = { schema: payload, contentType: "scale-scenario", allowCustom: true };

function advance(state: RankingState, ctx: GameContext): GameResult<RankingState> {
  const end = (why: RankingState["endedBecause"]): GameResult<RankingState> => {
    state.phase = "finished";
    state.step += 1;
    state.endedBecause = why;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  };
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return end("rounds");
  if (ctx.players.length < 3) return end("rounds");
  state.round += 1;
  return openRound(state, ctx);
}

export const rankingGame = defineGame<RankingState, Action, RankingView, Config>({
  meta: {
    id: "ranking",
    name: "排排座",
    description: "合作游戏：每人按自己的秘密数字（1–10）回答同一个情境，队长要把大家的回答从低到高排对。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮开始前，由本轮队长从候选情境里选一个（可以不限次数地换一批，也可以自己出一个）。每轮一个情境和一条程度刻度（例如「形容一种食物：最难吃 → 最好吃」）。队长轮流担任。其他人各拿到一个互不相同的秘密数字（1–10），写一个程度与数字相符的回答，不能写出数字。写完后回答公开（数字仍保密），队长把它们从低到高排序，然后揭晓数字。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `团队计分：全部排对，本轮所有人 +${POINTS_PERFECT} 分；只有一对顺序排反，所有人 +${POINTS_ONE_SLIP} 分；否则不得分。`,
    contentType: "scale-scenario",
    options: [
      roundsOption(4),
      secondsOption("writeSeconds", "作答时限", 120),
      secondsOption("orderSeconds", "排序时限", 120),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: RankingState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "write",
      participants: [],
      captain: "",
      turns: {},
      scenario: { contentId: "", text: "", low: "", high: "" },
      numbers: {},
      answers: {},
      shown: [],
      placed: null,
      slips: null,
      deadlineAt: null,
      endedBecause: null,
    };
    const opened = openRound(state, ctx);
    if (opened.ok && opened.finished) return { ok: false, error: "题库中没有可用的题目" };
    return opened;
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定了" };
      const r = applyPick(state.pick, action, actor.playerId, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      const c = r.chosen;
      startRound(state, { contentId: c.contentId, ...c.data }, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "出题人正在选题，稍等一下" };
    const me = actor.playerId;
    switch (action.type) {
      case "answer": {
        if (state.phase !== "write") return { ok: false, error: "现在不是作答阶段" };
        if (!(me in state.numbers))
          return { ok: false, error: me === state.captain ? "队长不用作答" : "你将从下一轮开始参与" };
        if (me in state.answers) return { ok: false, error: "你已经提交过了" };
        if (/[0-9０-９]|[一二三四五六七八九十]分/.test(action.text)) return { ok: false, error: "回答里不能出现数字" };
        state.answers[me] = action.text;
        return writers(state).every((p) => p in state.answers) ? beginOrder(state, ctx) : { ok: true, state };
      }
      case "order": {
        if (state.phase !== "order") return { ok: false, error: "现在不是排序阶段" };
        if (me !== state.captain) return { ok: false, error: "只有队长可以排序" };
        const valid =
          action.order.length === state.shown.length &&
          new Set(action.order).size === action.order.length &&
          action.order.every((p) => state.shown.includes(p));
        if (!valid) return { ok: false, error: "排序必须恰好包含每个回答一次" };
        return settle(state, action.order);
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "write") return beginOrder(state, ctx);
        // Captain away: the answers are scored in the order they were shown.
        if (state.phase === "order") return settle(state, state.shown);
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "write" || state.phase === "order" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.scenario.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "排排座");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) =>
    state.phase === "pick"
      ? state.deadlineAt
      : state.phase === "write" || state.phase === "order"
        ? state.deadlineAt
        : null,
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return finishNoContent(state);
      startRound(state, { contentId: c.contentId, ...c.data }, ctx);
      return { ok: true, state };
    }
    if (state.phase === "write") return beginOrder(state, ctx);
    if (state.phase === "order") return settle(state, state.shown);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "write") state.deadlineAt = timer(state.config.writeSeconds, ctx);
    if (state.phase === "order") state.deadlineAt = timer(state.config.orderSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick:
        state.phase === "pick"
          ? pickView(state.pick, (d) => `${d.text}（${d.low} → ${d.high}）`, PICK.allowCustom)
          : null,
      participants: state.participants,
      captain: state.captain,
      scenario: { text: state.scenario.text, low: state.scenario.low, high: state.scenario.high },
      myNumber: state.numbers[viewer] ?? null,
      myAnswer: state.answers[viewer] ?? null,
      submitted: Object.keys(state.answers),
      answers:
        state.phase === "write" ? null : state.shown.map((p) => ({ playerId: p, text: state.answers[p] as string })),
      deadlineAt: state.deadlineAt,
      reveal:
        revealed && state.placed
          ? {
              placed: state.placed,
              numbers: state.numbers,
              slips: state.slips ?? 0,
              points: state.placed.length >= 2 ? pointsFor(state.slips ?? 0) : 0,
            }
          : null,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `排排座 第 ${state.round} 轮：出题人正在选题，尚未开始`;
    const base = `排排座 第 ${state.round} 轮，情境：「${state.scenario.text}」（${state.scenario.low} → ${state.scenario.high}），阶段：${state.phase}`;
    if (state.phase === "reveal" || state.phase === "finished") return `${base}，排错 ${state.slips} 对（已揭晓）`;
    return `${base}（各人的秘密数字未公开）`;
  },
});
