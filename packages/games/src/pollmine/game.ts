/**
 * 「猜大家选」— everyone secretly answers a poll, then two teams take turns naming options that
 * somebody in the room chose. Naming one nobody chose costs a life. Uses only the room's own
 * answers. Rule spec: docs/games/pollmine.md
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
import { splitTeams, type TeamId, teamOf } from "../words.ts";

export const LIVES = 2;
const POINTS_WIN = 2;
const POINTS_TIE = 1;

const payload = z.object({
  text: z.string().trim().min(1).max(60),
  options: z.array(z.string().trim().min(1).max(16)).min(4).max(8),
});
/** Payload shape of this game's content type. */
export const pollContentSchema = payload;
type Poll = z.infer<typeof payload>;

const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(4),
  voteSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("vote"), step: z.number().int(), option: z.number().int().min(0) }),
  z.object({ type: z.literal("open"), step: z.number().int(), option: z.number().int().min(0) }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

type Pair<T> = [T, T];
export interface PollMineState {
  config: Config;
  pick: PickState<Poll>;
  round: number;
  step: number;
  phase: "pick" | "vote" | "hunt" | "reveal" | "finished";
  teams: Pair<PlayerId[]>;
  poll: { contentId: string | null; data: Poll };
  /** Secret until the reveal; even then only counts are shown, never who chose what. */
  votes: Record<PlayerId, number>;
  opened: { option: number; team: TeamId; count: number }[];
  turn: TeamId;
  lives: Pair<number>;
  points: Pair<number>;
  deadlineAt: number | null;
}

export interface PollMineView {
  round: number;
  totalRounds: number;
  step: number;
  phase: PollMineState["phase"];
  pick: PickView | null;
  teams: Pair<PlayerId[]>;
  myTeam: TeamId | null;
  text: string;
  options: string[];
  voted: PlayerId[];
  myVote: number | null;
  opened: PollMineState["opened"];
  turn: TeamId;
  lives: Pair<number>;
  points: Pair<number>;
  /** Votes per option, after the reveal. */
  counts: number[] | null;
  deadlineAt: number | null;
}

const PICK = { schema: payload, contentType: "poll", allowCustom: false };
const voters = (state: PollMineState) => state.teams.flat();
const countFor = (state: PollMineState, option: number) =>
  Object.values(state.votes).filter((v) => v === option).length;
const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0);

function openRound(state: PollMineState, ctx: GameContext): GameResult<PollMineState> {
  // Late joiners get a seat between rounds.
  const seated = new Set(state.teams.flat());
  for (const p of ctx.players) {
    if (!seated.has(p)) (state.teams[0].length <= state.teams[1].length ? state.teams[0] : state.teams[1]).push(p);
  }
  state.phase = "pick";
  state.step += 1;
  openPick(state.pick, rotatePicker(state.pick, voters(state)), payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startRound(state: PollMineState, c: { contentId: string | null; data: Poll }, ctx: GameContext) {
  state.poll = c;
  state.votes = {};
  state.opened = [];
  state.lives = [LIVES, LIVES];
  state.points = [0, 0];
  state.turn = ((state.round - 1) % 2) as TeamId;
  state.phase = "vote";
  state.step += 1;
  state.deadlineAt = timer(state.config.voteSeconds, ctx);
}

function settle(state: PollMineState): GameResult<PollMineState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  const [a, b] = state.points;
  const award = (team: TeamId, points: number, reason: string): ScoreAward[] =>
    state.teams[team].map((p) => ({ playerId: p, points, reason, key: `r${state.round}:${p}` }));
  if (a === b)
    return {
      ok: true,
      state,
      scores: a === 0 ? [] : [...award(0, POINTS_TIE, "打平"), ...award(1, POINTS_TIE, "打平")],
    };
  return { ok: true, state, scores: award(a > b ? 0 : 1, POINTS_WIN, "本轮获胜") };
}

function toHunt(state: PollMineState): GameResult<PollMineState> {
  state.step += 1;
  state.deadlineAt = null;
  // With no answers at all there is nothing to find.
  if (Object.keys(state.votes).length === 0) return settle(state);
  state.phase = "hunt";
  return { ok: true, state };
}

function advance(state: PollMineState, ctx: GameContext): GameResult<PollMineState> {
  if (state.config.rounds > 0 && state.round >= state.config.rounds) {
    state.phase = "finished";
    state.step += 1;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  }
  state.round += 1;
  return openRound(state, ctx);
}

export const pollMineGame = defineGame<PollMineState, Action, PollMineView, Config>({
  meta: {
    id: "pollmine",
    name: "猜大家选",
    description: "先各自秘密回答一道选择题，再分两队轮流猜「哪些选项有人选了」。猜到没人选的就踩雷。",
    minPlayers: 4,
    maxPlayers: 8,
    rulesSummary: `按加入顺序交替分成红蓝两队。每轮由轮流担任的出题人从候选题里选一道（可以换一批）。所有人先秘密选出自己的答案；然后两队轮流翻开一个选项：有人选过，本队得到「选它的人数」分；没人选过，本队失去一条命（每轮 ${LIVES} 条），命用完就不能再翻。有人选的选项全部翻出、或两队都没命时本轮结束。结算只公开每个选项的人数，不公开谁选了什么。数据只来自本房间玩家的回答。`,
    scoringSummary: `每轮分数高的队伍每人 +${POINTS_WIN}；打平每人 +${POINTS_TIE}。`,
    contentType: "poll",
    options: [roundsOption(4), secondsOption("voteSeconds", "作答时限", 45), pickSecondsOption],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 4) return { ok: false, error: "至少需要 4 名玩家（每队 2 人）" };
    const state: PollMineState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      teams: splitTeams(ctx.players),
      poll: { contentId: null, data: { text: "", options: [] } },
      votes: {},
      opened: [],
      turn: 0,
      lives: [LIVES, LIVES],
      points: [0, 0],
      deadlineAt: null,
    };
    const r = openRound(state, ctx);
    if (state.pick.candidates.length === 0) return { ok: false, error: "题库中没有可用的题目" };
    return r;
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    const team = teamOf(state.teams, me);
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startRound(state, r.chosen, ctx);
      return { ok: true, state };
    }
    if (action.type === "advance") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
      if (state.phase === "vote") return toHunt(state);
      if (state.phase === "hunt") return settle(state);
      if (state.phase === "reveal") return advance(state, ctx);
      return { ok: false, error: "出题人正在选题" };
    }
    if (team === null) return { ok: false, error: "你将从下一轮开始参与" };
    const options = state.poll.data.options;
    if (action.option >= options.length) return { ok: false, error: "没有这个选项" };
    if (action.type === "vote") {
      if (state.phase !== "vote") return { ok: false, error: "现在不是作答阶段" };
      if (me in state.votes) return { ok: false, error: "你已经选过了" };
      state.votes[me] = action.option;
      return voters(state).every((p) => p in state.votes) ? toHunt(state) : { ok: true, state };
    }
    if (state.phase !== "hunt") return { ok: false, error: "现在不是翻选项的阶段" };
    if (team !== state.turn) return { ok: false, error: "现在轮到对方" };
    if (state.opened.some((o) => o.option === action.option)) return { ok: false, error: "这个选项已经翻开了" };
    const count = countFor(state, action.option);
    state.opened.push({ option: action.option, team, count });
    if (count > 0) state.points[team] += count;
    else state.lives[team] -= 1;
    state.step += 1;
    const left = options.some((_, i) => countFor(state, i) > 0 && !state.opened.some((o) => o.option === i));
    if (!left || (state.lives[0] === 0 && state.lives[1] === 0)) return settle(state);
    // The turn alternates, but a team with no lives left is passed over.
    if (state.lives[other(team)] > 0) state.turn = other(team);
    return { ok: true, state };
  },

  skip: {
    key: (state) => (state.phase === "vote" ? `r${state.round}` : null),
    voters: (state) => voters(state),
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.poll.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "猜大家选");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) => (state.phase === "pick" || state.phase === "vote" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) {
        state.phase = "finished";
        state.step += 1;
        state.deadlineAt = null;
        return { ok: true, state, finished: true };
      }
      startRound(state, c, ctx);
      return { ok: true, state };
    }
    return state.phase === "vote" ? toHunt(state) : { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "vote") state.deadlineAt = timer(state.config.voteSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const open = state.phase === "reveal" || state.phase === "finished";
    const picking = state.phase === "pick";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick: picking ? pickView(state.pick, (d) => d.text, PICK.allowCustom) : null,
      teams: state.teams,
      myTeam: teamOf(state.teams, viewer),
      text: picking ? "" : state.poll.data.text,
      options: picking ? [] : state.poll.data.options,
      voted: Object.keys(state.votes),
      myVote: state.votes[viewer] ?? null,
      opened: state.opened,
      turn: state.turn,
      lives: state.lives,
      points: state.points,
      counts: open ? state.poll.data.options.map((_, i) => countFor(state, i)) : null,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `猜大家选 第 ${state.round} 轮：出题人正在选题`;
    const options = state.poll.data.options;
    const opened = state.opened.map((o) => `${options[o.option]}(${o.count}人)`).join("、") || "无";
    return `猜大家选 第 ${state.round} 轮，题目「${state.poll.data.text}」，阶段：${state.phase}。已翻开：${opened}。红队 ${state.points[0]} 分 ${state.lives[0]} 命；蓝队 ${state.points[1]} 分 ${state.lives[1]} 命（未翻开选项的人数未公开）`;
  },
});
