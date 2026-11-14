/**
 * 「暗号网格」— two teams, a 5×5 grid of words. Each captain sees which words belong to which
 * team and gives one-word clues with a number; teammates tap the words they think are theirs.
 * Touching the trap word loses at once. Rule spec: docs/games/wordgrid.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";
import { dealWords, splitTeams, type TeamId, teamOf } from "../words.ts";

export type Owner = TeamId | "neutral" | "trap";
export const GRID = 25;
const POINTS_WIN = 3;

const configSchema = z.object({
  games: z.number().int().min(1).max(5).default(1),
  turnSeconds: z.number().int().min(0).max(900).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("clue"),
    step: z.number().int(),
    word: z.string().trim().min(1).max(12),
    count: z.number().int().min(0).max(9),
  }),
  z.object({
    type: z.literal("guess"),
    step: z.number().int(),
    index: z
      .number()
      .int()
      .min(0)
      .max(GRID - 1),
  }),
  z.object({ type: z.literal("stop"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface WordGridState {
  config: Config;
  game: number;
  step: number;
  phase: "clue" | "guess" | "gameOver" | "finished";
  teams: [PlayerId[], PlayerId[]];
  captains: [PlayerId, PlayerId];
  words: string[];
  /** The key: secret to everyone but the captains until a word is revealed. */
  owners: Owner[];
  revealed: boolean[];
  turn: TeamId;
  clue: { word: string; count: number } | null;
  guessesLeft: number;
  log: { team: TeamId; word: string; count: number; picks: number[] }[];
  winner: TeamId | null;
  endedBy: "all-found" | "trap" | null;
  deadlineAt: number | null;
}

export interface WordGridView extends Omit<WordGridState, "config" | "owners"> {
  totalGames: number;
  myTeam: TeamId | null;
  isCaptain: boolean;
  /** Full key for captains (and for everyone once the game is over); otherwise only revealed cells. */
  owners: (Owner | null)[];
  remaining: [number, number];
}

const remaining = (state: WordGridState, team: TeamId) =>
  state.owners.filter((o, i) => o === team && !state.revealed[i]).length;

function deal(state: WordGridState, ctx: GameContext) {
  // Captains rotate through each team from game to game.
  state.captains = [0, 1].map((t) => {
    const team = state.teams[t as TeamId];
    return team[(state.game - 1) % team.length] as PlayerId;
  }) as [PlayerId, PlayerId];
  const first: TeamId = ctx.random() < 0.5 ? 0 : 1;
  const second: TeamId = first === 0 ? 1 : 0;
  state.words = dealWords(GRID, ctx.random);
  state.owners = shuffle<Owner>(
    [...Array<Owner>(9).fill(first), ...Array<Owner>(8).fill(second), ...Array<Owner>(7).fill("neutral"), "trap"],
    ctx.random,
  );
  state.revealed = Array<boolean>(GRID).fill(false);
  state.turn = first;
  state.clue = null;
  state.guessesLeft = 0;
  state.log = [];
  state.winner = null;
  state.endedBy = null;
  state.phase = "clue";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function win(state: WordGridState, team: TeamId, by: "all-found" | "trap"): GameResult<WordGridState> {
  state.winner = team;
  state.endedBy = by;
  state.phase = "gameOver";
  state.step += 1;
  state.deadlineAt = null;
  return {
    ok: true,
    state,
    scores: state.teams[team].map((p) => ({
      playerId: p,
      points: POINTS_WIN,
      reason: "队伍获胜",
      key: `g${state.game}:win:${p}`,
    })),
  };
}

function passTurn(state: WordGridState, ctx: GameContext): GameResult<WordGridState> {
  state.turn = state.turn === 0 ? 1 : 0;
  state.clue = null;
  state.guessesLeft = 0;
  state.phase = "clue";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

export const wordGridGame = defineGame<WordGridState, Action, WordGridView, Config>({
  meta: {
    id: "wordgrid",
    name: "暗号网格",
    description: "两队对抗。队长用一个词加一个数字暗示队友：25 个词里哪几个是自己人——千万别碰到陷阱词。",
    minPlayers: 4,
    maxPlayers: 8,
    rulesSummary:
      "按加入顺序交替分成红蓝两队，每队一名队长（每局轮换）。桌上 25 个词：先手队 9 个、后手队 8 个、路人 7 个、陷阱 1 个，只有两位队长看得到归属。轮到的队长给出「一个词 + 一个数字」作为提示（数字表示有几个词与提示有关），队友商量后逐个点词，最多可以点「数字 + 1」个：点中自己队的词可以继续，点中路人或对方的词则回合结束，点中陷阱词立即判负。先找齐自己全部词的队伍获胜。提示词不能是桌上的词；队长除了提示不要在语音里透露任何信息（系统无法监听）。",
    scoringSummary: `获胜队伍每人 +${POINTS_WIN} 分。`,
    options: [{ key: "games", label: "局数", min: 1, max: 5, default: 1 }, secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 4) return { ok: false, error: "至少需要 4 名玩家（每队 2 人）" };
    const state: WordGridState = {
      config,
      game: 1,
      step: 0,
      phase: "clue",
      teams: splitTeams(ctx.players),
      captains: ["", ""],
      words: [],
      owners: [],
      revealed: [],
      turn: 0,
      clue: null,
      guessesLeft: 0,
      log: [],
      winner: null,
      endedBy: null,
      deadlineAt: null,
    };
    deal(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    const team = teamOf(state.teams, me);
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
      if (state.phase !== "gameOver") return { ok: false, error: "这一局还没结束" };
      if (state.game >= state.config.games) {
        state.phase = "finished";
        state.step += 1;
        return { ok: true, state, finished: true };
      }
      state.game += 1;
      // Late joiners get a seat between games.
      const seated = new Set(state.teams.flat());
      for (const p of ctx.players) {
        if (!seated.has(p)) (state.teams[0].length <= state.teams[1].length ? state.teams[0] : state.teams[1]).push(p);
      }
      deal(state, ctx);
      return { ok: true, state };
    }
    if (team === null) return { ok: false, error: "你将从下一局开始参与" };
    if (team !== state.turn) return { ok: false, error: "现在是对方的回合" };
    const isCaptain = state.captains[team] === me;
    switch (action.type) {
      case "clue": {
        if (state.phase !== "clue") return { ok: false, error: "提示已经给出了" };
        if (!isCaptain) return { ok: false, error: "只有队长可以给提示" };
        if (state.words.some((w, i) => !state.revealed[i] && (w.includes(action.word) || action.word.includes(w)))) {
          return { ok: false, error: "提示不能包含桌上还没翻开的词" };
        }
        state.clue = { word: action.word, count: action.count };
        state.guessesLeft = action.count + 1;
        state.log.push({ team, word: action.word, count: action.count, picks: [] });
        state.phase = "guess";
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "guess": {
        if (state.phase !== "guess") return { ok: false, error: "等队长先给提示" };
        if (isCaptain) return { ok: false, error: "队长不能点词" };
        if (state.revealed[action.index]) return { ok: false, error: "这个词已经翻开了" };
        state.revealed[action.index] = true;
        state.log.at(-1)?.picks.push(action.index);
        const owner = state.owners[action.index] as Owner;
        const other: TeamId = team === 0 ? 1 : 0;
        if (owner === "trap") return win(state, other, "trap");
        if (remaining(state, team) === 0) return win(state, team, "all-found");
        if (remaining(state, other) === 0) return win(state, other, "all-found");
        state.guessesLeft -= 1;
        if (owner !== team || state.guessesLeft === 0) return passTurn(state, ctx);
        state.step += 1;
        state.deadlineAt = timer(state.config.turnSeconds, ctx);
        return { ok: true, state };
      }
      case "stop": {
        if (state.phase !== "guess") return { ok: false, error: "现在不能结束回合" };
        if (isCaptain) return { ok: false, error: "由队友决定是否停手" };
        if ((state.log.at(-1)?.picks.length ?? 0) === 0) return { ok: false, error: "至少要点一个词" };
        return passTurn(state, ctx);
      }
    }
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "clue" || state.phase === "guess" ? state.deadlineAt : null),
  // Running out of time simply hands the turn over.
  onTimeout: (state, ctx) =>
    state.phase === "clue" || state.phase === "guess" ? passTurn(state, ctx) : { ok: true, state },
  onResume(state, ctx) {
    if (state.phase === "clue" || state.phase === "guess") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const { config, owners, ...rest } = state;
    const team = teamOf(state.teams, viewer);
    const isCaptain = state.captains.includes(viewer);
    const open = isCaptain || state.phase === "gameOver" || state.phase === "finished";
    return {
      ...rest,
      totalGames: config.games,
      myTeam: team,
      isCaptain,
      owners: owners.map((o, i) => (open || state.revealed[i] ? o : null)),
      remaining: [remaining(state, 0), remaining(state, 1)],
    };
  },

  publicSummary(state) {
    const open = state.words.filter((_, i) => state.revealed[i]).join("、") || "无";
    const clue = state.clue ? `当前提示「${state.clue.word} ${state.clue.count}」` : "等待队长给提示";
    return `暗号网格 第 ${state.game} 局，${state.turn === 0 ? "红队" : "蓝队"}回合，${clue}。已翻开：${open}。剩余 红 ${remaining(state, 0)} / 蓝 ${remaining(state, 1)}（未翻开的词归属未公开）${state.winner !== null ? `。${state.winner === 0 ? "红队" : "蓝队"}获胜` : ""}`;
  },
});
