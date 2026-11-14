/**
 * 「估数字」— demo game used to validate the architecture end to end.
 *
 * Covers: content from the local library, simultaneous hidden submissions, a secret
 * (the answer) withheld until reveal, deterministic settlement, an optional server-side
 * timer, round binding of actions, and joining at a safe point (next round).
 * Full rule spec: docs/games/estimate.md
 */
import {
  type ContentItem,
  defineGame,
  type GameContext,
  type GameResult,
  type PlayerId,
  type ScoreAward,
} from "@apr/shared";
import { z } from "zod";

export const ESTIMATE_CONTENT_TYPE = "numeric-fact";

const questionPayload = z.object({
  text: z.string(),
  unit: z.string(),
  answer: z.number(),
  note: z.string().optional(),
});
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const estimateContentSchema = questionPayload;

const configSchema = z.object({
  /** 0 = keep going until the host ends the game. */
  rounds: z.number().int().min(0).max(30).default(5),
  /** 0 = no timer; the host can reveal early at any time. */
  answerSeconds: z.number().int().min(0).max(600).default(60),
});
export type EstimateConfig = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit"), round: z.number().int(), value: z.number().finite() }),
  /** Host: reveal now with whatever has been submitted (keeps absent players from blocking). */
  z.object({ type: z.literal("reveal"), round: z.number().int() }),
  /** Host: skip an unsettled question. Nobody scores. */
  z.object({ type: z.literal("skip"), round: z.number().int() }),
  /** Host: continue after the reveal. */
  z.object({ type: z.literal("next"), round: z.number().int() }),
]);
export type EstimateAction = z.infer<typeof actionSchema>;

interface Question {
  contentId: string;
  contentVersion: number;
  text: string;
  unit: string;
  answer: number;
  note?: string;
}

export interface RoundResult {
  playerId: PlayerId;
  guess: number;
  diff: number;
  points: number;
}

export interface EstimateState {
  config: EstimateConfig;
  round: number;
  phase: "answering" | "reveal" | "finished";
  participants: PlayerId[];
  question: Question;
  guesses: Record<PlayerId, number>;
  deadlineAt: number | null;
  results: RoundResult[] | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface EstimateView {
  round: number;
  totalRounds: number;
  phase: EstimateState["phase"];
  participants: PlayerId[];
  question: { text: string; unit: string };
  /** Who has submitted (public); the values stay hidden until reveal. */
  submitted: PlayerId[];
  myGuess: number | null;
  deadlineAt: number | null;
  /** Only present from the reveal on. */
  reveal: { answer: number; note?: string; results: RoundResult[] } | null;
  endedBecause: EstimateState["endedBecause"];
}

export const POINTS_CLOSEST = 2;
export const POINTS_EXACT_BONUS = 1;

function toQuestion(item: ContentItem): Question | null {
  const parsed = questionPayload.safeParse(item.payload);
  if (!parsed.success) return null;
  return { contentId: item.id, contentVersion: item.version, ...parsed.data };
}

function drawQuestion(ctx: GameContext): Question | null {
  for (let item = ctx.drawContent(); item; item = ctx.drawContent()) {
    const q = toQuestion(item);
    if (q) return q;
  }
  return null;
}

function startRound(state: EstimateState, question: Question, ctx: GameContext): void {
  state.phase = "answering";
  state.question = question;
  state.participants = [...ctx.players];
  state.guesses = {};
  state.results = null;
  state.deadlineAt = state.config.answerSeconds > 0 ? ctx.now + state.config.answerSeconds * 1000 : null;
}

function settle(state: EstimateState): ScoreAward[] {
  const entries = Object.entries(state.guesses).map(([playerId, guess]) => ({
    playerId,
    guess,
    diff: Math.abs(guess - state.question.answer),
  }));
  const best = entries.length > 0 ? Math.min(...entries.map((e) => e.diff)) : null;
  state.results = entries
    .map((e) => ({
      ...e,
      points: e.diff === best ? POINTS_CLOSEST + (e.diff === 0 ? POINTS_EXACT_BONUS : 0) : 0,
    }))
    .sort((a, b) => a.diff - b.diff);
  state.phase = "reveal";
  state.deadlineAt = null;
  return state.results
    .filter((r) => r.points > 0)
    .map((r) => ({
      playerId: r.playerId,
      points: r.points,
      reason: r.diff === 0 ? "完全猜中" : "最接近",
      key: `r${state.round}:closest:${r.playerId}`,
    }));
}

function advance(state: EstimateState, ctx: GameContext): GameResult<EstimateState> {
  const { rounds } = state.config;
  if (rounds > 0 && state.round >= rounds) {
    state.phase = "finished";
    state.endedBecause = "rounds";
    return { ok: true, state, finished: true };
  }
  const question = drawQuestion(ctx);
  if (!question) {
    state.phase = "finished";
    state.endedBecause = "no-content";
    return { ok: true, state, finished: true };
  }
  state.round += 1;
  startRound(state, question, ctx);
  return { ok: true, state };
}

export const estimateGame = defineGame<EstimateState, EstimateAction, EstimateView, EstimateConfig>({
  meta: {
    id: "estimate",
    name: "估数字",
    description: "每轮一道数字题，所有人同时秘密作答，最接近的人得分。（架构验证用示例玩法）",
    minPlayers: 2,
    maxPlayers: 8,
    rulesSummary:
      "每轮展示一道答案是数字的题目。所有人各自提交一个数字，提交后不可修改，揭晓前互相看不到。全部提交、超时或房主提前揭晓后公布答案。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `最接近答案的玩家得 ${POINTS_CLOSEST} 分（并列都得分），完全猜中再加 ${POINTS_EXACT_BONUS} 分；被跳过的题不计分。`,
    contentType: ESTIMATE_CONTENT_TYPE,
    options: [
      { key: "rounds", label: "轮数", min: 0, max: 30, default: 5, hint: "0 = 不限" },
      { key: "answerSeconds", label: "答题时限（秒）", min: 0, max: 600, default: 60, hint: "0 = 不限时" },
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 2) return { ok: false, error: "至少需要 2 名玩家" };
    const question = drawQuestion(ctx);
    if (!question) return { ok: false, error: "题库中没有可用的题目" };
    const state: EstimateState = {
      config,
      round: 1,
      phase: "answering",
      participants: [],
      question,
      guesses: {},
      deadlineAt: null,
      results: null,
      endedBecause: null,
    };
    startRound(state, question, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    // Round binding: a late or retried action for an earlier round must never hit the current one.
    if (action.round !== state.round) return { ok: false, error: "该操作属于已结束的回合" };

    switch (action.type) {
      case "submit": {
        if (state.phase !== "answering") return { ok: false, error: "当前不在答题阶段" };
        if (!state.participants.includes(actor.playerId)) return { ok: false, error: "你将从下一轮开始参与" };
        if (actor.playerId in state.guesses) return { ok: false, error: "你已经提交过了" };
        state.guesses[actor.playerId] = action.value;
        const everyoneIn = state.participants.every((p) => p in state.guesses);
        return everyoneIn ? { ok: true, state, scores: settle(state) } : { ok: true, state };
      }
      case "reveal": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以提前揭晓" };
        if (state.phase !== "answering") return { ok: false, error: "当前不在答题阶段" };
        return { ok: true, state, scores: settle(state) };
      }
      case "skip": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以直接跳题" };
        if (state.phase !== "answering") return { ok: false, error: "只能跳过尚未结算的题目" };
        return advance(state, ctx);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以进入下一轮" };
        if (state.phase !== "reveal") return { ok: false, error: "当前回合尚未揭晓" };
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "answering" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "finished" ? null : state.question.contentId),

  atSafePoint: (state) => state.phase === "reveal",
  deadline: (state) => (state.phase === "answering" ? state.deadlineAt : null),

  onTimeout(state) {
    if (state.phase !== "answering") return { ok: true, state };
    return { ok: true, state, scores: settle(state) };
  },

  onResume(state, ctx) {
    // Downtime is not counted against players: the answer timer restarts in full.
    if (state.phase === "answering" && state.config.answerSeconds > 0) {
      state.deadlineAt = ctx.now + state.config.answerSeconds * 1000;
    }
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase !== "answering";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      phase: state.phase,
      participants: state.participants,
      question: { text: state.question.text, unit: state.question.unit },
      submitted: Object.keys(state.guesses),
      myGuess: state.guesses[viewer] ?? null,
      deadlineAt: state.deadlineAt,
      reveal:
        revealed && state.results
          ? { answer: state.question.answer, note: state.question.note, results: state.results }
          : null,
      endedBecause: state.endedBecause,
    };
  },

  publicSummary(state) {
    const base = `估数字 第 ${state.round} 轮，阶段：${state.phase}，题目：「${state.question.text}」`;
    if (state.phase === "answering") {
      return `${base}，已提交 ${Object.keys(state.guesses).length}/${state.participants.length} 人（答案与各人作答未公开）`;
    }
    return `${base}，答案 ${state.question.answer}${state.question.unit}（已揭晓）`;
  },
});
