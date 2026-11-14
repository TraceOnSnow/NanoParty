/**
 * 「问出秘密词」— timed yes/no questions to find a secret word, with hidden roles.
 * The mayor (a player) knows the word and answers. Among the others, the wolf also knows it and
 * misleads; the seer knows it and helps without being spotted. Rule spec: docs/games/wordhunt.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { oneclueContentSchema } from "../oneclue/game.ts";
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
import { groupVotes, norm, secondsOption, shuffle, timer } from "../util.ts";

export const POINTS_WIN = 3;
const payload = oneclueContentSchema;
type Word = z.infer<typeof payload>;

const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(10).default(3),
  askSeconds: z.number().int().min(30).max(900).default(240),
  /** Time for the wolves to name the seer, or for everyone to name a wolf. */
  voteSeconds: z.number().int().min(0).max(600).default(90),
});
type Config = z.infer<typeof configSchema>;

export const ANSWERS = ["yes", "no", "maybe", "close", "far"] as const;
export type Answer = (typeof ANSWERS)[number];
export type HuntRole = "wolf" | "seer" | "villager";

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("ask"), step: z.number().int(), text: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("answer"), step: z.number().int(), id: z.number().int(), answer: z.enum(ANSWERS) }),
  /** Mayor: this question named the word (or close enough). */
  z.object({ type: z.literal("correct"), step: z.number().int(), id: z.number().int() }),
  /** Anyone but the mayor: say the word outright. */
  z.object({ type: z.literal("guess"), step: z.number().int(), text: z.string().trim().min(1).max(20) }),
  /** Wolves name the seer / everyone names a wolf. */
  z.object({ type: z.literal("accuse"), step: z.number().int(), target: z.string() }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

interface Question {
  id: number;
  by: PlayerId;
  text: string;
  answer: Answer | "correct" | null;
}

export interface WordHuntState {
  config: Config;
  pick: PickState<Word>;
  round: number;
  step: number;
  /** ask → found (wolves hunt the seer) or ask → timeUp (everyone hunts a wolf) → reveal. */
  phase: "pick" | "ask" | "found" | "timeUp" | "reveal" | "finished";
  mayor: PlayerId;
  participants: PlayerId[];
  roles: Record<PlayerId, HuntRole>;
  word: { contentId: string | null; text: string };
  questions: Question[];
  nextId: number;
  finder: PlayerId | null;
  accusations: Record<PlayerId, PlayerId>;
  accused: PlayerId | null;
  winner: "village" | "wolves" | null;
  deadlineAt: number | null;
  endedBecause: "rounds" | null;
}

export interface WordHuntView {
  round: number;
  totalRounds: number;
  step: number;
  phase: WordHuntState["phase"];
  pick: PickView | null;
  mayor: PlayerId;
  participants: PlayerId[];
  myRole: HuntRole | "mayor" | null;
  /** Mayor, wolves and seer know the word; everyone after the reveal. */
  word: string | null;
  /** Wolves see each other. */
  fellowWolves: PlayerId[];
  questions: Question[];
  finder: PlayerId | null;
  /** Who may accuse in the current phase. */
  accusers: PlayerId[];
  submitted: PlayerId[];
  myAccusation: PlayerId | null;
  deadlineAt: number | null;
  reveal: { roles: Record<PlayerId, HuntRole>; accused: PlayerId | null; winner: "village" | "wolves" } | null;
}

const PICK = { schema: payload, contentType: "guess-word", allowCustom: true };
export const wolvesFor = (others: number) => (others >= 6 ? 2 : 1);

function openRound(state: WordHuntState, ctx: GameContext): GameResult<WordHuntState> {
  state.phase = "pick";
  state.step += 1;
  state.participants = [...ctx.players];
  state.mayor = rotatePicker(state.pick, state.participants);
  openPick(state.pick, state.mayor, payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startRound(state: WordHuntState, c: { contentId: string | null; data: Word }, ctx: GameContext) {
  state.word = { contentId: c.contentId, text: c.data.word };
  const others = shuffle(
    state.participants.filter((p) => p !== state.mayor),
    ctx.random,
  );
  const wolves = wolvesFor(others.length);
  state.roles = Object.fromEntries(
    others.map((p, i) => [p, i < wolves ? "wolf" : i === wolves ? "seer" : "villager"] as const),
  );
  state.questions = [];
  state.nextId = 1;
  state.finder = null;
  state.accusations = {};
  state.accused = null;
  state.winner = null;
  state.phase = "ask";
  state.step += 1;
  state.deadlineAt = timer(state.config.askSeconds, ctx);
}

const wolves = (state: WordHuntState) => Object.keys(state.roles).filter((p) => state.roles[p] === "wolf");
const accusers = (state: WordHuntState) =>
  state.phase === "found" ? wolves(state) : state.phase === "timeUp" ? state.participants : [];

function settle(state: WordHuntState, winner: "village" | "wolves"): GameResult<WordHuntState> {
  state.winner = winner;
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const winners = state.participants.filter((p) =>
    winner === "wolves" ? state.roles[p] === "wolf" : state.roles[p] !== "wolf",
  );
  const scores: ScoreAward[] = winners.map((p) => ({
    playerId: p,
    points: POINTS_WIN,
    reason: winner === "wolves" ? "狼人获胜" : "村民获胜",
    key: `r${state.round}:win:${p}`,
  }));
  return { ok: true, state, scores };
}

function found(state: WordHuntState, finder: PlayerId, ctx: GameContext): GameResult<WordHuntState> {
  state.finder = finder;
  state.phase = "found";
  state.step += 1;
  state.deadlineAt = timer(state.config.voteSeconds, ctx);
  return { ok: true, state };
}

/** Closes the accusation phase with what has been submitted. */
function closeAccusations(state: WordHuntState): GameResult<WordHuntState> {
  const groups = groupVotes(state.accusations);
  const top = Math.max(0, ...[...groups.values()].map((v) => v.length));
  const leaders = [...groups.entries()].filter(([, v]) => v.length === top).map(([p]) => p);
  state.accused = top > 0 && leaders.length === 1 ? (leaders[0] as PlayerId) : null;
  if (state.phase === "found") {
    // The word was found: the wolves still win if they spot the seer.
    return settle(state, state.accused && state.roles[state.accused] === "seer" ? "wolves" : "village");
  }
  // Time ran out: the village still wins if it spots a wolf.
  return settle(state, state.accused && state.roles[state.accused] === "wolf" ? "village" : "wolves");
}

function advance(state: WordHuntState, ctx: GameContext): GameResult<WordHuntState> {
  if ((state.config.rounds > 0 && state.round >= state.config.rounds) || ctx.players.length < 4) {
    state.phase = "finished";
    state.step += 1;
    state.endedBecause = "rounds";
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  }
  state.round += 1;
  return openRound(state, ctx);
}

const pending = (state: WordHuntState, p: PlayerId) => state.questions.some((q) => q.by === p && q.answer === null);

export const wordHuntGame = defineGame<WordHuntState, Action, WordHuntView, Config>({
  meta: {
    id: "wordhunt",
    name: "问出秘密词",
    description: "限时用是非问题问出村长心里的词——但狼人也知道答案，在暗中带偏大家。",
    minPlayers: 4,
    maxPlayers: 8,
    rulesSummary:
      "每轮一名玩家（轮流）当村长，秘密选一个词（别人看不到候选）。其他人里秘密抽出狼人（7 人以上 2 个）和预言家，其余是村民；狼人和预言家也知道这个词。大家在网页上提问，村长回答「是 / 不是 / 也许 / 很接近 / 差得远」，每人同时只能有一条问题在等回答；随时可以直接猜词。限时内猜出词：狼人有一次机会指认预言家，指认对了狼人赢，否则村民赢。时间到还没猜出：所有人投票找狼人，票数最多且唯一的人是狼人则村民赢，否则狼人赢。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `获胜阵营每人 +${POINTS_WIN} 分（村长属于村民阵营）。`,
    contentType: "guess-word",
    options: [
      { key: "rounds", label: "轮数", min: 0, max: 10, default: 3, hint: "0 = 不限" },
      { key: "askSeconds", label: "提问时限（秒）", min: 30, max: 900, default: 240 },
      secondsOption("voteSeconds", "指认时限", 90),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 4) return { ok: false, error: "至少需要 4 名玩家" };
    const state: WordHuntState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      mayor: "",
      participants: [],
      roles: {},
      word: { contentId: null, text: "" },
      questions: [],
      nextId: 1,
      finder: null,
      accusations: {},
      accused: null,
      winner: null,
      deadlineAt: null,
      endedBecause: null,
    };
    return openRound(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    const isMayor = me === state.mayor;
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的词已经选好了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startRound(state, r.chosen, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "村长正在选词，稍等一下" };
    switch (action.type) {
      case "ask":
      case "guess": {
        if (state.phase !== "ask") return { ok: false, error: "提问时间已经结束" };
        if (isMayor) return { ok: false, error: "村长不能提问" };
        if (!(me in state.roles)) return { ok: false, error: "你将从下一轮开始参与" };
        if (action.type === "guess") {
          if (norm(action.text) === norm(state.word.text)) return found(state, me, ctx);
          state.questions.push({ id: state.nextId++, by: me, text: `是「${action.text}」吗？`, answer: "no" });
          return { ok: true, state };
        }
        if (pending(state, me)) return { ok: false, error: "先等村长回答你上一条" };
        state.questions.push({ id: state.nextId++, by: me, text: action.text, answer: null });
        return { ok: true, state };
      }
      case "answer":
      case "correct": {
        if (state.phase !== "ask") return { ok: false, error: "提问时间已经结束" };
        if (!isMayor) return { ok: false, error: "只有村长可以回答" };
        const q = state.questions.find((x) => x.id === action.id);
        if (!q || q.answer !== null) return { ok: false, error: "这条已经回答过了" };
        if (action.type === "answer") {
          q.answer = action.answer;
          return { ok: true, state };
        }
        q.answer = "correct";
        return found(state, q.by, ctx);
      }
      case "accuse": {
        if (!accusers(state).includes(me)) {
          return { ok: false, error: state.phase === "found" ? "现在是狼人指认预言家的时间" : "现在不能指认" };
        }
        if (me in state.accusations) return { ok: false, error: "你已经指认过了" };
        if (!state.participants.includes(action.target) || action.target === me)
          return { ok: false, error: "不能指认这个人" };
        state.accusations[me] = action.target;
        // Wolves act as one: the first wolf to name someone decides.
        if (state.phase === "found") return closeAccusations(state);
        return accusers(state).every((p) => p in state.accusations) ? closeAccusations(state) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "ask") {
          state.phase = "timeUp";
          state.step += 1;
          state.deadlineAt = timer(state.config.voteSeconds, ctx);
          return { ok: true, state };
        }
        if (state.phase === "found" || state.phase === "timeUp") return closeAccusations(state);
        return advance(state, ctx);
      }
    }
  },

  // Hidden roles: a skipped round re-deals everything.
  skip: {
    key: (state) => (state.phase === "ask" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "reveal" ? state.word.contentId : null),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "问出秘密词");
    return r.ok ? { ok: true, state, message: `${r.message}（只有村长看得到）` } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) => (state.phase === "reveal" || state.phase === "finished" ? null : state.deadlineAt),
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return advance(state, ctx);
      startRound(state, c, ctx);
      return { ok: true, state };
    }
    if (state.phase === "ask") {
      state.phase = "timeUp";
      state.step += 1;
      state.deadlineAt = timer(state.config.voteSeconds, ctx);
      return { ok: true, state };
    }
    if (state.phase === "found" || state.phase === "timeUp") return closeAccusations(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    const seconds = {
      pick: state.config.pickSeconds,
      ask: state.config.askSeconds,
      found: state.config.voteSeconds,
      timeUp: state.config.voteSeconds,
    };
    if (state.phase in seconds) state.deadlineAt = timer(seconds[state.phase as keyof typeof seconds], ctx);
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase === "reveal" || state.phase === "finished";
    const role = viewer === state.mayor ? "mayor" : (state.roles[viewer] ?? null);
    const knows = revealed || role === "mayor" || role === "wolf" || role === "seer";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      // Only the mayor may see the candidate words.
      pick:
        state.phase === "pick" ? pickView(state.pick, (d) => d.word, PICK.allowCustom, viewer === state.mayor) : null,
      mayor: state.mayor,
      participants: state.participants,
      myRole: state.phase === "pick" ? null : role,
      word: state.phase !== "pick" && knows ? state.word.text : null,
      fellowWolves: role === "wolf" ? wolves(state).filter((p) => p !== viewer) : [],
      questions: state.questions,
      finder: state.finder,
      accusers: accusers(state),
      // In the wolves' hunt, who is acting would give the wolves away.
      submitted: state.phase === "timeUp" ? Object.keys(state.accusations) : [],
      myAccusation: state.accusations[viewer] ?? null,
      deadlineAt: state.deadlineAt,
      reveal: revealed && state.winner ? { roles: state.roles, accused: state.accused, winner: state.winner } : null,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `问出秘密词 第 ${state.round} 轮：村长正在选词`;
    const qa = state.questions.map((q) => `「${q.text}」→${q.answer ?? "待回答"}`).join("；");
    const base = `问出秘密词 第 ${state.round} 轮，阶段：${state.phase}。问答：${qa || "暂无"}`;
    return state.phase === "reveal" || state.phase === "finished"
      ? `${base}。秘密词「${state.word.text}」，${state.winner === "wolves" ? "狼人" : "村民"}获胜（已揭晓）`
      : `${base}（秘密词与身份未公开）`;
  },
});
