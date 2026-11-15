/**
 * 「海龟汤」— lateral-thinking puzzle. Players see the surface of an odd story and ask yes/no
 * questions to reconstruct the truth. Rule spec: docs/games/soup.md
 *
 * Two ways to host, same question log on the main panel:
 * - human: one player (the soup master) knows the story and answers;
 * - ai: nobody in the room knows it; each question is judged by the game's referee AI against
 *   the fixed solution. The referee's answers are plain data applied by these rules, so the
 *   story can never change mid-game and a wrong answer can be corrected and traced.
 */
import {
  defineGame,
  type GameContext,
  type GameResult,
  type JudgeTask,
  type PlayerId,
  type ScoreAward,
} from "@apr/shared";
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
import { secondsOption, timer } from "../util.ts";

export const QUESTION_MAX = 60;
export const POINTS_SOLVER = 3;
export const POINTS_MASTER = 1;

const short = z.string().trim().min(1).max(40);
const payload = z.object({
  surface: z.string().min(1).max(200),
  solution: z.string().min(1).max(400),
  /** Key facts a solver has to uncover, in the puzzle author's words. */
  facts: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  /** Words the story's logic depends on; an adaptation must leave them alone. */
  fixed: z.array(short).max(12).optional(),
  /** Words that are only dressing (names, places); an adaptation may swap them. */
  adaptable: z.array(short).max(12).optional(),
  /** Id of the puzzle this one was adapted from. */
  basedOn: z.string().optional(),
});
/** Payload shape of this game's content type. */
export const soupContentSchema = payload;
export type SoupPuzzle = z.infer<typeof payload>;

const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(10).default(2),
  playSeconds: z.number().int().min(0).max(1800).default(600),
  /** 1 = the referee AI hosts; 0 = a player is the soup master. */
  aiJudge: z.number().int().min(0).max(1).default(0),
});
type Config = z.infer<typeof configSchema>;

/** `unknown` = the story does not say; `clarify` = the question cannot be answered as asked. */
export const VERDICTS = ["yes", "no", "irrelevant", "partly", "unknown", "clarify"] as const;
export type Verdict = (typeof VERDICTS)[number];

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("ask"), step: z.number().int(), text: z.string().trim().min(1).max(QUESTION_MAX) }),
  z.object({ type: z.literal("answer"), step: z.number().int(), id: z.number().int(), verdict: z.enum(VERDICTS) }),
  /** A full attempt at the story. */
  z.object({ type: z.literal("solve"), step: z.number().int(), text: z.string().trim().min(1).max(200) }),
  /** Soup master: is this attempt right? */
  z.object({ type: z.literal("judge"), step: z.number().int(), id: z.number().int(), correct: z.boolean() }),
  /** Anyone taking part: "this answer looks wrong". */
  z.object({ type: z.literal("flag"), step: z.number().int(), id: z.number().int() }),
  /** Host (AI mode): have the referee look at this one again. Asker or host: retry a failed one. */
  z.object({ type: z.literal("rejudge"), step: z.number().int(), id: z.number().int() }),
  /** Someone who knows the story fixes an answer. The original stays on record. */
  z.object({
    type: z.literal("correct"),
    step: z.number().int(),
    id: z.number().int(),
    verdict: z.enum(VERDICTS),
    reason: z.string().trim().max(80).optional(),
  }),
  /** Host (AI mode): ask the referee for a hint. */
  z.object({ type: z.literal("hint"), step: z.number().int() }),
  /** Host (AI mode): look at the solution. They stop being a solver for this soup. */
  z.object({ type: z.literal("peek"), step: z.number().int() }),
  /** AI mode: a player takes over as the soup master (and sees the solution). */
  z.object({ type: z.literal("takeover"), step: z.number().int() }),
  /** Soup master or host: give up and reveal the story. */
  z.object({ type: z.literal("reveal"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SoupEntry {
  id: number;
  by: PlayerId;
  kind: "question" | "attempt" | "hint";
  text: string;
  /** Question: the verdict. Attempt: "correct" / "wrong". Hint: "hint". Null until answered. */
  verdict: Verdict | "correct" | "wrong" | "hint" | null;
  /** queued → judging → answered, or failed (referee unavailable; can be retried). */
  status: "queued" | "judging" | "answered" | "failed";
  /** The referee's hint text (hint entries only). */
  reply?: string;
  /** Players who reported this answer as wrong. */
  flagged: PlayerId[];
  /** Earlier verdicts that were replaced, oldest first. */
  corrections: { from: SoupEntry["verdict"]; to: SoupEntry["verdict"]; by: PlayerId | "ai"; reason: string }[];
  /** Set while the referee is asked to look again; what it said before. */
  recheck?: boolean;
}

export interface SoupState {
  config: Config;
  pick: PickState<SoupPuzzle>;
  round: number;
  step: number;
  phase: "pick" | "play" | "reveal" | "finished";
  mode: "human" | "ai";
  /** Human mode: the soup master of this round. AI mode: "" (or whoever took over). */
  master: PlayerId;
  participants: PlayerId[];
  puzzle: { contentId: string | null; surface: string; solution: string; facts: string[] };
  log: SoupEntry[];
  nextId: number;
  solver: PlayerId | null;
  /** Rounds each player spent as the human soup master (they could not solve in those). */
  hosted?: Record<PlayerId, number>;
  /** Players who have seen the solution without being the master (host peek). They no longer solve. */
  spoiled: PlayerId[];
  /** Who first got a "yes" that established each key fact (index into puzzle.facts). */
  firstHits: Record<number, PlayerId>;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface SoupView {
  round: number;
  totalRounds: number;
  step: number;
  phase: SoupState["phase"];
  mode: SoupState["mode"];
  pick: PickView | null;
  master: PlayerId;
  participants: PlayerId[];
  surface: string;
  /** For the soup master / a host who peeked before the reveal; for everyone afterwards. */
  solution: string | null;
  knowsSolution: boolean;
  log: SoupEntry[];
  solver: PlayerId | null;
  spoiled: PlayerId[];
  /** After the reveal: the key facts and who first uncovered each. */
  facts: { text: string; by: PlayerId | null }[] | null;
  deadlineAt: number | null;
}

const pickOpts = (state: SoupState) => ({
  schema: payload,
  contentType: "soup",
  // Writing a soup means knowing its solution, which only makes sense with a human soup master.
  allowCustom: state.mode === "human",
});

function finish(state: SoupState, why: SoupState["endedBecause"]): GameResult<SoupState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = why;
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** Human mode: the rotating soup master chooses. AI mode: a rotating picker chooses by surface only. */
function openRound(state: SoupState, ctx: GameContext): GameResult<SoupState> {
  state.phase = "pick";
  state.step += 1;
  state.mode = state.config.aiJudge === 1 ? "ai" : "human";
  state.participants = [...ctx.players];
  const picker = rotatePicker(state.pick, state.participants);
  state.master = state.mode === "human" ? picker : "";
  openPick(state.pick, picker, payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startPlay(state: SoupState, c: { contentId: string | null; data: SoupPuzzle }, ctx: GameContext) {
  state.puzzle = {
    contentId: c.contentId,
    surface: c.data.surface,
    solution: c.data.solution,
    facts: c.data.facts ?? [],
  };
  state.phase = "play";
  state.step += 1;
  if (state.master) state.hosted = { ...state.hosted, [state.master]: (state.hosted?.[state.master] ?? 0) + 1 };
  state.log = [];
  state.nextId = 1;
  state.solver = null;
  state.spoiled = [];
  state.firstHits = {};
  state.deadlineAt = timer(state.config.playSeconds, ctx);
}

function reveal(state: SoupState): GameResult<SoupState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  if (!state.solver) return { ok: true, state };
  const scores: ScoreAward[] = [
    { playerId: state.solver, points: POINTS_SOLVER, reason: "喝出了海龟汤", key: `r${state.round}:solver` },
  ];
  // Only a soup master who hosted from the start earns the hosting point.
  if (state.mode === "human" && state.config.aiJudge === 0) {
    scores.push({
      playerId: state.master,
      points: POINTS_MASTER,
      reason: "汤主带领破案",
      key: `r${state.round}:master`,
    });
  }
  return { ok: true, state, scores };
}

function advance(state: SoupState, ctx: GameContext): GameResult<SoupState> {
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return finish(state, "rounds");
  if (ctx.players.length < 2) return finish(state, "rounds");
  state.round += 1;
  return openRound(state, ctx);
}

const pending = (e: SoupEntry) => e.status === "queued" || e.status === "judging";
/** A player may have only one question or attempt waiting for an answer at a time. */
const waiting = (state: SoupState, p: PlayerId) => state.log.some((e) => e.by === p && pending(e));
const knows = (state: SoupState, p: PlayerId) => p === state.master || state.spoiled.includes(p);

function setVerdict(
  _state: SoupState,
  entry: SoupEntry,
  verdict: SoupEntry["verdict"],
  by: PlayerId | "ai",
  reason = "",
) {
  if (entry.verdict !== null && entry.verdict !== verdict) {
    entry.corrections.push({ from: entry.verdict, to: verdict, by, reason });
  }
  entry.verdict = verdict;
  entry.status = "answered";
  entry.recheck = false;
}

/** What the referee is told. Everything here is secret from the players and from the host agent. */
function judgeInput(state: SoupState, entry: SoupEntry) {
  return {
    surface: state.puzzle.surface,
    solution: state.puzzle.solution,
    facts: state.puzzle.facts,
    // Confirmed answers so far, including human corrections, so the referee stays consistent.
    history: state.log
      .filter((e) => e.id !== entry.id && e.status === "answered" && e.kind !== "hint")
      .map((e) => ({
        kind: e.kind,
        text: e.text,
        verdict: e.verdict,
        corrected: e.corrections.some((c) => c.by !== "ai"),
      })),
    text: entry.text,
    previous: entry.recheck ? (entry.corrections.at(-1)?.from ?? entry.verdict) : null,
  };
}

export const soupGame = defineGame<SoupState, Action, SoupView, Config>({
  meta: {
    id: "soup",
    name: "海龟汤",
    description: "一个离奇故事只露出一角，大家只能问「是不是」，一步步还原真相。可以由 AI 主持，所有人一起猜。",
    minPlayers: 2,
    maxPlayers: 8,
    rulesSummary:
      "看汤面，在左侧提问，每个问题会得到「是 / 不是 / 无关 / 部分正确 / 故事没说 / 问得不清楚」之一；每人同时只能有一条在等回答。觉得知道了，就提交完整推理。有人答对、主持放弃或时间到，公开汤底。真人主持：每轮一名玩家（轮流）当汤主，选汤（或自己出）并回答。AI 主持：没有人知道汤底，轮流的选题人只看汤面选汤，问题由独立的 AI 裁判按固定汤底判定；觉得判错了可以标记，房主可以让它重判；AI 不可用时可以重试，或由一名玩家知情接管当汤主。中途加入的玩家下一轮参与。",
    scoringSummary: `喝出汤的人 +${POINTS_SOLVER} 分；真人主持时汤主 +${POINTS_MASTER} 分。没人喝出则都不得分。`,
    contentType: "soup",
    aiOption: "aiJudge",
    options: [
      { key: "aiJudge", label: "AI 主持", min: 0, max: 1, default: 0, hint: "1 = AI 裁判，0 = 真人汤主" },
      { key: "rounds", label: "轮数", min: 0, max: 10, default: 2, hint: "0 = 不限" },
      secondsOption("playSeconds", "每碗汤限时", 600),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    const min = config.aiJudge === 1 ? 2 : 3;
    if (ctx.players.length < min) return { ok: false, error: `至少需要 ${min} 名玩家` };
    const state: SoupState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      mode: "human",
      master: "",
      participants: [],
      puzzle: { contentId: null, surface: "", solution: "", facts: [] },
      log: [],
      nextId: 1,
      solver: null,
      spoiled: [],
      firstHits: {},
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
      const r = applyPick(state.pick, action, me, ctx, pickOpts(state));
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startPlay(state, r.chosen, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "正在选汤，稍等一下" };
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以进入下一轮" };
      if (state.phase !== "reveal") return { ok: false, error: "这碗汤还没结束" };
      return advance(state, ctx);
    }
    if (state.phase !== "play") return { ok: false, error: "这碗汤已经结束了" };
    const entryOf = (id: number) => state.log.find((e) => e.id === id);

    switch (action.type) {
      case "ask":
      case "solve": {
        if (knows(state, me)) return { ok: false, error: "你已经知道汤底，不能再提问或推理" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (waiting(state, me)) return { ok: false, error: "先等上一条的回答" };
        state.log.push({
          id: state.nextId++,
          by: me,
          kind: action.type === "ask" ? "question" : "attempt",
          text: action.text,
          verdict: null,
          status: "queued",
          flagged: [],
          corrections: [],
        });
        // The step does not change: other players' pending actions stay valid.
        return { ok: true, state };
      }
      case "answer":
      case "judge": {
        if (state.mode !== "human" || !isMaster) return { ok: false, error: "只有汤主可以回答" };
        const entry = entryOf(action.id);
        if (!entry || !pending(entry)) return { ok: false, error: "这条已经回答过了" };
        if (action.type === "answer") {
          if (entry.kind !== "question") return { ok: false, error: "这是一条推理，请判对错" };
          setVerdict(state, entry, action.verdict, me);
          return { ok: true, state };
        }
        if (entry.kind !== "attempt") return { ok: false, error: "这是一条问题，请回答是或不是" };
        setVerdict(state, entry, action.correct ? "correct" : "wrong", me);
        if (!action.correct) return { ok: true, state };
        state.solver = entry.by;
        return reveal(state);
      }
      case "flag": {
        const entry = entryOf(action.id);
        if (entry?.status !== "answered" || entry.kind === "hint") return { ok: false, error: "这条还没有回答" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (!entry.flagged.includes(me)) entry.flagged.push(me);
        return { ok: true, state };
      }
      case "rejudge": {
        const entry = entryOf(action.id);
        if (!entry || entry.kind === "hint") return { ok: false, error: "没有这条记录" };
        if (state.mode !== "ai") return { ok: false, error: "真人主持时请汤主直接更正" };
        if (entry.status === "failed") {
          if (me !== entry.by && !actor.isHost) return { ok: false, error: "只有提问的人或房主可以重试" };
        } else {
          if (!actor.isHost) return { ok: false, error: "只有房主可以要求重判" };
          if (entry.status !== "answered") return { ok: false, error: "这条还在判定中" };
          entry.recheck = true;
        }
        entry.status = "queued";
        return { ok: true, state };
      }
      case "correct": {
        if (!knows(state, me)) return { ok: false, error: "只有知道汤底的人可以更正" };
        const entry = entryOf(action.id);
        if (entry?.kind !== "question" || entry.status !== "answered") {
          return { ok: false, error: "只能更正已经回答的问题" };
        }
        if (entry.verdict === action.verdict) return { ok: false, error: "和原来的回答一样" };
        setVerdict(state, entry, action.verdict, me, action.reason ?? "");
        return { ok: true, state };
      }
      case "hint": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以要提示" };
        if (state.mode !== "ai") return { ok: false, error: "真人主持时请汤主直接给提示" };
        if (state.log.some((e) => e.kind === "hint" && pending(e))) return { ok: false, error: "上一条提示还在路上" };
        state.log.push({
          id: state.nextId++,
          by: me,
          kind: "hint",
          text: "请求一条提示",
          verdict: null,
          status: "queued",
          flagged: [],
          corrections: [],
        });
        return { ok: true, state };
      }
      case "peek": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以查看汤底" };
        if (state.mode !== "ai") return { ok: false, error: "真人主持时汤底在汤主手里" };
        if (!state.spoiled.includes(me)) state.spoiled.push(me);
        return { ok: true, state };
      }
      case "takeover": {
        if (state.mode !== "ai") return { ok: false, error: "已经有汤主了" };
        if (!state.participants.includes(me) && !actor.isHost) return { ok: false, error: "你将从下一轮开始参与" };
        // From here on a person answers. Whatever the referee had not finished is theirs now.
        state.mode = "human";
        state.master = me;
        for (const e of state.log) if (e.status === "judging" || e.status === "failed") e.status = "queued";
        state.log = state.log.filter((e) => !(e.kind === "hint" && e.status === "queued"));
        return { ok: true, state };
      }
      case "reveal": {
        if (!isMaster && !actor.isHost) return { ok: false, error: "只有汤主或房主可以公布汤底" };
        return reveal(state);
      }
    }
  },

  judge: {
    next(state): JudgeTask | null {
      if (state.phase !== "play" || state.mode !== "ai") return null;
      const entry = state.log.find(pending);
      if (!entry) return null;
      const kind =
        entry.kind === "question" ? "soup-question" : entry.kind === "attempt" ? "soup-attempt" : "soup-hint";
      // The round is part of the id, so an answer for an earlier soup can never land on this one.
      return { id: `r${state.round}:${entry.id}`, kind, input: judgeInput(state, entry) };
    },
    begin(state, taskId) {
      const entry = state.log.find((e) => `r${state.round}:${e.id}` === taskId);
      if (entry?.status === "queued") entry.status = "judging";
      return state;
    },
    resolve(state, taskId, output) {
      const entry = state.log.find((e) => `r${state.round}:${e.id}` === taskId);
      if (state.phase !== "play" || state.mode !== "ai" || !entry || !pending(entry)) {
        return { ok: false, error: "这条判定已经不需要了" };
      }
      if (entry.kind === "question") {
        const parsed = z
          .object({ verdict: z.enum(VERDICTS), facts: z.array(z.number().int().min(0)).max(8).optional() })
          .safeParse(output);
        if (!parsed.success) return { ok: false, error: "裁判的回答格式不对" };
        setVerdict(state, entry, parsed.data.verdict, "ai", entry.recheck ? "房主要求重判" : "");
        if (parsed.data.verdict === "yes") {
          for (const i of parsed.data.facts ?? []) {
            if (i < state.puzzle.facts.length && state.firstHits[i] === undefined) state.firstHits[i] = entry.by;
          }
        }
        return { ok: true, state };
      }
      if (entry.kind === "attempt") {
        const parsed = z.object({ correct: z.boolean() }).safeParse(output);
        if (!parsed.success) return { ok: false, error: "裁判的回答格式不对" };
        setVerdict(state, entry, parsed.data.correct ? "correct" : "wrong", "ai");
        if (!parsed.data.correct) return { ok: true, state };
        state.solver = entry.by;
        return reveal(state);
      }
      const parsed = z.object({ hint: z.string().trim().min(1).max(120) }).safeParse(output);
      if (!parsed.success) return { ok: false, error: "裁判的回答格式不对" };
      entry.reply = parsed.data.hint;
      setVerdict(state, entry, "hint", "ai");
      return { ok: true, state };
    },
    fail(state, taskId) {
      const entry = state.log.find((e) => `r${state.round}:${e.id}` === taskId);
      if (!entry || !pending(entry)) return { ok: false, error: "这条判定已经不需要了" };
      // A re-check that fails leaves the earlier answer standing.
      entry.status = entry.recheck && entry.verdict !== null ? "answered" : "failed";
      entry.recheck = false;
      return { ok: true, state };
    },
  },

  // Someone who hosted every soup never had a chance to solve one: not part of the placement.
  settlement: (state) => ({
    exclude: Object.entries(state.hosted ?? {})
      .filter(([, rounds]) => rounds >= state.round)
      .map(([p]) => p),
  }),
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
    // A judgement interrupted by the restart goes back in the queue (it is asked again, once).
    for (const e of state.log) if (e.status === "judging") e.status = "queued";
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase === "reveal" || state.phase === "finished";
    const insider = state.phase !== "pick" && knows(state, viewer);
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      mode: state.mode,
      // Candidates show only the surface; the solution stays with whoever hosts.
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.surface, pickOpts(state).allowCustom) : null,
      master: state.master,
      participants: state.participants,
      surface: state.puzzle.surface,
      solution: revealed || insider ? state.puzzle.solution : null,
      knowsSolution: insider,
      log: state.log,
      solver: state.solver,
      spoiled: state.spoiled,
      facts: revealed ? state.puzzle.facts.map((text, i) => ({ text, by: state.firstHits[i] ?? null })) : null,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `海龟汤 第 ${state.round} 轮：正在选汤`;
    const asked = state.log
      .filter((e) => e.kind !== "hint")
      .map((e) => `${e.kind === "question" ? "问" : "推理"}「${e.text}」→${e.verdict ?? "待回答"}`)
      .join("；");
    const host = state.mode === "ai" ? "由独立的 AI 裁判主持" : "由真人汤主主持";
    const base = `海龟汤 第 ${state.round} 轮（${host}），汤面：「${state.puzzle.surface}」。问答记录：${asked || "暂无"}`;
    return state.phase === "play"
      ? `${base}（汤底未公开；你不知道汤底，也不要猜测或替裁判回答）`
      : `${base}。汤底：${state.puzzle.solution}（已揭晓）`;
  },
});
