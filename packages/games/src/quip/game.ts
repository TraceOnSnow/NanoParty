/**
 * 「脑洞问答」— everyone writes a funny answer to the same prompt, then votes on the
 * anonymous answers. Rule spec: docs/games/quip.md
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
import { groupVotes, roundsOption, secondsOption, shuffle, timer } from "../util.ts";

export const QUIP_MAX = 60;
const payload = z.object({ text: z.string() });
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const quipContentSchema = payload;
const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(5),
  writeSeconds: z.number().int().min(0).max(600).default(90),
  voteSeconds: z.number().int().min(0).max(600).default(60),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("answer"), step: z.number().int(), text: z.string().trim().min(1).max(QUIP_MAX) }),
  z.object({ type: z.literal("vote"), step: z.number().int(), index: z.number().int().min(0) }),
  /** Host: close the current phase now / continue after the reveal. */
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface QuipState {
  /** Topic choice before each round formally starts. */
  pick: PickState<z.infer<typeof payload>>;
  config: Config;
  round: number;
  step: number;
  phase: "pick" | "write" | "vote" | "reveal" | "finished";
  participants: PlayerId[];
  prompt: { contentId: string | null; text: string };
  answers: Record<PlayerId, string>;
  /** Display order of the answers during voting; hides authorship. */
  order: PlayerId[];
  votes: Record<PlayerId, number>;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface QuipView {
  round: number;
  totalRounds: number;
  step: number;
  phase: QuipState["phase"];
  /** Present while this round\'s topic is being chosen. */
  pick: PickView | null;
  participants: PlayerId[];
  prompt: string;
  submitted: PlayerId[];
  myAnswer: string | null;
  /** Anonymous answers during voting. */
  options: { index: number; text: string; mine: boolean }[] | null;
  myVote: number | null;
  deadlineAt: number | null;
  reveal: { playerId: PlayerId; text: string; voters: PlayerId[]; points: number }[] | null;
}

function startRound(state: QuipState, prompt: QuipState["prompt"], ctx: GameContext) {
  state.phase = "write";
  state.step += 1;
  state.participants = [...ctx.players];
  state.prompt = prompt;
  state.answers = {};
  state.order = [];
  state.votes = {};
  state.deadlineAt = timer(state.config.writeSeconds, ctx);
}

function tally(state: QuipState) {
  const groups = groupVotes(state.votes);
  const rows = state.order.map((author, index) => ({
    playerId: author,
    text: state.answers[author] as string,
    voters: groups.get(index) ?? [],
  }));
  const max = Math.max(0, ...rows.map((r) => r.voters.length));
  return rows
    .map((r) => ({ ...r, points: r.voters.length + (max > 0 && r.voters.length === max ? 1 : 0) }))
    .sort((a, b) => b.voters.length - a.voters.length);
}

function settle(state: QuipState): GameResult<QuipState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const scores: ScoreAward[] = tally(state)
    .filter((r) => r.points > 0)
    .map((r) => ({
      playerId: r.playerId,
      points: r.points,
      reason: "回答受欢迎",
      key: `r${state.round}:quip:${r.playerId}`,
    }));
  return { ok: true, state, scores };
}

function beginVote(state: QuipState, ctx: GameContext): GameResult<QuipState> {
  state.order = shuffle(Object.keys(state.answers), ctx.random);
  // With fewer than two answers there is nothing to choose between.
  if (state.order.length < 2) return settle(state);
  state.phase = "vote";
  state.step += 1;
  state.deadlineAt = timer(state.config.voteSeconds, ctx);
  return { ok: true, state };
}

function finishNoContent(state: QuipState): GameResult<QuipState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = "no-content";
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** Opens a round with the topic choice; the round formally starts once a topic is confirmed. */
function openRound(state: QuipState, ctx: GameContext): GameResult<QuipState> {
  state.phase = "pick";
  state.step += 1;
  openPick(state.pick, rotatePicker(state.pick, ctx.players), payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

const PICK = { schema: payload, contentType: "quip-prompt", allowCustom: true };

function advance(state: QuipState, ctx: GameContext): GameResult<QuipState> {
  const end = (why: QuipState["endedBecause"]): GameResult<QuipState> => {
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

/** A voter can vote if there is at least one answer that is not their own. */
const canVote = (state: QuipState, p: PlayerId) => state.order.some((author) => author !== p);

export const quipGame = defineGame<QuipState, Action, QuipView, Config>({
  meta: {
    id: "quip",
    name: "脑洞问答",
    description: "同一个脑洞问题，每人写一个回答，匿名展示后投票选出最喜欢的。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮开始前，由轮流担任的出题人从候选题里选一道（可以不限次数地换一批，也可以自己出题）。每轮一个开放问题，所有人各写一个回答（最多 60 字），揭晓前互相看不到。写完后回答匿名、乱序展示，每人投一票（不能投自己），投完公开作者和票数。中途加入的玩家从下一轮开始参与。",
    scoringSummary: "每得 1 票 +1 分；得票最多的回答再 +1 分（并列都加）。被跳过的题不计分。",
    contentType: "quip-prompt",
    options: [
      roundsOption(5),
      secondsOption("writeSeconds", "作答时限", 90),
      secondsOption("voteSeconds", "投票时限", 60),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: QuipState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "write",
      participants: [],
      prompt: { contentId: "", text: "" },
      answers: {},
      order: [],
      votes: {},
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
      startRound(state, { contentId: c.contentId, text: c.data.text }, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "出题人正在选题，稍等一下" };
    const me = actor.playerId;
    switch (action.type) {
      case "answer": {
        if (state.phase !== "write") return { ok: false, error: "现在不是作答阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.answers) return { ok: false, error: "你已经提交过了" };
        state.answers[me] = action.text;
        return state.participants.every((p) => p in state.answers) ? beginVote(state, ctx) : { ok: true, state };
      }
      case "vote": {
        if (state.phase !== "vote") return { ok: false, error: "现在不是投票阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.votes) return { ok: false, error: "你已经投过票了" };
        const author = state.order[action.index];
        if (!author) return { ok: false, error: "没有这个选项" };
        if (author === me) return { ok: false, error: "不能投给自己的回答" };
        state.votes[me] = action.index;
        const voters = state.participants.filter((p) => canVote(state, p));
        return voters.every((p) => p in state.votes) ? settle(state) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "write") return beginVote(state, ctx);
        if (state.phase === "vote") return settle(state);
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "write" || state.phase === "vote" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.prompt.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "脑洞问答");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) =>
    state.phase === "pick"
      ? state.deadlineAt
      : state.phase === "write" || state.phase === "vote"
        ? state.deadlineAt
        : null,
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return finishNoContent(state);
      startRound(state, { contentId: c.contentId, text: c.data.text }, ctx);
      return { ok: true, state };
    }
    if (state.phase === "write") return beginVote(state, ctx);
    if (state.phase === "vote") return settle(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "write") state.deadlineAt = timer(state.config.writeSeconds, ctx);
    if (state.phase === "vote") state.deadlineAt = timer(state.config.voteSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const voting = state.phase === "vote";
    const revealed = state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.text, PICK.allowCustom) : null,
      participants: state.participants,
      prompt: state.prompt.text,
      submitted: Object.keys(voting ? state.votes : state.phase === "write" ? state.answers : {}),
      myAnswer: state.answers[viewer] ?? null,
      options: voting
        ? state.order.map((author, index) => ({
            index,
            text: state.answers[author] as string,
            mine: author === viewer,
          }))
        : null,
      myVote: voting ? (state.votes[viewer] ?? null) : null,
      deadlineAt: state.deadlineAt,
      reveal: revealed ? tally(state) : null,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `脑洞问答 第 ${state.round} 轮：出题人正在选题，尚未开始`;
    const base = `脑洞问答 第 ${state.round} 轮，题目：「${state.prompt.text}」，阶段：${state.phase}`;
    if (state.phase === "write")
      return `${base}，已作答 ${Object.keys(state.answers).length}/${state.participants.length} 人（回答未公开）`;
    if (state.phase === "vote") return `${base}，回答已匿名展示（作者与投票未公开）`;
    return `${base}，已揭晓`;
  },
});
