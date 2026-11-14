/**
 * 「真假难辨」— everyone invents a fake answer to a fill-in-the-blank fact; the fakes are mixed
 * with the real answer and everyone picks the one they believe. Rule spec: docs/games/bluff.md
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
import { groupVotes, norm, roundsOption, secondsOption, shuffle, timer } from "../util.ts";

export const LIE_MAX = 30;
export const POINTS_TRUTH = 2;
export const POINTS_PER_FOOLED = 1;

const payload = z.object({ text: z.string(), answer: z.string(), note: z.string().optional() });
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const bluffContentSchema = payload;
const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(5),
  writeSeconds: z.number().int().min(0).max(600).default(90),
  selectSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("lie"), step: z.number().int(), text: z.string().trim().min(1).max(LIE_MAX) }),
  z.object({ type: z.literal("pick"), step: z.number().int(), index: z.number().int().min(0) }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

interface Option {
  text: string;
  /** Players who wrote this (identical fakes are merged). Empty for the real answer. */
  authors: PlayerId[];
  truth: boolean;
}

export interface BluffState {
  /** Topic choice before each round formally starts. */
  pick: PickState<z.infer<typeof payload>>;
  config: Config;
  round: number;
  step: number;
  phase: "pick" | "write" | "select" | "reveal" | "finished";
  participants: PlayerId[];
  fact: { contentId: string | null; text: string; answer: string; note?: string };
  lies: Record<PlayerId, string>;
  options: Option[];
  picks: Record<PlayerId, number>;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface BluffView {
  round: number;
  totalRounds: number;
  step: number;
  phase: BluffState["phase"];
  /** Present while this round\'s topic is being chosen. */
  pick: PickView | null;
  participants: PlayerId[];
  question: string;
  submitted: PlayerId[];
  myLie: string | null;
  /** During picking: texts only, no authorship and no truth marker. */
  options: { index: number; text: string; mine: boolean }[] | null;
  myPick: number | null;
  deadlineAt: number | null;
  reveal: { options: (Option & { pickers: PlayerId[] })[]; note?: string } | null;
}

function startRound(state: BluffState, fact: BluffState["fact"], ctx: GameContext) {
  state.phase = "write";
  state.step += 1;
  state.participants = [...ctx.players];
  state.fact = fact;
  state.lies = {};
  state.options = [];
  state.picks = {};
  state.deadlineAt = timer(state.config.writeSeconds, ctx);
}

function beginSelect(state: BluffState, ctx: GameContext): GameResult<BluffState> {
  const merged = new Map<string, Option>();
  for (const [author, text] of Object.entries(state.lies)) {
    const key = norm(text);
    const existing = merged.get(key);
    if (existing) existing.authors.push(author);
    else merged.set(key, { text, authors: [author], truth: false });
  }
  state.options = shuffle([...merged.values(), { text: state.fact.answer, authors: [], truth: true }], ctx.random);
  state.phase = "select";
  state.step += 1;
  state.deadlineAt = timer(state.config.selectSeconds, ctx);
  return { ok: true, state };
}

function settle(state: BluffState): GameResult<BluffState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const pickers = groupVotes(state.picks);
  const scores: ScoreAward[] = [];
  state.options.forEach((option, index) => {
    const chosenBy = pickers.get(index) ?? [];
    if (option.truth) {
      for (const p of chosenBy) {
        scores.push({ playerId: p, points: POINTS_TRUTH, reason: "选中真答案", key: `r${state.round}:truth:${p}` });
      }
    } else if (chosenBy.length > 0) {
      for (const author of option.authors) {
        scores.push({
          playerId: author,
          points: chosenBy.length * POINTS_PER_FOOLED,
          reason: "假答案骗到人",
          key: `r${state.round}:fool:${author}`,
        });
      }
    }
  });
  return { ok: true, state, scores };
}

function finishNoContent(state: BluffState): GameResult<BluffState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = "no-content";
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** Opens a round with the topic choice; the round formally starts once a topic is confirmed. */
function openRound(state: BluffState, ctx: GameContext): GameResult<BluffState> {
  state.phase = "pick";
  state.step += 1;
  openPick(state.pick, rotatePicker(state.pick, ctx.players), payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  if (state.pick.candidates.length === 0) return finishNoContent(state);
  return { ok: true, state };
}

const PICK = { schema: payload, contentType: "fact-blank", allowCustom: false };

function advance(state: BluffState, ctx: GameContext): GameResult<BluffState> {
  const end = (why: BluffState["endedBecause"]): GameResult<BluffState> => {
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

export const bluffGame = defineGame<BluffState, Action, BluffView, Config>({
  meta: {
    id: "bluff",
    name: "真假难辨",
    description: "给一条冷知识编个以假乱真的答案，混进真答案里，看谁能骗到人、谁能认出真的。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮开始前，由轮流担任的出题人从候选题里选一道（只看得到题干，看不到答案；可以换一批，不能自己出题）。每轮一道有空缺的事实题。每人先编一个假答案（最多 30 字；碰巧写中真答案会被要求重写）。所有假答案和真答案乱序、匿名展示，每人选出自己认为真的那个（不能选自己写的）。然后公开真相、作者和每个人的选择。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `选中真答案 +${POINTS_TRUTH} 分；你的假答案每骗到 1 人 +${POINTS_PER_FOOLED} 分（相同的假答案各自得分）。被跳过的题不计分。`,
    contentType: "fact-blank",
    options: [
      roundsOption(5),
      secondsOption("writeSeconds", "编答案时限", 90),
      secondsOption("selectSeconds", "选择时限", 45),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: BluffState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "write",
      participants: [],
      fact: { contentId: "", text: "", answer: "" },
      lies: {},
      options: [],
      picks: {},
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
      case "lie": {
        if (state.phase !== "write") return { ok: false, error: "现在不是编答案的阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.lies) return { ok: false, error: "你已经提交过了" };
        if (norm(action.text) === norm(state.fact.answer))
          return { ok: false, error: "这和真答案太像了，换一个假答案吧" };
        state.lies[me] = action.text;
        return state.participants.every((p) => p in state.lies) ? beginSelect(state, ctx) : { ok: true, state };
      }
      case "pick": {
        if (state.phase !== "select") return { ok: false, error: "现在不是选择阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.picks) return { ok: false, error: "你已经选过了" };
        const option = state.options[action.index];
        if (!option) return { ok: false, error: "没有这个选项" };
        if (option.authors.includes(me)) return { ok: false, error: "不能选自己写的答案" };
        state.picks[me] = action.index;
        return state.participants.every((p) => p in state.picks) ? settle(state) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "write") return beginSelect(state, ctx);
        if (state.phase === "select") return settle(state);
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "write" || state.phase === "select" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.fact.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "真假难辨");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) =>
    state.phase === "pick"
      ? state.deadlineAt
      : state.phase === "write" || state.phase === "select"
        ? state.deadlineAt
        : null,
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return finishNoContent(state);
      startRound(state, { contentId: c.contentId, ...c.data }, ctx);
      return { ok: true, state };
    }
    if (state.phase === "write") return beginSelect(state, ctx);
    if (state.phase === "select") return settle(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "write") state.deadlineAt = timer(state.config.writeSeconds, ctx);
    if (state.phase === "select") state.deadlineAt = timer(state.config.selectSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const selecting = state.phase === "select";
    const revealed = state.phase === "reveal" || state.phase === "finished";
    const pickers = groupVotes(state.picks);
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.text, PICK.allowCustom) : null,
      participants: state.participants,
      question: state.fact.text,
      submitted: Object.keys(selecting ? state.picks : state.phase === "write" ? state.lies : {}),
      myLie: state.lies[viewer] ?? null,
      options: selecting
        ? state.options.map((o, index) => ({ index, text: o.text, mine: o.authors.includes(viewer) }))
        : null,
      myPick: selecting ? (state.picks[viewer] ?? null) : null,
      deadlineAt: state.deadlineAt,
      reveal: revealed
        ? {
            options: state.options.map((o, index) => ({ ...o, pickers: pickers.get(index) ?? [] })),
            note: state.fact.note,
          }
        : null,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `真假难辨 第 ${state.round} 轮：出题人正在选题，尚未开始`;
    const base = `真假难辨 第 ${state.round} 轮，题目：「${state.fact.text}」，阶段：${state.phase}`;
    if (state.phase === "reveal" || state.phase === "finished")
      return `${base}，真答案「${state.fact.answer}」（已揭晓）`;
    return `${base}（真答案、各人编的答案与选择未公开）`;
  },
});
