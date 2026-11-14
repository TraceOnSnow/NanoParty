/**
 * 「五五开」— everyone completes the same dilemma so that the room splits as evenly as
 * possible; then everyone answers everyone else's version. Rule spec: docs/games/split.md
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

export const FILL_MAX = 30;
export const BLANK = "____";

/** A dilemma with exactly one blank, answered yes or no. */
const payload = z.object({
  text: z
    .string()
    .min(1)
    .max(120)
    .refine((t) => t.split(BLANK).length === 2, `需要恰好一个「${BLANK}」空格`),
  yes: z.string().min(1).max(8).default("愿意"),
  no: z.string().min(1).max(8).default("不愿意"),
});
/** Payload shape of this game's content type. */
export const splitContentSchema = payload;
type Dilemma = z.infer<typeof payload>;

const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(20).default(3),
  writeSeconds: z.number().int().min(0).max(600).default(90),
  voteSeconds: z.number().int().min(0).max(600).default(90),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("fill"), step: z.number().int(), text: z.string().trim().min(1).max(FILL_MAX) }),
  /** One answer per other player's version, keyed by author. */
  z.object({ type: z.literal("vote"), step: z.number().int(), answers: z.record(z.string(), z.boolean()) }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SplitResult {
  author: PlayerId;
  fill: string;
  yes: PlayerId[];
  no: PlayerId[];
  points: number;
}

export interface SplitState {
  config: Config;
  pick: PickState<Dilemma>;
  round: number;
  step: number;
  phase: "pick" | "write" | "vote" | "reveal" | "finished";
  participants: PlayerId[];
  dilemma: { contentId: string | null } & Dilemma;
  fills: Record<PlayerId, string>;
  /** voter -> author -> yes? */
  votes: Record<PlayerId, Record<PlayerId, boolean>>;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface SplitView {
  round: number;
  totalRounds: number;
  step: number;
  phase: SplitState["phase"];
  pick: PickView | null;
  participants: PlayerId[];
  dilemma: { text: string; yes: string; no: string };
  submitted: PlayerId[];
  myFill: string | null;
  /** Everyone's version, from the vote on (authors are shown: this is a game among friends). */
  versions: { author: PlayerId; fill: string }[] | null;
  myVotes: Record<PlayerId, boolean> | null;
  deadlineAt: number | null;
  results: SplitResult[] | null;
}

const PICK = { schema: payload, contentType: "split-prompt", allowCustom: true };

/** Points for an author: the number of voters minus the imbalance. A perfect split scores most. */
export const splitPoints = (yes: number, no: number) => yes + no - Math.abs(yes - no);

function finish(state: SplitState, why: SplitState["endedBecause"]): GameResult<SplitState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = why;
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

function openRound(state: SplitState, ctx: GameContext): GameResult<SplitState> {
  state.phase = "pick";
  state.step += 1;
  openPick(state.pick, rotatePicker(state.pick, ctx.players), payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startRound(state: SplitState, c: { contentId: string | null; data: Dilemma }, ctx: GameContext) {
  state.dilemma = { contentId: c.contentId, ...c.data };
  state.phase = "write";
  state.step += 1;
  state.participants = [...ctx.players];
  state.fills = {};
  state.votes = {};
  state.deadlineAt = timer(state.config.writeSeconds, ctx);
}

export function results(state: SplitState): SplitResult[] {
  return Object.entries(state.fills).map(([author, fill]) => {
    const yes: PlayerId[] = [];
    const no: PlayerId[] = [];
    for (const [voter, answers] of Object.entries(state.votes)) {
      const a = answers[author];
      if (a === true) yes.push(voter);
      if (a === false) no.push(voter);
    }
    return { author, fill, yes, no, points: splitPoints(yes.length, no.length) };
  });
}

function settle(state: SplitState): GameResult<SplitState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const scores: ScoreAward[] = results(state)
    .filter((r) => r.points > 0)
    .map((r) => ({
      playerId: r.author,
      points: r.points,
      reason: "把大家分成了两派",
      key: `r${state.round}:split:${r.author}`,
    }));
  return { ok: true, state, scores };
}

/** Voters are participants with at least one version that is not their own. */
const voters = (state: SplitState) => state.participants.filter((p) => Object.keys(state.fills).some((a) => a !== p));

function beginVote(state: SplitState, ctx: GameContext): GameResult<SplitState> {
  if (Object.keys(state.fills).length === 0) return settle(state);
  state.phase = "vote";
  state.step += 1;
  state.deadlineAt = timer(state.config.voteSeconds, ctx);
  return { ok: true, state };
}

function advance(state: SplitState, ctx: GameContext): GameResult<SplitState> {
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return finish(state, "rounds");
  state.round += 1;
  return openRound(state, ctx);
}

export const splitGame = defineGame<SplitState, Action, SplitView, Config>({
  meta: {
    id: "split",
    name: "五五开",
    description: "补全一个两难情境，让朋友们刚好吵成两半——越接近五五开，分越高。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮开始前，由轮流担任的出题人选一个带空格的两难情境（可以换一批或自己出）。所有人各自填空，让这个情境变成一个「大家会意见不一」的选择；填好前互相看不到。然后公开所有版本，每人对别人的每个版本选「愿意 / 不愿意」，全部选完后公开。中途加入的玩家从下一轮开始参与。",
    scoringSummary:
      "你的版本得分 = 回答人数 − |愿意人数 − 不愿意人数|。完美五五开得分最高，全员一边倒得 0 分。被跳过的轮次不计分。",
    contentType: "split-prompt",
    options: [
      roundsOption(3),
      secondsOption("writeSeconds", "填空时限", 90),
      secondsOption("voteSeconds", "表态时限", 90),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: SplitState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      participants: [],
      dilemma: { contentId: null, text: "", yes: "", no: "" },
      fills: {},
      votes: {},
      deadlineAt: null,
      endedBecause: null,
    };
    return openRound(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    const me = actor.playerId;
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startRound(state, r.chosen, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "出题人正在选题，稍等一下" };
    switch (action.type) {
      case "fill": {
        if (state.phase !== "write") return { ok: false, error: "现在不是填空阶段" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (me in state.fills) return { ok: false, error: "你已经提交过了" };
        state.fills[me] = action.text;
        return state.participants.every((p) => p in state.fills) ? beginVote(state, ctx) : { ok: true, state };
      }
      case "vote": {
        if (state.phase !== "vote") return { ok: false, error: "现在不是表态阶段" };
        if (!voters(state).includes(me)) return { ok: false, error: "这一轮你不用表态" };
        if (me in state.votes) return { ok: false, error: "你已经表过态了" };
        const others = Object.keys(state.fills).filter((a) => a !== me);
        const keys = Object.keys(action.answers);
        if (keys.length !== others.length || !others.every((a) => keys.includes(a))) {
          return { ok: false, error: "请对每个别人的版本都表态（不包括你自己的）" };
        }
        state.votes[me] = action.answers;
        return voters(state).every((p) => p in state.votes) ? settle(state) : { ok: true, state };
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
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.dilemma.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "五五开");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) => (["pick", "write", "vote"].includes(state.phase) ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return advance(state, ctx);
      startRound(state, c, ctx);
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
    const open = state.phase === "vote" || state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.text, PICK.allowCustom) : null,
      participants: state.participants,
      dilemma: { text: state.dilemma.text, yes: state.dilemma.yes, no: state.dilemma.no },
      submitted: Object.keys(state.phase === "write" ? state.fills : state.phase === "vote" ? state.votes : {}),
      myFill: state.fills[viewer] ?? null,
      versions: open ? Object.entries(state.fills).map(([author, fill]) => ({ author, fill })) : null,
      myVotes: state.votes[viewer] ?? null,
      deadlineAt: state.deadlineAt,
      results: state.phase === "reveal" || state.phase === "finished" ? results(state) : null,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `五五开 第 ${state.round} 轮：出题人正在选题`;
    const base = `五五开 第 ${state.round} 轮，题目：「${state.dilemma.text}」，阶段：${state.phase}`;
    return state.phase === "write"
      ? `${base}（各人的填空未公开）`
      : state.phase === "vote"
        ? `${base}（各人的表态未公开）`
        : base;
  },
});
