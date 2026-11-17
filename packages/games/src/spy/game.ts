/**
 * 「地点疑云」— everyone is told where they are, except one outsider. The table questions each
 * other by voice; the outsider tries to work out the place before being found.
 * The places are a fixed list in this file; no content bank, no AI. Rule spec: docs/games/spy.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { roundsOption, secondsOption, timer } from "../util.ts";

export const SPY_PLACES = [
  "医院",
  "学校",
  "机场",
  "电影院",
  "超市",
  "火锅店",
  "健身房",
  "图书馆",
  "网吧",
  "KTV",
  "游乐园",
  "动物园",
  "银行",
  "警察局",
  "地铁",
  "海滩",
  "滑雪场",
  "婚礼现场",
  "剧组片场",
  "太空站",
  "潜水艇",
  "邮轮",
  "马戏团",
  "寺庙",
  "大学宿舍",
  "驾校",
  "理发店",
  "博物馆",
  "演唱会",
  "电竞比赛现场",
];
const POINTS_SPY = 3;
const POINTS_TEAM = 1;
const POINTS_ACCUSER = 1;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;

const configSchema = z.object({
  rounds: z.number().int().min(0).max(30).default(3),
  talkSeconds: z.number().int().min(0).max(1800).default(360),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  /** Stop the talk and put a suspect to a yes/no vote. Each player may do this once a round. */
  z.object({ type: z.literal("accuse"), target: z.string(), step: z.number().int() }),
  z.object({ type: z.literal("vote"), yes: z.boolean(), step: z.number().int() }),
  /** The outsider names the place. Ends the round either way. */
  z.object({ type: z.literal("guess"), place: z.string(), step: z.number().int() }),
  /** Host: time to decide — everyone names a suspect. */
  z.object({ type: z.literal("endTalk"), step: z.number().int() }),
  z.object({ type: z.literal("final"), target: z.string(), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
  z.object({ type: z.literal("end"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SpyState {
  config: Config;
  round: number;
  step: number;
  phase: "talk" | "vote" | "final" | "roundOver" | "finished";
  players: PlayerId[];
  place: string;
  spy: PlayerId;
  /** Places already used in this game, so they do not repeat. */
  used: string[];
  /** Players who have used their accusation this round. */
  accused: PlayerId[];
  vote: { by: PlayerId; target: PlayerId; votes: Record<PlayerId, boolean> } | null;
  /** The last accusation that did not pass. */
  failed: { by: PlayerId; target: PlayerId; yes: number; no: number } | null;
  finalVotes: Record<PlayerId, PlayerId>;
  result: {
    winner: "spy" | "team";
    how: "accused" | "wrong-accused" | "guessed" | "wrong-guess" | "final" | "final-miss";
    target?: PlayerId;
    by?: PlayerId;
    guess?: string;
  } | null;
  deadlineAt: number | null;
}

export interface SpyView {
  round: number;
  totalRounds: number;
  step: number;
  phase: SpyState["phase"];
  players: PlayerId[];
  places: string[];
  /** Null for the outsider (and for anyone who joined mid-round). */
  place: string | null;
  iAmSpy: boolean;
  accused: PlayerId[];
  vote: { by: PlayerId; target: PlayerId; voted: PlayerId[]; myVote: boolean | null } | null;
  failed: SpyState["failed"];
  finalVoted: PlayerId[];
  myFinal: PlayerId | null;
  /** Shown once the round is over. */
  reveal: { spy: PlayerId; place: string; finalVotes: Record<PlayerId, PlayerId> } | null;
  result: SpyState["result"];
  deadlineAt: number | null;
}

function openRound(state: SpyState, ctx: GameContext) {
  state.round += 1;
  state.players = [...ctx.players];
  let free = SPY_PLACES.filter((p) => !state.used.includes(p));
  if (free.length === 0) {
    state.used = [];
    free = SPY_PLACES;
  }
  state.place = free[Math.floor(ctx.random() * free.length)] as string;
  state.used.push(state.place);
  state.spy = state.players[Math.floor(ctx.random() * state.players.length)] as PlayerId;
  state.accused = [];
  state.vote = null;
  state.failed = null;
  state.finalVotes = {};
  state.result = null;
  state.phase = "talk";
  state.step += 1;
  state.deadlineAt = timer(state.config.talkSeconds, ctx);
}

function close(state: SpyState, result: NonNullable<SpyState["result"]>): GameResult<SpyState> {
  state.result = result;
  state.vote = null;
  state.phase = "roundOver";
  state.step += 1;
  state.deadlineAt = null;
  const key = (p: PlayerId, what: string) => `r${state.round}:${what}:${p}`;
  const scores: ScoreAward[] =
    result.winner === "spy"
      ? [{ playerId: state.spy, points: POINTS_SPY, reason: "外人没被抓到", key: key(state.spy, "spy") }]
      : state.players
          .filter((p) => p !== state.spy)
          .map((p) => ({ playerId: p, points: POINTS_TEAM, reason: "抓到了外人", key: key(p, "team") }));
  if (result.winner === "team" && result.how === "accused" && result.by) {
    scores.push({ playerId: result.by, points: POINTS_ACCUSER, reason: "指认成功", key: key(result.by, "accuser") });
  }
  return { ok: true, state, scores };
}

function toFinal(state: SpyState): GameResult<SpyState> {
  state.vote = null;
  state.phase = "final";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

/** Everyone has named a suspect: a single most-named player is accused; a tie lets the outsider go. */
function countFinal(state: SpyState): GameResult<SpyState> {
  const tally = new Map<PlayerId, number>();
  for (const target of Object.values(state.finalVotes)) tally.set(target, (tally.get(target) ?? 0) + 1);
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally].filter(([, n]) => n === top).map(([p]) => p);
  if (leaders.length === 1 && leaders[0] === state.spy)
    return close(state, { winner: "team", how: "final", target: state.spy });
  return close(state, { winner: "spy", how: "final-miss", target: leaders.length === 1 ? leaders[0] : undefined });
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const spyGame = defineGame<SpyState, Action, SpyView, Config>({
  meta: {
    id: "spy",
    name: "地点疑云",
    description:
      "所有人都知道现在在哪——除了一个外人。大家在语音里互相提问，外人要装作知道并猜出地点，其他人要把他揪出来又不能把地点说漏。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `每轮从 ${SPY_PLACES.length} 个地点里随机一个，随机一人是外人：其他人的屏幕上写着地点，外人只看到「你是外人」。然后在语音里自由提问：点名问任何人一个和这个地点有关的问题，被问的人回答后接着问别人。问得太直白会把地点漏给外人，答得太含糊会被当成外人。任何人每轮可以发起一次指认：其他人投票，过半同意就翻开身份——是外人，大家赢；不是，外人赢。外人可以随时喊停猜地点：猜对外人赢，猜错大家赢。时间到（或房主点「开始最终指认」）后，每人指一个人，票数唯一最高的被翻开；平票算外人逃脱。`,
    scoringSummary: `外人赢：外人 +${POINTS_SPY}。其他人赢：每人 +${POINTS_TEAM}，发起成功指认的人再 +${POINTS_ACCUSER}。`,
    options: [roundsOption(3), secondsOption("talkSeconds", "每轮提问时间", 360)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: SpyState = {
      config,
      round: 0,
      step: 0,
      phase: "talk",
      players: [],
      place: "",
      spy: "",
      used: [],
      accused: [],
      vote: null,
      failed: null,
      finalVotes: {},
      result: null,
      deadlineAt: null,
    };
    openRound(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    const seated = state.players.includes(me);
    switch (action.type) {
      case "accuse": {
        if (state.phase !== "talk") return { ok: false, error: "现在不能发起指认" };
        if (!seated) return { ok: false, error: "下一轮再加入" };
        if (state.accused.includes(me)) return { ok: false, error: "这一轮你已经指认过一次了" };
        if (action.target === me || !state.players.includes(action.target))
          return { ok: false, error: "不能指认这位玩家" };
        state.accused.push(me);
        state.failed = null;
        // The accuser is counted as a yes; the accused does not vote.
        state.vote = { by: me, target: action.target, votes: { [me]: true } };
        state.phase = "vote";
        state.step += 1;
        return { ok: true, state };
      }
      case "vote": {
        if (state.phase !== "vote" || !state.vote) return { ok: false, error: "现在没有在投票" };
        const v = state.vote;
        if (!seated || me === v.target) return { ok: false, error: "你不参加这次投票" };
        if (v.votes[me] !== undefined) return { ok: false, error: "你已经投过了" };
        v.votes[me] = action.yes;
        const voters = state.players.filter((p) => p !== v.target);
        if (voters.some((p) => v.votes[p] === undefined)) return { ok: true, state };
        const yes = voters.filter((p) => v.votes[p]).length;
        if (yes * 2 > voters.length) {
          return close(
            state,
            v.target === state.spy
              ? { winner: "team", how: "accused", target: v.target, by: v.by }
              : { winner: "spy", how: "wrong-accused", target: v.target, by: v.by },
          );
        }
        state.failed = { by: v.by, target: v.target, yes, no: voters.length - yes };
        state.vote = null;
        state.phase = "talk";
        state.step += 1;
        return { ok: true, state };
      }
      case "guess": {
        if (state.phase !== "talk") return { ok: false, error: "现在不能猜地点" };
        if (me !== state.spy) return { ok: false, error: "只有外人可以猜地点" };
        if (!SPY_PLACES.includes(action.place)) return { ok: false, error: "没有这个地点" };
        return close(
          state,
          action.place === state.place
            ? { winner: "spy", how: "guessed", guess: action.place }
            : { winner: "team", how: "wrong-guess", guess: action.place },
        );
      }
      case "endTalk":
        if (!actor.isHost) return { ok: false, error: "只有房主可以结束提问" };
        if (state.phase !== "talk") return { ok: false, error: "现在不在提问阶段" };
        return toFinal(state);
      case "final": {
        if (state.phase !== "final") return { ok: false, error: "还没到最终指认" };
        if (!seated) return { ok: false, error: "下一轮再加入" };
        if (state.finalVotes[me]) return { ok: false, error: "你已经指过了" };
        if (action.target === me || !state.players.includes(action.target))
          return { ok: false, error: "不能指这位玩家" };
        state.finalVotes[me] = action.target;
        if (state.players.some((p) => !state.finalVotes[p])) return { ok: true, state };
        return countFinal(state);
      }
      case "next":
      case "end": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.phase !== "roundOver") return { ok: false, error: "这一轮还没结束" };
        const last = state.config.rounds > 0 && state.round >= state.config.rounds;
        if (action.type === "end" || last || !countOk(ctx.players.length)) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        openRound(state, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "roundOver",
  deadline: (state) => (state.phase === "talk" || state.phase === "vote" ? state.deadlineAt : null),
  // Time is up: drop any open accusation and move to the final vote.
  onTimeout: (state) => (state.phase === "talk" || state.phase === "vote" ? toFinal(state) : { ok: true, state }),
  onResume(state, ctx) {
    if (state.phase === "talk" || state.phase === "vote") state.deadlineAt = timer(state.config.talkSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const over = state.phase === "roundOver" || state.phase === "finished";
    const knows = state.players.includes(viewer) && viewer !== state.spy;
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      players: state.players,
      places: SPY_PLACES,
      place: knows || over ? state.place : null,
      iAmSpy: viewer === state.spy,
      accused: state.accused,
      vote: state.vote
        ? {
            by: state.vote.by,
            target: state.vote.target,
            voted: Object.keys(state.vote.votes),
            myVote: state.vote.votes[viewer] ?? null,
          }
        : null,
      failed: state.failed,
      finalVoted: Object.keys(state.finalVotes),
      myFinal: state.finalVotes[viewer] ?? null,
      reveal: over ? { spy: state.spy, place: state.place, finalVotes: state.finalVotes } : null,
      result: state.result,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const over = state.phase === "roundOver" || state.phase === "finished";
    return `地点疑云 第 ${state.round} 轮，阶段：${state.phase}${over ? `，地点「${state.place}」，外人是 ${state.spy}` : "（地点和外人未公开）"}`;
  },
});
