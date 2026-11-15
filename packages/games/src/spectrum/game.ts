/**
 * 「猜刻度」— spectrum guessing game (mechanic reference: spectrum/"wavelength"-style party games).
 *
 * Each round one player (the clue giver) secretly sees a target position on a two-pole scale and
 * writes a short clue; everyone else places a guess on the scale at the same time; then the
 * target is revealed. Full rule spec: docs/games/spectrum.md
 */
import {
  type CandidateRecord,
  type CandidateStatus,
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
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const spectrumContentSchema = payloadSchema;

const configSchema = z.object({
  /** 0 = keep going until the host ends the game. */
  rounds: z.number().int().min(0).max(40).default(6),
  /** Time for the clue giver to settle on a scale. On timeout the first candidate is used. */
  pickSeconds: z.number().int().min(0).max(600).default(90),
  clueSeconds: z.number().int().min(0).max(600).default(120),
  guessSeconds: z.number().int().min(0).max(600).default(90),
});
export type SpectrumConfig = z.infer<typeof configSchema>;

const position = z.number().int().min(0).max(100);
const pole = z.string().trim().min(1).max(12);
const actionSchema = z.discriminatedUnion("type", [
  /** Clue giver, before the round formally starts: take one of the candidate scales... */
  z.object({ type: z.literal("choose"), round: z.number().int(), index: z.number().int().min(0) }),
  /** ...ask for other candidates (no limit; this is not a skip)... */
  z.object({ type: z.literal("refresh"), round: z.number().int() }),
  /** ...take a scale shown earlier in this party (also how an AI suggestion is accepted)... */
  z.object({ type: z.literal("chooseHistory"), round: z.number().int(), contentId: z.string() }),
  z.object({ type: z.literal("history"), round: z.number().int() }),
  /** ...or write their own scale. */
  z.object({ type: z.literal("custom"), round: z.number().int(), left: pole, right: pole }),
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

/** `contentId` is null for a scale written by a player. */
interface Scale {
  contentId: string | null;
  left: string;
  right: string;
}

export const CANDIDATES = 3;
const MAX_OFFERED = 6;

export interface SpectrumState {
  config: SpectrumConfig;
  round: number;
  phase: "pick" | "clue" | "guessing" | "reveal" | "finished";
  participants: PlayerId[];
  giver: PlayerId;
  /** How many turns as clue giver each player has had; drives fair rotation. */
  turns: Record<PlayerId, number>;
  /** Scales the clue giver is choosing from (pick phase). */
  candidates: Scale[];
  /** Legacy field of states saved before candidate history existed; no longer filled. */
  queued: Scale[];
  /** Scales shown earlier in this party that the clue giver may still take. */
  history?: (Scale & { contentId: string; status: CandidateStatus; origin: CandidateRecord["origin"] })[];
  scale: Scale;
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
  /** Public: everyone may watch (and lobby) while the clue giver chooses. */
  candidates: { left: string; right: string }[];
  history: { contentId: string; label: string; status: CandidateStatus; origin: CandidateRecord["origin"] }[];
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

const toScale = (item: ContentItem): Scale | null => {
  const parsed = payloadSchema.safeParse(item.payload);
  return parsed.success ? { contentId: item.id, ...parsed.data } : null;
};

const peekCandidates = (ctx: GameContext): Scale[] =>
  ctx
    .peekContent(CANDIDATES)
    .map(toScale)
    .filter((sc): sc is Scale => sc !== null);

/** Scales are public, so every past candidate of the party qualifies. */
function loadHistory(state: SpectrumState, ctx: GameContext) {
  state.history = ctx.history
    .flatMap((r) => {
      const scale = toScale(r.item);
      return scale ? [{ ...scale, contentId: r.item.id, status: r.status, origin: r.origin }] : [];
    })
    .filter((h) => !state.candidates.some((c) => c.contentId === h.contentId))
    .slice(0, 40);
}

const timer = (seconds: number, ctx: GameContext) => (seconds > 0 ? ctx.now + seconds * 1000 : null);

/** Opens a round with the topic choice. The round only formally starts once a scale is confirmed. */
function startRound(state: SpectrumState, ctx: GameContext) {
  state.participants = [...ctx.players];
  // The participant with the fewest turns gives the next clue (ties: join order).
  let giver = state.participants[0] as PlayerId;
  for (const p of state.participants) if ((state.turns[p] ?? 0) < (state.turns[giver] ?? 0)) giver = p;
  state.turns[giver] = (state.turns[giver] ?? 0) + 1;
  state.giver = giver;
  // Avoid the extreme ends so a clue always has room on both sides.
  state.target = 5 + Math.floor(ctx.random() * 91);
  state.candidates = peekCandidates(ctx);
  state.queued = [];
  loadHistory(state, ctx);
  state.scale = { contentId: null, left: "", right: "" };
  state.clue = null;
  state.guesses = {};
  state.results = null;
  state.giverPoints = null;
  state.phase = "pick";
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
}

function beginClue(state: SpectrumState, scale: Scale, ctx: GameContext) {
  if (scale.contentId) ctx.consumeContent(scale.contentId);
  state.scale = scale;
  state.candidates = [];
  state.history = [];
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
  if (state.config.rounds > 0 && state.round >= state.config.rounds) {
    state.phase = "finished";
    state.endedBecause = "rounds";
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  }
  state.round += 1;
  startRound(state, ctx);
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
      "每轮有一条两端相反的刻度（例如 冷 ↔ 热）。轮到的提示者先选题：从候选刻度里挑一条、不限次数地换一批，或者自己出一条；确认后才正式开始。然后提示者会看到刻度上的秘密位置，并写一句提示（不能含数字）。其他人各自拖动滑块猜位置，互相看不到，全部提交后揭晓。提示者轮流担任；中途加入的玩家从下一轮开始参与。",
    scoringSummary: `猜测与目标相差 ≤${SCORE_BANDS[0].within} 得 ${SCORE_BANDS[0].points} 分，≤${SCORE_BANDS[1].within} 得 ${SCORE_BANDS[1].points} 分，≤${SCORE_BANDS[2].within} 得 ${SCORE_BANDS[2].points} 分（刻度 0–100）。提示者得到猜测者得分的平均值（四舍五入）。被跳过的轮次不计分。`,
    contentType: SPECTRUM_CONTENT_TYPE,
    options: [
      { key: "rounds", label: "轮数", min: 0, max: 40, default: 6, hint: "0 = 不限" },
      { key: "pickSeconds", label: "选题时限（秒）", min: 0, max: 600, default: 90, hint: "0 = 不限时" },
      { key: "clueSeconds", label: "写提示时限（秒）", min: 0, max: 600, default: 120, hint: "0 = 不限时" },
      { key: "guessSeconds", label: "猜测时限（秒）", min: 0, max: 600, default: 90, hint: "0 = 不限时" },
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 2) return { ok: false, error: "至少需要 2 名玩家" };
    const state: SpectrumState = {
      config,
      round: 1,
      phase: "pick",
      participants: [],
      giver: "",
      turns: {},
      candidates: [],
      queued: [],
      scale: { contentId: null, left: "", right: "" },
      target: 0,
      clue: null,
      guesses: {},
      deadlineAt: null,
      results: null,
      giverPoints: null,
      endedBecause: null,
    };
    startRound(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.round !== state.round) return { ok: false, error: "该操作属于已结束的回合" };

    switch (action.type) {
      case "choose":
      case "refresh":
      case "chooseHistory":
      case "history":
      case "custom": {
        if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定了" };
        if (actor.playerId !== state.giver) return { ok: false, error: "这一轮由提示者选题" };
        if (action.type === "history") {
          loadHistory(state, ctx);
          return { ok: true, state };
        }
        if (action.type === "chooseHistory") {
          loadHistory(state, ctx);
          const entry = state.history?.find((h) => h.contentId === action.contentId);
          if (!entry) return { ok: false, error: "历史里没有这条刻度" };
          beginClue(state, { contentId: entry.contentId, left: entry.left, right: entry.right }, ctx);
          return { ok: true, state };
        }
        if (action.type === "refresh") {
          const fresh = peekCandidates(ctx);
          if (fresh.length === 0) return { ok: false, error: "题库里没有更多候选了，可以自己出一条" };
          state.candidates = fresh;
          loadHistory(state, ctx);
          return { ok: true, state };
        }
        if (action.type === "choose") {
          const picked = state.candidates[action.index];
          if (!picked) return { ok: false, error: "没有这个候选" };
          beginClue(state, picked, ctx);
          return { ok: true, state };
        }
        if (action.left === action.right) return { ok: false, error: "两端需要是不同的概念" };
        beginClue(state, { contentId: null, left: action.left, right: action.right }, ctx);
        return {
          ok: true,
          state,
          contributed: [
            {
              type: SPECTRUM_CONTENT_TYPE,
              theme: "玩家自拟",
              payload: { left: action.left, right: action.right },
              authorId: actor.playerId,
            },
          ],
        };
      }
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

  // Changing the topic before the round starts is not a skip; skipping applies once it has started.
  skip: {
    key: (state) => (state.phase === "clue" || state.phase === "guessing" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.scale.contentId),
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",

  offer(state, items, _ctx) {
    const scales = items
      .map(toScale)
      .filter((sc): sc is Scale => sc !== null)
      .slice(0, MAX_OFFERED);
    if (scales.length === 0) return { ok: false, error: "这些内容不是「猜刻度」能用的刻度" };
    // The runtime only hands candidates over while the choice is open; anything else goes to the history.
    if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定，不能再替换" };
    state.candidates = scales;
    return { ok: true, state, message: `已作为候选题展示给本轮提示者（${scales.length} 条），由 TA 决定用哪条` };
  },

  deadline: (state) =>
    state.phase === "pick" || state.phase === "clue" || state.phase === "guessing" ? state.deadlineAt : null,

  onTimeout(state, ctx) {
    // No choice in time: the first candidate is used (or the round is void if there is none).
    if (state.phase === "pick") {
      const first = state.candidates[0];
      if (!first) return advance(state, ctx);
      beginClue(state, first, ctx);
      return { ok: true, state };
    }
    // No clue in time: the round is void and play moves on. No guesses in time: settle what we have.
    if (state.phase === "clue") return advance(state, ctx);
    if (state.phase === "guessing") return { ok: true, state, scores: settle(state) };
    return { ok: true, state };
  },

  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
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
      candidates: state.candidates.map((c) => ({ left: c.left, right: c.right })),
      history:
        state.phase === "pick"
          ? (state.history ?? []).map((h) => ({
              contentId: h.contentId,
              label: `${h.left} ↔ ${h.right}`,
              status: h.status,
              origin: h.origin,
            }))
          : [],
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
    if (state.phase === "pick") {
      return `猜刻度 第 ${state.round} 轮，选题中：提示者正在从候选刻度里选一条（可换一批或自己出题），尚未正式开始。候选：${state.candidates.map((c) => `${c.left}↔${c.right}`).join("、") || "无"}`;
    }
    const base = `猜刻度 第 ${state.round} 轮，刻度「${state.scale.left} ↔ ${state.scale.right}」，阶段：${state.phase}`;
    if (state.phase === "clue") return `${base}，等待提示者写提示（目标位置未公开）`;
    if (state.phase === "guessing") {
      return `${base}，提示「${state.clue}」，已猜 ${Object.keys(state.guesses).length}/${guessers(state).length} 人（目标位置与各人猜测未公开）`;
    }
    return `${base}，提示「${state.clue}」，目标位置 ${state.target}（已揭晓）`;
  },
});
