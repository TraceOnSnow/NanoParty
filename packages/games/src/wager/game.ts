/**
 * 「估数下注」— everyone estimates a number in secret; the estimates are then shown and
 * everyone bets on which one is closest. Rule spec: docs/games/wager.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { drawPayload, roundsOption, secondsOption, timer } from "../util.ts";

export const POINTS_CLOSEST_GUESS = 2;
export const POINTS_EXACT = 1;
export const POINTS_GOOD_BET = 1;

const payload = z.object({ text: z.string(), unit: z.string(), answer: z.number(), note: z.string().optional() });
const configSchema = z.object({
  rounds: z.number().int().min(0).max(30).default(5),
  answerSeconds: z.number().int().min(0).max(600).default(60),
  betSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("guess"), step: z.number().int(), value: z.number().finite() }),
  /** Bet on the player whose estimate you think is closest (your own is allowed). */
  z.object({ type: z.literal("bet"), step: z.number().int(), on: z.string() }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface WagerState {
  config: Config;
  round: number;
  step: number;
  phase: "guess" | "bet" | "reveal" | "finished";
  participants: PlayerId[];
  question: { contentId: string; text: string; unit: string; answer: number; note?: string };
  guesses: Record<PlayerId, number>;
  bets: Record<PlayerId, PlayerId>;
  closest: PlayerId[];
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface WagerView {
  round: number;
  totalRounds: number;
  step: number;
  phase: WagerState["phase"];
  participants: PlayerId[];
  question: { text: string; unit: string };
  submitted: PlayerId[];
  myGuess: number | null;
  /** All estimates, public from the betting phase on (sorted ascending). */
  guesses: { playerId: PlayerId; value: number }[] | null;
  myBet: PlayerId | null;
  deadlineAt: number | null;
  reveal: { answer: number; note?: string; closest: PlayerId[]; bets: Record<PlayerId, PlayerId> } | null;
}

function startRound(state: WagerState, question: WagerState["question"], ctx: GameContext) {
  state.phase = "guess";
  state.step += 1;
  state.participants = [...ctx.players];
  state.question = question;
  state.guesses = {};
  state.bets = {};
  state.closest = [];
  state.deadlineAt = timer(state.config.answerSeconds, ctx);
}

function settle(state: WagerState): GameResult<WagerState> {
  const entries = Object.entries(state.guesses).map(([p, v]) => ({ p, diff: Math.abs(v - state.question.answer) }));
  const best = entries.length > 0 ? Math.min(...entries.map((e) => e.diff)) : null;
  state.closest = entries.filter((e) => e.diff === best).map((e) => e.p);
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const scores: ScoreAward[] = state.closest.map((p) => ({
    playerId: p,
    points: POINTS_CLOSEST_GUESS + (best === 0 ? POINTS_EXACT : 0),
    reason: best === 0 ? "完全猜中" : "估得最准",
    key: `r${state.round}:closest:${p}`,
  }));
  for (const [bettor, on] of Object.entries(state.bets)) {
    if (state.closest.includes(on)) {
      scores.push({
        playerId: bettor,
        points: POINTS_GOOD_BET,
        reason: "押对了",
        key: `r${state.round}:bet:${bettor}`,
      });
    }
  }
  return { ok: true, state, scores };
}

function beginBet(state: WagerState, ctx: GameContext): GameResult<WagerState> {
  // Betting needs at least two different estimates to choose between.
  if (new Set(Object.values(state.guesses)).size < 2) return settle(state);
  state.phase = "bet";
  state.step += 1;
  state.deadlineAt = timer(state.config.betSeconds, ctx);
  return { ok: true, state };
}

function advance(state: WagerState, ctx: GameContext): GameResult<WagerState> {
  const end = (why: WagerState["endedBecause"]): GameResult<WagerState> => {
    state.phase = "finished";
    state.step += 1;
    state.endedBecause = why;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  };
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return end("rounds");
  const drawn = drawPayload(ctx, payload);
  if (!drawn) return end("no-content");
  state.round += 1;
  startRound(state, { contentId: drawn.contentId, ...drawn.data }, ctx);
  return { ok: true, state };
}

export const wagerGame = defineGame<WagerState, Action, WagerView, Config>({
  meta: {
    id: "wager",
    name: "估数下注",
    description: "先各自秘密估一个数，再看着所有人的估计下注：你觉得谁估得最准？",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮一道答案是数字的题。所有人各自秘密估一个数。全部提交后公开所有估计（从小到大），每人押一位玩家，赌 TA 的估计最接近答案（可以押自己）。然后公开答案。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `估得最接近的玩家 +${POINTS_CLOSEST_GUESS} 分（并列都得），完全猜中再 +${POINTS_EXACT} 分；押中最接近者的玩家 +${POINTS_GOOD_BET} 分。被跳过的题不计分。`,
    contentType: "numeric-fact",
    options: [
      roundsOption(5),
      secondsOption("answerSeconds", "估数时限", 60),
      secondsOption("betSeconds", "下注时限", 45),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const drawn = drawPayload(ctx, payload);
    if (!drawn) return { ok: false, error: "题库中没有可用的题目" };
    const state: WagerState = {
      config,
      round: 1,
      step: 0,
      phase: "guess",
      participants: [],
      question: { contentId: "", text: "", unit: "", answer: 0 },
      guesses: {},
      bets: {},
      closest: [],
      deadlineAt: null,
      endedBecause: null,
    };
    startRound(state, { contentId: drawn.contentId, ...drawn.data }, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    const me = actor.playerId;
    switch (action.type) {
      case "guess": {
        if (state.phase !== "guess") return { ok: false, error: "现在不是估数阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.guesses) return { ok: false, error: "你已经提交过了" };
        state.guesses[me] = action.value;
        return state.participants.every((p) => p in state.guesses) ? beginBet(state, ctx) : { ok: true, state };
      }
      case "bet": {
        if (state.phase !== "bet") return { ok: false, error: "现在不是下注阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.bets) return { ok: false, error: "你已经下注了" };
        if (!(action.on in state.guesses)) return { ok: false, error: "只能押给交了估计的玩家" };
        state.bets[me] = action.on;
        return state.participants.every((p) => p in state.bets) ? settle(state) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "guess") return beginBet(state, ctx);
        if (state.phase === "bet") return settle(state);
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "guess" || state.phase === "bet" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "finished" ? null : state.question.contentId),
  atSafePoint: (state) => state.phase === "reveal",
  deadline: (state) => (state.phase === "guess" || state.phase === "bet" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "guess") return beginBet(state, ctx);
    if (state.phase === "bet") return settle(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "guess") state.deadlineAt = timer(state.config.answerSeconds, ctx);
    if (state.phase === "bet") state.deadlineAt = timer(state.config.betSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const guessing = state.phase === "guess";
    const revealed = state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      participants: state.participants,
      question: { text: state.question.text, unit: state.question.unit },
      submitted: Object.keys(guessing ? state.guesses : state.phase === "bet" ? state.bets : {}),
      myGuess: state.guesses[viewer] ?? null,
      guesses: guessing
        ? null
        : Object.entries(state.guesses)
            .map(([playerId, value]) => ({ playerId, value }))
            .sort((a, b) => a.value - b.value),
      myBet: state.phase === "bet" ? (state.bets[viewer] ?? null) : null,
      deadlineAt: state.deadlineAt,
      reveal: revealed
        ? { answer: state.question.answer, note: state.question.note, closest: state.closest, bets: state.bets }
        : null,
    };
  },

  publicSummary(state) {
    const base = `估数下注 第 ${state.round} 轮，题目：「${state.question.text}」，阶段：${state.phase}`;
    if (state.phase === "reveal" || state.phase === "finished")
      return `${base}，答案 ${state.question.answer}${state.question.unit}（已揭晓）`;
    return `${base}（答案${state.phase === "guess" ? "与各人估计" : "与各人下注"}未公开）`;
  },
});
