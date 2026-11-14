/**
 * 「猜刻度」— spectrum guessing game (mechanic reference: spectrum/"wavelength"-style party games).
 *
 * Each round one player (the clue giver) secretly sees a target position on a two-pole scale and
 * writes a short clue; everyone else places a guess on the scale at the same time; then the
 * target is revealed. Full rule spec: docs/games/spectrum.md
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

export const SPECTRUM_CONTENT_TYPE = "spectrum";
export const CLUE_MAX = 30;
/** Guess distance (0–100 scale) -> points. First matching band wins. */
export const SCORE_BANDS = [
  { within: 5, points: 4 },
  { within: 12, points: 3 },
  { within: 22, points: 2 },
] as const;

const payloadSchema = z.object({ left: z.string(), right: z.string() });

const configSchema = z.object({
  /** 0 = keep going until the host ends the game. */
  rounds: z.number().int().min(0).max(40).default(6),
  clueSeconds: z.number().int().min(0).max(600).default(120),
  guessSeconds: z.number().int().min(0).max(600).default(90),
});
export type SpectrumConfig = z.infer<typeof configSchema>;

const position = z.number().int().min(0).max(100);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clue"), round: z.number().int(), text: z.string().trim().min(1).max(CLUE_MAX) }),
  z.object({ type: z.literal("guess"), round: z.number().int(), value: position }),
  /** Host: reveal with the guesses received so far. */
  z.object({ type: z.literal("reveal"), round: z.number().int() }),
  /** Host: skip an unsettled round (e.g. the clue giver is away). Nobody scores. */
  z.object({ type: z.literal("skip"), round: z.number().int() }),
  z.object({ type: z.literal("next"), round: z.number().int() }),
]);
export type SpectrumAction = z.infer<typeof actionSchema>;

export interface SpectrumResult {
  playerId: PlayerId;
  guess: number;
  distance: number;
  points: number;
}

export interface SpectrumState {
  config: SpectrumConfig;
  round: number;
  phase: "clue" | "guessing" | "reveal" | "finished";
  participants: PlayerId[];
  giver: PlayerId;
  /** How many turns as clue giver each player has had; drives fair rotation. */
  turns: Record<PlayerId, number>;
  scale: { contentId: string; left: string; right: string };
  target: number;
  clue: string | null;
  guesses: Record<PlayerId, number>;
  deadlineAt: number | null;
  results: SpectrumResult[] | null;
  giverPoints: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface SpectrumView {
  round: number;
  totalRounds: number;
  phase: SpectrumState["phase"];
  participants: PlayerId[];
  giver: PlayerId;
  scale: { left: string; right: string };
  /** Only for the clue giver before the reveal; for everyone afterwards. */
  target: number | null;
  clue: string | null;
  submitted: PlayerId[];
  myGuess: number | null;
  deadlineAt: number | null;
  reveal: { results: SpectrumResult[]; giverPoints: number } | null;
  endedBecause: SpectrumState["endedBecause"];
}

function drawScale(ctx: GameContext): SpectrumState["scale"] | null {
  for (let item: ContentItem | null = ctx.drawContent(); item; item = ctx.drawContent()) {
    const parsed = payloadSchema.safeParse(item.payload);
    if (parsed.success) return { contentId: item.id, ...parsed.data };
  }
  return null;
}

const timer = (seconds: number, ctx: GameContext) => (seconds > 0 ? ctx.now + seconds * 1000 : null);

function startRound(state: SpectrumState, scale: SpectrumState["scale"], ctx: GameContext) {
  state.participants = [...ctx.players];
  // The participant with the fewest turns gives the next clue (ties: join order).
  let giver = state.participants[0] as PlayerId;
  for (const p of state.participants) if ((state.turns[p] ?? 0) < (state.turns[giver] ?? 0)) giver = p;
  state.turns[giver] = (state.turns[giver] ?? 0) + 1;
  state.giver = giver;
  state.scale = scale;
  // Avoid the extreme ends so a clue always has room on both sides.
  state.target = 5 + Math.floor(ctx.random() * 91);
  state.clue = null;
  state.guesses = {};
  state.results = null;
  state.giverPoints = null;
  state.phase = "clue";
  state.deadlineAt = timer(state.config.clueSeconds, ctx);
}

export function pointsFor(distance: number): number {
  return SCORE_BANDS.find((b) => distance <= b.within)?.points ?? 0;
}

function settle(state: SpectrumState): ScoreAward[] {
  state.results = Object.entries(state.guesses)
    .map(([playerId, guess]) => {
      const distance = Math.abs(guess - state.target);
      return { playerId, guess, distance, points: pointsFor(distance) };
    })
    .sort((a, b) => a.distance - b.distance);
  // The clue giver earns the (rounded) average of what the guessers earned.
  const total = state.results.reduce((sum, r) => sum + r.points, 0);
  state.giverPoints = state.results.length > 0 ? Math.round(total / state.results.length) : 0;
  state.phase = "reveal";
  state.deadlineAt = null;
  const awards: ScoreAward[] = state.results
    .filter((r) => r.points > 0)
    .map((r) => ({
      playerId: r.playerId,
      points: r.points,
      reason: "猜中刻度",
      key: `r${state.round}:guess:${r.playerId}`,
    }));
  if (state.giverPoints > 0) {
    awards.push({
      playerId: state.giver,
      points: state.giverPoints,
      reason: "提示有效",
      key: `r${state.round}:giver:${state.giver}`,
    });
  }
  return awards;
}

function advance(state: SpectrumState, ctx: GameContext): GameResult<SpectrumState> {
  const finish = (why: SpectrumState["endedBecause"]): GameResult<SpectrumState> => {
    state.phase = "finished";
    state.endedBecause = why;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  };
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return finish("rounds");
  const scale = drawScale(ctx);
  if (!scale) return finish("no-content");
  state.round += 1;
  startRound(state, scale, ctx);
  return { ok: true, state };
}

const guessers = (state: SpectrumState) => state.participants.filter((p) => p !== state.giver);

export const spectrumGame = defineGame<SpectrumState, SpectrumAction, SpectrumView, SpectrumConfig>({
  meta: {
    id: "spectrum",
    name: "猜刻度",
    description: "一个人看到刻度上的秘密位置并给出一句提示，其他人猜它在哪。考验默契。",
    minPlayers: 2,
    maxPlayers: 8,
    rulesSummary:
      "每轮有一条两端相反的刻度（例如 冷 ↔ 热）。轮到的提示者会看到刻度上的秘密位置，并写一句提示（不能含数字）。其他人各自拖动滑块猜位置，互相看不到，全部提交后揭晓。提示者轮流担任；中途加入的玩家从下一轮开始参与。",
    scoringSummary: `猜测与目标相差 ≤${SCORE_BANDS[0].within} 得 ${SCORE_BANDS[0].points} 分，≤${SCORE_BANDS[1].within} 得 ${SCORE_BANDS[1].points} 分，≤${SCORE_BANDS[2].within} 得 ${SCORE_BANDS[2].points} 分（刻度 0–100）。提示者得到猜测者得分的平均值（四舍五入）。被跳过的轮次不计分。`,
    contentType: SPECTRUM_CONTENT_TYPE,
    options: [
      { key: "rounds", label: "轮数", min: 0, max: 40, default: 6, hint: "0 = 不限" },
      { key: "clueSeconds", label: "写提示时限（秒）", min: 0, max: 600, default: 120, hint: "0 = 不限时" },
      { key: "guessSeconds", label: "猜测时限（秒）", min: 0, max: 600, default: 90, hint: "0 = 不限时" },
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 2) return { ok: false, error: "至少需要 2 名玩家" };
    const scale = drawScale(ctx);
    if (!scale) return { ok: false, error: "题库中没有可用的刻度" };
    const state: SpectrumState = {
      config,
      round: 1,
      phase: "clue",
      participants: [],
      giver: "",
      turns: {},
      scale,
      target: 0,
      clue: null,
      guesses: {},
      deadlineAt: null,
      results: null,
      giverPoints: null,
      endedBecause: null,
    };
    startRound(state, scale, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.round !== state.round) return { ok: false, error: "该操作属于已结束的回合" };

    switch (action.type) {
      case "clue": {
        if (state.phase !== "clue") return { ok: false, error: "现在不是写提示的阶段" };
        if (actor.playerId !== state.giver) return { ok: false, error: "这一轮不是你给提示" };
        if (/[0-9０-９]/.test(action.text)) return { ok: false, error: "提示里不能包含数字" };
        state.clue = action.text;
        state.phase = "guessing";
        state.deadlineAt = timer(state.config.guessSeconds, ctx);
        return { ok: true, state };
      }
      case "guess": {
        if (state.phase !== "guessing") return { ok: false, error: "现在不是猜测阶段" };
        if (actor.playerId === state.giver) return { ok: false, error: "提示者不能猜" };
        if (!state.participants.includes(actor.playerId)) return { ok: false, error: "你将从下一轮开始参与" };
        if (actor.playerId in state.guesses) return { ok: false, error: "你已经提交过了" };
        state.guesses[actor.playerId] = action.value;
        return guessers(state).every((p) => p in state.guesses)
          ? { ok: true, state, scores: settle(state) }
          : { ok: true, state };
      }
      case "reveal": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以提前揭晓" };
        if (state.phase !== "guessing") return { ok: false, error: "现在不是猜测阶段" };
        return { ok: true, state, scores: settle(state) };
      }
      case "skip": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以直接跳过" };
        if (state.phase !== "clue" && state.phase !== "guessing") return { ok: false, error: "只能跳过尚未结算的回合" };
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
    key: (state) => (state.phase === "clue" || state.phase === "guessing" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "finished" ? null : state.scale.contentId),

  deadline: (state) => (state.phase === "clue" || state.phase === "guessing" ? state.deadlineAt : null),

  onTimeout(state, ctx) {
    // No clue in time: the round is void and play moves on. No guesses in time: settle what we have.
    if (state.phase === "clue") return advance(state, ctx);
    if (state.phase === "guessing") return { ok: true, state, scores: settle(state) };
    return { ok: true, state };
  },

  onResume(state, ctx) {
    if (state.phase === "clue") state.deadlineAt = timer(state.config.clueSeconds, ctx);
    if (state.phase === "guessing") state.deadlineAt = timer(state.config.guessSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      phase: state.phase,
      participants: state.participants,
      giver: state.giver,
      scale: { left: state.scale.left, right: state.scale.right },
      target: revealed || viewer === state.giver ? state.target : null,
      clue: state.clue,
      submitted: Object.keys(state.guesses),
      myGuess: state.guesses[viewer] ?? null,
      deadlineAt: state.deadlineAt,
      reveal: revealed && state.results ? { results: state.results, giverPoints: state.giverPoints ?? 0 } : null,
      endedBecause: state.endedBecause,
    };
  },

  publicSummary(state) {
    const base = `猜刻度 第 ${state.round} 轮，刻度「${state.scale.left} ↔ ${state.scale.right}」，阶段：${state.phase}`;
    if (state.phase === "clue") return `${base}，等待提示者写提示（目标位置未公开）`;
    if (state.phase === "guessing") {
      return `${base}，提示「${state.clue}」，已猜 ${Object.keys(state.guesses).length}/${guessers(state).length} 人（目标位置与各人猜测未公开）`;
    }
    return `${base}，提示「${state.clue}」，目标位置 ${state.target}（已揭晓）`;
  },
});
