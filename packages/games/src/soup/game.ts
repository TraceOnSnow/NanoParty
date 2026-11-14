/**
 * 「海龟汤」— lateral-thinking puzzle. One player (the soup master) knows the full story;
 * the others ask yes/no questions and try to reconstruct it. Rule spec: docs/games/soup.md
 *
 * The answerer is a player today. The answers are plain actions, so an AI answerer can later
 * submit the same actions without changing the rules.
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

export const QUESTION_MAX = 60;
export const POINTS_SOLVER = 3;
export const POINTS_MASTER = 1;

const payload = z.object({ surface: z.string().min(1).max(200), solution: z.string().min(1).max(400) });
/** Payload shape of this game's content type. */
export const soupContentSchema = payload;
type Puzzle = z.infer<typeof payload>;

const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(10).default(2),
  playSeconds: z.number().int().min(0).max(1800).default(600),
});
type Config = z.infer<typeof configSchema>;

export const VERDICTS = ["yes", "no", "irrelevant", "partly"] as const;
export type Verdict = (typeof VERDICTS)[number];

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("ask"), step: z.number().int(), text: z.string().trim().min(1).max(QUESTION_MAX) }),
  z.object({ type: z.literal("answer"), step: z.number().int(), id: z.number().int(), verdict: z.enum(VERDICTS) }),
  /** A full attempt at the story. */
  z.object({ type: z.literal("solve"), step: z.number().int(), text: z.string().trim().min(1).max(200) }),
  /** Soup master: is this attempt right? */
  z.object({ type: z.literal("judge"), step: z.number().int(), id: z.number().int(), correct: z.boolean() }),
  /** Soup master or host: give up and reveal the story. */
  z.object({ type: z.literal("reveal"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

interface Entry {
  id: number;
  by: PlayerId;
  kind: "question" | "attempt";
  text: string;
  /** Question: the verdict. Attempt: "correct" / "wrong". Null while waiting for the soup master. */
  verdict: Verdict | "correct" | "wrong" | null;
}

export interface SoupState {
  config: Config;
  pick: PickState<Puzzle>;
  round: number;
  step: number;
  phase: "pick" | "play" | "reveal" | "finished";
  /** The soup master of this round: picks the puzzle and answers. */
  master: PlayerId;
  participants: PlayerId[];
  puzzle: { contentId: string | null; surface: string; solution: string };
  log: Entry[];
  nextId: number;
  solver: PlayerId | null;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface SoupView {
  round: number;
  totalRounds: number;
  step: number;
  phase: SoupState["phase"];
  pick: PickView | null;
  master: PlayerId;
  participants: PlayerId[];
  surface: string;
  /** Only for the soup master before the reveal; for everyone afterwards. */
  solution: string | null;
  log: Entry[];
  solver: PlayerId | null;
  deadlineAt: number | null;
}

const PICK = { schema: payload, contentType: "soup", allowCustom: true };

function finish(state: SoupState, why: SoupState["endedBecause"]): GameResult<SoupState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = why;
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** The soup master rotates; they choose (or write) the puzzle they will host. */
function openRound(state: SoupState, ctx: GameContext): GameResult<SoupState> {
  state.phase = "pick";
  state.step += 1;
  state.participants = [...ctx.players];
  state.master = rotatePicker(state.pick, state.participants);
  openPick(state.pick, state.master, payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startPlay(state: SoupState, c: { contentId: string | null; data: Puzzle }, ctx: GameContext) {
  state.puzzle = { contentId: c.contentId, ...c.data };
  state.phase = "play";
  state.step += 1;
  state.log = [];
  state.nextId = 1;
  state.solver = null;
  state.deadlineAt = timer(state.config.playSeconds, ctx);
}

function reveal(state: SoupState): GameResult<SoupState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  if (!state.solver) return { ok: true, state };
  const scores: ScoreAward[] = [
    { playerId: state.solver, points: POINTS_SOLVER, reason: "喝出了海龟汤", key: `r${state.round}:solver` },
    { playerId: state.master, points: POINTS_MASTER, reason: "汤主带领破案", key: `r${state.round}:master` },
  ];
  return { ok: true, state, scores };
}

function advance(state: SoupState, ctx: GameContext): GameResult<SoupState> {
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return finish(state, "rounds");
  if (ctx.players.length < 2) return finish(state, "rounds");
  state.round += 1;
  return openRound(state, ctx);
}

/** A player may have only one question or attempt waiting for an answer at a time. */
const waiting = (state: SoupState, p: PlayerId) => state.log.some((e) => e.by === p && e.verdict === null);

export const soupGame = defineGame<SoupState, Action, SoupView, Config>({
  meta: {
    id: "soup",
    name: "海龟汤",
    description: "汤主知道一个离奇故事的全部真相，大家只能问「是不是」，一步步还原它。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮由一名玩家（轮流）当汤主：先选一道汤（或自己出），只有汤主看得到汤底。其他人看汤面，在网页上提问，汤主逐条回答「是 / 不是 / 无关 / 部分正确」。每人同时只能有一条问题在等回答。觉得自己知道了，就提交完整推理，由汤主判对错。有人答对，或汤主放弃、时间到，公开汤底。中途加入的玩家下一轮参与。",
    scoringSummary: `喝出汤的人 +${POINTS_SOLVER} 分，汤主 +${POINTS_MASTER} 分；没人喝出则都不得分。`,
    contentType: "soup",
    options: [
      { key: "rounds", label: "轮数", min: 0, max: 10, default: 2, hint: "0 = 不限" },
      secondsOption("playSeconds", "每碗汤限时", 600),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: SoupState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      master: "",
      participants: [],
      puzzle: { contentId: null, surface: "", solution: "" },
      log: [],
      nextId: 1,
      solver: null,
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
    const isMaster = me === state.master;
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的汤已经选好了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startPlay(state, r.chosen, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "汤主正在选汤，稍等一下" };
    switch (action.type) {
      case "ask":
      case "solve": {
        if (state.phase !== "play") return { ok: false, error: "这碗汤已经结束了" };
        if (isMaster) return { ok: false, error: "汤主不用提问" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (waiting(state, me)) return { ok: false, error: "先等汤主回答你上一条" };
        state.log.push({
          id: state.nextId++,
          by: me,
          kind: action.type === "ask" ? "question" : "attempt",
          text: action.text,
          verdict: null,
        });
        // The step does not change: other players' pending actions stay valid.
        return { ok: true, state };
      }
      case "answer":
      case "judge": {
        if (state.phase !== "play") return { ok: false, error: "这碗汤已经结束了" };
        if (!isMaster) return { ok: false, error: "只有汤主可以回答" };
        const entry = state.log.find((e) => e.id === action.id);
        if (!entry || entry.verdict !== null) return { ok: false, error: "这条已经回答过了" };
        if (action.type === "answer") {
          if (entry.kind !== "question") return { ok: false, error: "这是一条推理，请判对错" };
          entry.verdict = action.verdict;
          return { ok: true, state };
        }
        if (entry.kind !== "attempt") return { ok: false, error: "这是一条问题，请回答是或不是" };
        entry.verdict = action.correct ? "correct" : "wrong";
        if (!action.correct) return { ok: true, state };
        state.solver = entry.by;
        return reveal(state);
      }
      case "reveal": {
        if (!isMaster && !actor.isHost) return { ok: false, error: "只有汤主或房主可以公布汤底" };
        if (state.phase !== "play") return { ok: false, error: "现在不能公布" };
        return reveal(state);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以进入下一轮" };
        if (state.phase !== "reveal") return { ok: false, error: "这碗汤还没结束" };
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "play" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "reveal" ? state.puzzle.contentId : null),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "海龟汤");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) => (state.phase === "pick" || state.phase === "play" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return advance(state, ctx);
      startPlay(state, c, ctx);
      return { ok: true, state };
    }
    if (state.phase === "play") return reveal(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "play") state.deadlineAt = timer(state.config.playSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase === "reveal" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      // Candidates show only the surface; the solution stays with the soup master after choosing.
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.surface, PICK.allowCustom) : null,
      master: state.master,
      participants: state.participants,
      surface: state.puzzle.surface,
      solution: revealed || (viewer === state.master && state.phase !== "pick") ? state.puzzle.solution : null,
      log: state.log,
      solver: state.solver,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `海龟汤 第 ${state.round} 轮：汤主正在选汤`;
    const asked = state.log
      .map((e) => `${e.kind === "question" ? "问" : "推理"}「${e.text}」→${e.verdict ?? "待回答"}`)
      .join("；");
    const base = `海龟汤 第 ${state.round} 轮，汤面：「${state.puzzle.surface}」。问答记录：${asked || "暂无"}`;
    return state.phase === "play"
      ? `${base}（汤底只有汤主知道，未公开）`
      : `${base}。汤底：${state.puzzle.solution}（已揭晓）`;
  },
});
