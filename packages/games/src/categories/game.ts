/**
 * 「逛三园」— players take turns typing a word that fits a category; no repeats, beat the clock.
 * Everything is public. Rule spec: docs/games/categories.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId } from "@apr/shared";
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
import { norm, roundsOption, secondsOption, timer } from "../util.ts";

export const WORD_MAX = 20;
export const POINTS_ROUND_WIN = 2;

const payload = z.object({ name: z.string(), hint: z.string().optional() });
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const categoriesContentSchema = payload;
const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(3),
  turnSeconds: z.number().int().min(0).max(600).default(20),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("say"), step: z.number().int(), text: z.string().trim().min(1).max(WORD_MAX) }),
  /** Current player gives up their turn and is out for this round. */
  z.object({ type: z.literal("giveUp"), step: z.number().int() }),
  /** Host ruling: the latest word does not fit the category; its author is out. */
  z.object({ type: z.literal("invalidate"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

type OutReason = "timeout" | "gave-up" | "invalid";

export interface CategoriesState {
  /** Topic choice before each round formally starts. */
  pick: PickState<z.infer<typeof payload>>;
  config: Config;
  round: number;
  step: number;
  phase: "pick" | "playing" | "roundOver" | "finished";
  participants: PlayerId[];
  alive: PlayerId[];
  current: PlayerId;
  category: { contentId: string | null; name: string; hint?: string };
  words: { playerId: PlayerId; text: string; invalid?: boolean }[];
  out: { playerId: PlayerId; reason: OutReason }[];
  winner: PlayerId | null;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

/** The whole state is public in this game. */
export type CategoriesView = Omit<CategoriesState, "config" | "category" | "pick"> & {
  /** Present while this round's category is being chosen. */
  pick: PickView | null;
  totalRounds: number;
  category: { name: string; hint?: string };
};

function startRound(state: CategoriesState, category: CategoriesState["category"], ctx: GameContext) {
  state.phase = "playing";
  state.step += 1;
  state.participants = [...ctx.players];
  state.alive = [...state.participants];
  // The starting seat rotates each round.
  state.current = state.participants[(state.round - 1) % state.participants.length] as PlayerId;
  state.category = category;
  state.words = [];
  state.out = [];
  state.winner = null;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function nextAlive(state: CategoriesState, after: PlayerId): PlayerId {
  const order = state.participants;
  const start = order.indexOf(after);
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(start + i) % order.length] as PlayerId;
    if (state.alive.includes(candidate)) return candidate;
  }
  return after;
}

function eliminate(
  state: CategoriesState,
  player: PlayerId,
  reason: OutReason,
  ctx: GameContext,
): GameResult<CategoriesState> {
  const successor = nextAlive(state, player);
  state.alive = state.alive.filter((p) => p !== player);
  state.out.push({ playerId: player, reason });
  state.step += 1;
  if (state.alive.length <= 1) {
    state.phase = "roundOver";
    state.winner = state.alive[0] ?? null;
    state.deadlineAt = null;
    return {
      ok: true,
      state,
      scores: state.winner
        ? [
            {
              playerId: state.winner,
              points: POINTS_ROUND_WIN,
              reason: "撑到最后",
              key: `r${state.round}:win:${state.winner}`,
            },
          ]
        : [],
    };
  }
  if (state.current === player) state.current = successor;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function finishNoContent(state: CategoriesState): GameResult<CategoriesState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = "no-content";
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** Opens a round with the topic choice; the round formally starts once a topic is confirmed. */
function openRound(state: CategoriesState, ctx: GameContext): GameResult<CategoriesState> {
  state.phase = "pick";
  state.step += 1;
  openPick(state.pick, rotatePicker(state.pick, ctx.players), payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

const PICK = { schema: payload, contentType: "category", allowCustom: true };

function advance(state: CategoriesState, ctx: GameContext): GameResult<CategoriesState> {
  const end = (why: CategoriesState["endedBecause"]): GameResult<CategoriesState> => {
    state.phase = "finished";
    state.step += 1;
    state.endedBecause = why;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  };
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return end("rounds");
  state.round += 1;
  return openRound(state, ctx);
}

export const categoriesGame = defineGame<CategoriesState, Action, CategoriesView, Config>({
  meta: {
    id: "categories",
    name: "逛三园",
    description: "围绕一个类别轮流打词，不能重复、不能超时，撑到最后的人赢。",
    minPlayers: 2,
    maxPlayers: 8,
    rulesSummary:
      "每轮开始前，由轮流担任的出题人从候选类别里选一个（可以不限次数地换一批，也可以自己出一个类别）。每轮给出一个类别（例如「水果园」）。玩家按顺序轮流在限时内输入一个属于该类别的词。与已出现的词重复会被系统拒绝（可以马上换一个，时间不停）。超时或认输的人本轮出局。词是否属于该类别由大家口头把关：有争议时房主可判定最新的词无效，其作者出局。剩最后一人时本轮结束。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `每轮撑到最后的玩家 +${POINTS_ROUND_WIN} 分。被跳过的类别不计分。`,
    contentType: "category",
    options: [roundsOption(3), secondsOption("turnSeconds", "每人每次限时", 20), pickSecondsOption],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 2) return { ok: false, error: "至少需要 2 名玩家" };
    const state: CategoriesState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "playing",
      participants: [],
      alive: [],
      current: "",
      category: { contentId: "", name: "" },
      words: [],
      out: [],
      winner: null,
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
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
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
      case "say": {
        if (state.phase !== "playing") return { ok: false, error: "本轮已经结束" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        const key = norm(action.text);
        if (!key) return { ok: false, error: "请输入一个词" };
        if (state.words.some((w) => !w.invalid && norm(w.text) === key))
          return { ok: false, error: "这个词已经有人说过了" };
        state.words.push({ playerId: me, text: action.text });
        state.current = nextAlive(state, me);
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "giveUp": {
        if (state.phase !== "playing") return { ok: false, error: "本轮已经结束" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        return eliminate(state, me, "gave-up", ctx);
      }
      case "invalidate": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以判定词语无效" };
        if (state.phase !== "playing") return { ok: false, error: "本轮已经结束" };
        const last = state.words.at(-1);
        if (!last || last.invalid) return { ok: false, error: "没有可以判定的词" };
        if (!state.alive.includes(last.playerId)) return { ok: false, error: "该玩家已经出局" };
        last.invalid = true;
        return eliminate(state, last.playerId, "invalid", ctx);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以进入下一轮" };
        if (state.phase !== "roundOver") return { ok: false, error: "本轮还没有结束" };
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "playing" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.category.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "逛三园");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "roundOver",
  deadline: (state) =>
    state.phase === "pick" ? state.deadlineAt : state.phase === "playing" ? state.deadlineAt : null,
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return finishNoContent(state);
      startRound(state, { contentId: c.contentId, ...c.data }, ctx);
      return { ok: true, state };
    }
    return state.phase === "playing" ? eliminate(state, state.current, "timeout", ctx) : { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "playing") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state) {
    const { config, category, pick, ...rest } = state;
    return {
      ...rest,
      pick: state.phase === "pick" ? pickView(pick, (d) => d.name, PICK.allowCustom) : null,
      totalRounds: config.rounds,
      category: { name: category.name, hint: category.hint },
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `逛三园 第 ${state.round} 轮：出题人正在选题，尚未开始`;
    return `逛三园 第 ${state.round} 轮，类别「${state.category.name}」，已说 ${state.words.length} 个词，在场 ${state.alive.length}/${state.participants.length} 人，阶段：${state.phase}`;
  },
});
