/**
 * 「百分比竞猜」— everyone secretly answers a yes/no question about themselves; one player guesses
 * what share of the room said yes and the others bet higher or lower. The numbers are always the
 * room's own answers, never invented statistics. Rule spec: docs/games/percent.md
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
  rotatePicker,
} from "../pick.ts";
import { roundsOption, secondsOption, timer } from "../util.ts";

const POINTS_EXACT = 3;
const POINTS_NEAR = 1;
const POINTS_BET = 1;

const payload = z.object({ text: z.string().trim().min(1).max(60) });
/** Payload shape of this game's content type. */
export const yesnoContentSchema = payload;
type Prompt = z.infer<typeof payload>;

const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(6),
  answerSeconds: z.number().int().min(0).max(600).default(30),
  betSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("answer"), step: z.number().int(), yes: z.boolean() }),
  /** Guesser: how many people said yes. */
  z.object({ type: z.literal("guess"), step: z.number().int(), count: z.number().int().min(0) }),
  z.object({ type: z.literal("bet"), step: z.number().int(), side: z.enum(["higher", "lower"]) }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface PercentState {
  config: Config;
  pick: PickState<Prompt>;
  round: number;
  step: number;
  phase: "pick" | "answer" | "guess" | "bet" | "reveal" | "finished";
  participants: PlayerId[];
  guesser: PlayerId;
  prompt: { contentId: string | null; text: string };
  /** Individual answers are never shown to anyone, even after the reveal. */
  answers: Record<PlayerId, boolean>;
  guess: number | null;
  bets: Record<PlayerId, "higher" | "lower">;
  deadlineAt: number | null;
}

export interface PercentView {
  round: number;
  totalRounds: number;
  step: number;
  phase: PercentState["phase"];
  pick: PickView | null;
  participants: PlayerId[];
  guesser: PlayerId;
  prompt: string;
  answered: PlayerId[];
  myAnswer: boolean | null;
  guess: number | null;
  betters: PlayerId[];
  myBet: "higher" | "lower" | null;
  /** After the reveal: how many answered, how many said yes, and everyone's bet. */
  reveal: { answered: number; yes: number; bets: Record<PlayerId, "higher" | "lower"> } | null;
  deadlineAt: number | null;
}

const PICK = { schema: payload, contentType: "yesno-prompt", allowCustom: true };
const yesCount = (state: PercentState) => Object.values(state.answers).filter(Boolean).length;
const bettors = (state: PercentState) => state.participants.filter((p) => p !== state.guesser);

function openRound(state: PercentState, ctx: GameContext): GameResult<PercentState> {
  state.phase = "pick";
  state.step += 1;
  state.participants = [...ctx.players];
  state.guesser = rotatePicker(state.pick, state.participants);
  openPick(state.pick, state.guesser, payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startRound(state: PercentState, c: { contentId: string | null; data: Prompt }, ctx: GameContext) {
  state.prompt = { contentId: c.contentId, text: c.data.text };
  state.answers = {};
  state.guess = null;
  state.bets = {};
  state.phase = "answer";
  state.step += 1;
  state.deadlineAt = timer(state.config.answerSeconds, ctx);
}

function settle(state: PercentState): GameResult<PercentState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const yes = yesCount(state);
  const guess = state.guess;
  if (guess === null) return { ok: true, state };
  const off = Math.abs(guess - yes);
  const scores: ScoreAward[] = [];
  if (off <= 1) {
    scores.push({
      playerId: state.guesser,
      points: off === 0 ? POINTS_EXACT : POINTS_NEAR,
      reason: off === 0 ? "一点不差" : "只差一个人",
      key: `r${state.round}:guess`,
    });
  }
  for (const [p, side] of Object.entries(state.bets)) {
    if ((side === "higher" && yes > guess) || (side === "lower" && yes < guess)) {
      scores.push({ playerId: p, points: POINTS_BET, reason: "押对了方向", key: `r${state.round}:bet:${p}` });
    }
  }
  return { ok: true, state, scores };
}

function toGuess(state: PercentState, ctx: GameContext): GameResult<PercentState> {
  state.step += 1;
  // Too few answers to say anything about the room: show what there is and move on.
  if (Object.keys(state.answers).length < 2) return settle(state);
  state.phase = "guess";
  state.deadlineAt = timer(state.config.betSeconds, ctx);
  return { ok: true, state };
}

function advance(state: PercentState, ctx: GameContext): GameResult<PercentState> {
  if ((state.config.rounds > 0 && state.round >= state.config.rounds) || ctx.players.length < 3) {
    state.phase = "finished";
    state.step += 1;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  }
  state.round += 1;
  return openRound(state, ctx);
}

export const percentGame = defineGame<PercentState, Action, PercentView, Config>({
  meta: {
    id: "percent",
    name: "百分比竞猜",
    description: "「在场有百分之多少的人……？」大家先秘密作答，一个人猜比例，其他人押更高还是更低。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮一名竞猜者（轮流）从候选题里选一道关于「你」的是非题（可以换一批或自己出题）。所有人（包括竞猜者）先秘密回答「是 / 否」；然后竞猜者猜有几个人答了「是」（同时显示成百分比），其他人押实际人数比这个猜测「更高」还是「更低」。揭晓时只公开总人数和比例，不公开任何人的个人回答。所有数字都来自本房间玩家的真实作答，不使用任何外部统计。",
    scoringSummary: `竞猜者：完全猜中 +${POINTS_EXACT}，只差 1 人 +${POINTS_NEAR}。其他人：押对方向 +${POINTS_BET}（竞猜者猜中时没人得押注分）。`,
    contentType: "yesno-prompt",
    options: [
      roundsOption(6),
      secondsOption("answerSeconds", "作答时限", 30),
      secondsOption("betSeconds", "竞猜/押注时限", 45),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: PercentState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      participants: [],
      guesser: "",
      prompt: { contentId: null, text: "" },
      answers: {},
      guess: null,
      bets: {},
      deadlineAt: null,
    };
    return openRound(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startRound(state, r.chosen, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (action.type === "advance") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
      if (state.phase === "answer") return toGuess(state, ctx);
      if (state.phase === "guess" || state.phase === "bet") return settle(state);
      if (state.phase === "reveal") return advance(state, ctx);
      return { ok: false, error: "竞猜者正在选题" };
    }
    if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
    switch (action.type) {
      case "answer": {
        if (state.phase !== "answer") return { ok: false, error: "现在不是作答阶段" };
        if (me in state.answers) return { ok: false, error: "你已经回答过了" };
        state.answers[me] = action.yes;
        return state.participants.every((p) => p in state.answers) ? toGuess(state, ctx) : { ok: true, state };
      }
      case "guess": {
        if (state.phase !== "guess") return { ok: false, error: "现在不是竞猜阶段" };
        if (me !== state.guesser) return { ok: false, error: "这一轮不是你来猜" };
        if (action.count > Object.keys(state.answers).length) return { ok: false, error: "不能超过作答人数" };
        state.guess = action.count;
        state.phase = "bet";
        state.step += 1;
        state.deadlineAt = timer(state.config.betSeconds, ctx);
        return { ok: true, state };
      }
      case "bet": {
        if (state.phase !== "bet") return { ok: false, error: "现在不是押注阶段" };
        if (me === state.guesser) return { ok: false, error: "竞猜者不用押注" };
        if (me in state.bets) return { ok: false, error: "你已经押过了" };
        state.bets[me] = action.side;
        return bettors(state).every((p) => p in state.bets) ? settle(state) : { ok: true, state };
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "answer" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.prompt.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "百分比竞猜");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) => (state.phase === "reveal" || state.phase === "finished" ? null : state.deadlineAt),
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) {
        state.phase = "finished";
        state.step += 1;
        state.deadlineAt = null;
        return { ok: true, state, finished: true };
      }
      startRound(state, c, ctx);
      return { ok: true, state };
    }
    if (state.phase === "answer") return toGuess(state, ctx);
    if (state.phase === "guess" || state.phase === "bet") return settle(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    const seconds = {
      pick: state.config.pickSeconds,
      answer: state.config.answerSeconds,
      guess: state.config.betSeconds,
      bet: state.config.betSeconds,
    };
    if (state.phase in seconds) state.deadlineAt = timer(seconds[state.phase as keyof typeof seconds], ctx);
    return state;
  },

  view(state, viewer) {
    const open = state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.text, PICK.allowCustom) : null,
      participants: state.participants,
      guesser: state.guesser,
      prompt: state.phase === "pick" ? "" : state.prompt.text,
      answered: Object.keys(state.answers),
      myAnswer: state.answers[viewer] ?? null,
      guess: state.guess,
      betters: Object.keys(state.bets),
      myBet: state.bets[viewer] ?? null,
      reveal: open ? { answered: Object.keys(state.answers).length, yes: yesCount(state), bets: state.bets } : null,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `百分比竞猜 第 ${state.round} 轮：竞猜者正在选题`;
    const n = Object.keys(state.answers).length;
    const base = `百分比竞猜 第 ${state.round} 轮，题目「${state.prompt.text}」，阶段：${state.phase}，${n} 人已作答${state.guess !== null ? `，竞猜者猜 ${state.guess} 人答「是」` : ""}`;
    return state.phase === "reveal" || state.phase === "finished"
      ? `${base}。实际 ${yesCount(state)}/${n} 人答「是」（个人回答不公开）`
      : `${base}（结果未公开）`;
  },
});
