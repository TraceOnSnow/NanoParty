/**
 * 「真假难辨」— everyone invents a fake answer to a fill-in-the-blank fact; the fakes are mixed
 * with the real answer and everyone picks the one they believe. Rule spec: docs/games/bluff.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { drawPayload, groupVotes, norm, roundsOption, secondsOption, shuffle, timer } from "../util.ts";

export const LIE_MAX = 30;
export const POINTS_TRUTH = 2;
export const POINTS_PER_FOOLED = 1;

const payload = z.object({ text: z.string(), answer: z.string(), note: z.string().optional() });
const configSchema = z.object({
  rounds: z.number().int().min(0).max(30).default(5),
  writeSeconds: z.number().int().min(0).max(600).default(90),
  pickSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
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
  config: Config;
  round: number;
  step: number;
  phase: "write" | "pick" | "reveal" | "finished";
  participants: PlayerId[];
  fact: { contentId: string; text: string; answer: string; note?: string };
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

function beginPick(state: BluffState, ctx: GameContext): GameResult<BluffState> {
  const merged = new Map<string, Option>();
  for (const [author, text] of Object.entries(state.lies)) {
    const key = norm(text);
    const existing = merged.get(key);
    if (existing) existing.authors.push(author);
    else merged.set(key, { text, authors: [author], truth: false });
  }
  state.options = shuffle([...merged.values(), { text: state.fact.answer, authors: [], truth: true }], ctx.random);
  state.phase = "pick";
  state.step += 1;
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
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

function advance(state: BluffState, ctx: GameContext): GameResult<BluffState> {
  const end = (why: BluffState["endedBecause"]): GameResult<BluffState> => {
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

export const bluffGame = defineGame<BluffState, Action, BluffView, Config>({
  meta: {
    id: "bluff",
    name: "真假难辨",
    description: "给一条冷知识编个以假乱真的答案，混进真答案里，看谁能骗到人、谁能认出真的。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮一道有空缺的事实题。每人先编一个假答案（最多 30 字；碰巧写中真答案会被要求重写）。所有假答案和真答案乱序、匿名展示，每人选出自己认为真的那个（不能选自己写的）。然后公开真相、作者和每个人的选择。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `选中真答案 +${POINTS_TRUTH} 分；你的假答案每骗到 1 人 +${POINTS_PER_FOOLED} 分（相同的假答案各自得分）。被跳过的题不计分。`,
    contentType: "fact-blank",
    options: [
      roundsOption(5),
      secondsOption("writeSeconds", "编答案时限", 90),
      secondsOption("pickSeconds", "选择时限", 45),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const drawn = drawPayload(ctx, payload);
    if (!drawn) return { ok: false, error: "题库中没有可用的题目" };
    const state: BluffState = {
      config,
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
    startRound(state, { contentId: drawn.contentId, ...drawn.data }, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    const me = actor.playerId;
    switch (action.type) {
      case "lie": {
        if (state.phase !== "write") return { ok: false, error: "现在不是编答案的阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.lies) return { ok: false, error: "你已经提交过了" };
        if (norm(action.text) === norm(state.fact.answer))
          return { ok: false, error: "这和真答案太像了，换一个假答案吧" };
        state.lies[me] = action.text;
        return state.participants.every((p) => p in state.lies) ? beginPick(state, ctx) : { ok: true, state };
      }
      case "pick": {
        if (state.phase !== "pick") return { ok: false, error: "现在不是选择阶段" };
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
        if (state.phase === "write") return beginPick(state, ctx);
        if (state.phase === "pick") return settle(state);
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "write" || state.phase === "pick" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "finished" ? null : state.fact.contentId),
  deadline: (state) => (state.phase === "write" || state.phase === "pick" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "write") return beginPick(state, ctx);
    if (state.phase === "pick") return settle(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "write") state.deadlineAt = timer(state.config.writeSeconds, ctx);
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const picking = state.phase === "pick";
    const revealed = state.phase === "reveal" || state.phase === "finished";
    const pickers = groupVotes(state.picks);
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      participants: state.participants,
      question: state.fact.text,
      submitted: Object.keys(picking ? state.picks : state.phase === "write" ? state.lies : {}),
      myLie: state.lies[viewer] ?? null,
      options: picking
        ? state.options.map((o, index) => ({ index, text: o.text, mine: o.authors.includes(viewer) }))
        : null,
      myPick: picking ? (state.picks[viewer] ?? null) : null,
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
    const base = `真假难辨 第 ${state.round} 轮，题目：「${state.fact.text}」，阶段：${state.phase}`;
    if (state.phase === "reveal" || state.phase === "finished")
      return `${base}，真答案「${state.fact.answer}」（已揭晓）`;
    return `${base}（真答案、各人编的答案与选择未公开）`;
  },
});
