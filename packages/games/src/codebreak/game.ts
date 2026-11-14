/**
 * 「密码传递」— two teams, four secret keywords each. Every round a team's encoder gets a
 * 3-digit code and writes one clue per digit; the team must decode it while the other team,
 * who sees every clue, tries to intercept. Rule spec: docs/games/codebreak.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";
import { dealWords, splitTeams, type TeamId, teamOf } from "../words.ts";

export const KEYWORDS = 4;
export const TOKENS_TO_END = 2;
export const MAX_ROUNDS = 8;
const POINTS_WIN = 3;

const code = z.array(z.number().int().min(1).max(KEYWORDS)).length(3);
const configSchema = z.object({
  clueSeconds: z.number().int().min(0).max(900).default(0),
  guessSeconds: z.number().int().min(0).max(900).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("clues"),
    step: z.number().int(),
    clues: z.array(z.string().trim().min(1).max(20)).length(3),
  }),
  /** `target` is the team whose code is being guessed: own team = decode, other = intercept. */
  z.object({ type: z.literal("guess"), step: z.number().int(), target: z.number().int().min(0).max(1), code }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

type Pair<T> = [T, T];
interface RoundRecord {
  round: number;
  /** Per team: the clues, the real code and what each side guessed. */
  teams: Pair<{ clues: string[]; code: number[]; decode: number[] | null; intercept: number[] | null }>;
}

export interface CodeBreakState {
  config: Config;
  round: number;
  step: number;
  phase: "clue" | "guess" | "reveal" | "finished";
  teams: Pair<PlayerId[]>;
  /** Secret to the other team for the whole game. */
  keywords: Pair<string[]>;
  encoders: Pair<PlayerId>;
  codes: Pair<number[]>;
  clues: Pair<string[] | null>;
  /** guesses[guessingTeam][targetTeam] */
  guesses: Pair<Pair<number[] | null>>;
  history: RoundRecord[];
  intercepts: Pair<number>;
  miscomms: Pair<number>;
  winner: TeamId | "draw" | null;
  deadlineAt: number | null;
}

export interface CodeBreakView {
  round: number;
  step: number;
  phase: CodeBreakState["phase"];
  teams: Pair<PlayerId[]>;
  myTeam: TeamId | null;
  encoders: Pair<PlayerId>;
  /** Own team's keywords; both teams' once the game is over. */
  keywords: Pair<string[] | null>;
  /** Only the encoder sees their team's code before the reveal. */
  myCode: number[] | null;
  /** Clues become public once both encoders are done. */
  clues: Pair<string[] | null>;
  cluesDone: Pair<boolean>;
  /** What this viewer's team has submitted this round, per target team. */
  myGuesses: Pair<number[] | null>;
  guessesDone: Pair<Pair<boolean>>;
  canIntercept: boolean;
  history: RoundRecord[];
  intercepts: Pair<number>;
  miscomms: Pair<number>;
  winner: CodeBreakState["winner"];
  deadlineAt: number | null;
}

const other = (t: TeamId): TeamId => (t === 0 ? 1 : 0);
const same = (a: number[] | null, b: number[]) => a?.every((d, i) => d === b[i]);

function startRound(state: CodeBreakState, ctx: GameContext) {
  for (const t of [0, 1] as const) {
    const team = state.teams[t];
    state.encoders[t] = team[(state.round - 1) % team.length] as PlayerId;
    state.codes[t] = shuffle([1, 2, 3, 4], ctx.random).slice(0, 3);
  }
  state.clues = [null, null];
  state.guesses = [
    [null, null],
    [null, null],
  ];
  state.phase = "clue";
  state.step += 1;
  state.deadlineAt = timer(state.config.clueSeconds, ctx);
}

/** Which guesses a round needs: every team decodes; interception starts in round 2. */
const needed = (state: CodeBreakState): [TeamId, TeamId][] =>
  ([0, 1] as const).flatMap((g) =>
    ([0, 1] as const).filter((t) => t === g || state.round > 1).map((t) => [g, t] as [TeamId, TeamId]),
  );

function reveal(state: CodeBreakState): GameResult<CodeBreakState> {
  for (const t of [0, 1] as const) {
    if (!same(state.guesses[t][t], state.codes[t])) state.miscomms[t] += 1;
    if (state.round > 1 && same(state.guesses[other(t)][t], state.codes[t])) state.intercepts[other(t)] += 1;
  }
  state.history.push({
    round: state.round,
    teams: [0, 1].map((t) => ({
      clues: state.clues[t as TeamId] ?? ["（未提交）", "（未提交）", "（未提交）"],
      code: state.codes[t as TeamId],
      decode: state.guesses[t as TeamId][t as TeamId],
      intercept: state.guesses[other(t as TeamId)][t as TeamId],
    })) as RoundRecord["teams"],
  });
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  // Net tokens decide: interceptions count for a team, miscommunications against it.
  const ended =
    state.round >= MAX_ROUNDS ||
    [0, 1].some((t) => state.intercepts[t as TeamId] >= TOKENS_TO_END || state.miscomms[t as TeamId] >= TOKENS_TO_END);
  if (!ended) return { ok: true, state };
  const net = (t: TeamId) => state.intercepts[t] - state.miscomms[t];
  state.winner = net(0) === net(1) ? "draw" : net(0) > net(1) ? 0 : 1;
  const scores: ScoreAward[] =
    state.winner === "draw"
      ? []
      : state.teams[state.winner].map((p) => ({
          playerId: p,
          points: POINTS_WIN,
          reason: "队伍获胜",
          key: `win:${p}`,
        }));
  return { ok: true, state, scores };
}

function toGuess(state: CodeBreakState, ctx: GameContext): GameResult<CodeBreakState> {
  state.phase = "guess";
  state.step += 1;
  state.deadlineAt = timer(state.config.guessSeconds, ctx);
  return { ok: true, state };
}

export const codeBreakGame = defineGame<CodeBreakState, Action, CodeBreakView, Config>({
  meta: {
    id: "codebreak",
    name: "密码传递",
    description: "每队四个秘密关键词。用提示把三位密码传给队友——但对手也在听，提示太直白就会被破译。",
    minPlayers: 4,
    maxPlayers: 8,
    rulesSummary: `按加入顺序交替分成红蓝两队，每队有 4 个只有自己人看得到的关键词（编号 1–4）。每轮两队各有一名传令员（轮流）拿到一组三位密码（如 3-1-4），为每一位写一条提示，暗示对应编号的关键词。提示公开后，各队由传令员以外的队友提交对本队密码的解读；从第 2 轮起，每队还要尝试破译对方的密码（全队可提交）。队内商量后任何一名有资格的队员提交即算全队答案。本队解错记 1 次「失误」，破译对方成功记 1 次「拦截」。任一队累计 ${TOKENS_TO_END} 次拦截或 ${TOKENS_TO_END} 次失误（或打满 ${MAX_ROUNDS} 轮）时结束，按「拦截 − 失误」多者胜。传令员除提示外不要透露任何信息（系统无法监听语音）。`,
    scoringSummary: `获胜队伍每人 +${POINTS_WIN} 分；平局不得分。`,
    options: [secondsOption("clueSeconds", "写提示时限", 0), secondsOption("guessSeconds", "解读时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 4) return { ok: false, error: "至少需要 4 名玩家（每队 2 人）" };
    const words = dealWords(KEYWORDS * 2, ctx.random);
    const state: CodeBreakState = {
      config,
      round: 1,
      step: 0,
      phase: "clue",
      teams: splitTeams(ctx.players),
      keywords: [words.slice(0, KEYWORDS), words.slice(KEYWORDS)],
      encoders: ["", ""],
      codes: [[], []],
      clues: [null, null],
      guesses: [
        [null, null],
        [null, null],
      ],
      history: [],
      intercepts: [0, 0],
      miscomms: [0, 0],
      winner: null,
      deadlineAt: null,
    };
    startRound(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    const team = teamOf(state.teams, me);
    switch (action.type) {
      case "clues": {
        if (state.phase !== "clue") return { ok: false, error: "现在不是写提示的时候" };
        if (team === null || state.encoders[team] !== me) return { ok: false, error: "这一轮你不是传令员" };
        if (state.clues[team]) return { ok: false, error: "提示已经提交了" };
        const own = state.keywords[team];
        if (action.clues.some((c) => own.some((w) => c.includes(w)))) {
          return { ok: false, error: "提示里不能出现本队的关键词" };
        }
        state.clues[team] = action.clues;
        return state.clues[0] && state.clues[1] ? toGuess(state, ctx) : { ok: true, state };
      }
      case "guess": {
        if (state.phase !== "guess") return { ok: false, error: "现在不是解读的时候" };
        if (team === null) return { ok: false, error: "你不在任何一队" };
        const target = action.target as TeamId;
        if (new Set(action.code).size !== 3) return { ok: false, error: "三位密码不能重复" };
        if (target === team && state.encoders[team] === me) return { ok: false, error: "传令员不能解读自己的提示" };
        if (target !== team && state.round === 1) return { ok: false, error: "第 2 轮起才能破译对方" };
        if (state.guesses[team][target]) return { ok: false, error: "你们队已经提交过了" };
        state.guesses[team][target] = action.code;
        return needed(state).every(([g, t]) => state.guesses[g][t]) ? reveal(state) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "clue") return toGuess(state, ctx);
        if (state.phase === "guess") return reveal(state);
        if (state.winner !== null) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.round += 1;
        startRound(state, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "reveal",
  deadline: (state) => (state.phase === "clue" || state.phase === "guess" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "clue") return toGuess(state, ctx);
    if (state.phase === "guess") return reveal(state);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "clue") state.deadlineAt = timer(state.config.clueSeconds, ctx);
    if (state.phase === "guess") state.deadlineAt = timer(state.config.guessSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const team = teamOf(state.teams, viewer);
    const over = state.winner !== null;
    const cluesPublic = state.phase !== "clue";
    return {
      round: state.round,
      step: state.step,
      phase: state.phase,
      teams: state.teams,
      myTeam: team,
      encoders: state.encoders,
      keywords: [0, 1].map((t) => (over || t === team ? state.keywords[t as TeamId] : null)) as Pair<string[] | null>,
      myCode: team !== null && state.encoders[team] === viewer && state.phase !== "reveal" ? state.codes[team] : null,
      clues: [0, 1].map((t) =>
        cluesPublic || (t === team && state.encoders[t] === viewer) ? state.clues[t as TeamId] : null,
      ) as Pair<string[] | null>,
      cluesDone: [state.clues[0] !== null, state.clues[1] !== null],
      myGuesses: team === null || state.phase !== "guess" ? [null, null] : state.guesses[team],
      guessesDone: state.guesses.map((g) => g.map((x) => x !== null)) as Pair<Pair<boolean>>,
      canIntercept: state.round > 1,
      history: state.history,
      intercepts: state.intercepts,
      miscomms: state.miscomms,
      winner: state.winner,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const tokens = `红队 拦截 ${state.intercepts[0]} 失误 ${state.miscomms[0]}；蓝队 拦截 ${state.intercepts[1]} 失误 ${state.miscomms[1]}`;
    const clues =
      state.phase === "clue"
        ? "传令员正在写提示"
        : `本轮提示 红：${state.clues[0]?.join(" / ") ?? "无"}；蓝：${state.clues[1]?.join(" / ") ?? "无"}`;
    const end =
      state.winner === null
        ? ""
        : `。结果：${state.winner === "draw" ? "平局" : state.winner === 0 ? "红队胜" : "蓝队胜"}`;
    return `密码传递 第 ${state.round} 轮，阶段：${state.phase}。${clues}。${tokens}（关键词与密码未公开）${end}`;
  },
});
