/**
 * 「谁最可能」— everyone votes for the friend who best fits a situation. Almost no typing.
 * Rule spec: docs/games/mostlikely.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { drawPayload, groupVotes, roundsOption, secondsOption, timer } from "../util.ts";

const payload = z.object({ text: z.string() });
const configSchema = z.object({
  rounds: z.number().int().min(0).max(30).default(8),
  voteSeconds: z.number().int().min(0).max(600).default(45),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("vote"), step: z.number().int(), target: z.string() }),
  z.object({ type: z.literal("reveal"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface MostLikelyState {
  config: Config;
  round: number;
  step: number;
  phase: "vote" | "reveal" | "finished";
  participants: PlayerId[];
  prompt: { contentId: string; text: string };
  votes: Record<PlayerId, PlayerId>;
  top: PlayerId[];
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface MostLikelyView {
  round: number;
  totalRounds: number;
  step: number;
  phase: MostLikelyState["phase"];
  participants: PlayerId[];
  prompt: string;
  submitted: PlayerId[];
  myVote: PlayerId | null;
  deadlineAt: number | null;
  /** Who voted for whom, and who got the most votes. Only after the reveal. */
  reveal: { votes: Record<PlayerId, PlayerId>; top: PlayerId[] } | null;
}

function startRound(state: MostLikelyState, prompt: MostLikelyState["prompt"], ctx: GameContext) {
  state.phase = "vote";
  state.step += 1;
  state.participants = [...ctx.players];
  state.prompt = prompt;
  state.votes = {};
  state.top = [];
  state.deadlineAt = timer(state.config.voteSeconds, ctx);
}

function settle(state: MostLikelyState): GameResult<MostLikelyState> {
  const groups = groupVotes(state.votes);
  const max = Math.max(0, ...[...groups.values()].map((v) => v.length));
  state.top = [...groups.entries()].filter(([, v]) => v.length === max).map(([p]) => p);
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  // Reading the room is what scores: voters who picked (one of) the most-voted player(s).
  const scores: ScoreAward[] = Object.entries(state.votes)
    .filter(([, target]) => state.top.includes(target))
    .map(([voter]) => ({
      playerId: voter,
      points: 1,
      reason: "和大家想的一样",
      key: `r${state.round}:match:${voter}`,
    }));
  return { ok: true, state, scores };
}

function advance(state: MostLikelyState, ctx: GameContext): GameResult<MostLikelyState> {
  const end = (why: MostLikelyState["endedBecause"]): GameResult<MostLikelyState> => {
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
  startRound(state, { contentId: drawn.contentId, text: drawn.data.text }, ctx);
  return { ok: true, state };
}

export const mostLikelyGame = defineGame<MostLikelyState, Action, MostLikelyView, Config>({
  meta: {
    id: "mostlikely",
    name: "谁最可能",
    description: "「谁最可能……」每人投给最符合情境的那位朋友，看看大家想的是不是一样。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮出现一个「谁最可能……」的情境。每人秘密投票给在场的一位玩家（可以投自己），全部投完后公开谁投了谁。中途加入的玩家从下一轮开始参与。",
    scoringSummary: "投给得票最多的人（并列都算）的玩家各 +1 分。被跳过的题不计分。",
    contentType: "who-prompt",
    options: [roundsOption(8), secondsOption("voteSeconds", "投票时限", 45)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const drawn = drawPayload(ctx, payload);
    if (!drawn) return { ok: false, error: "题库中没有可用的题目" };
    const state: MostLikelyState = {
      config,
      round: 1,
      step: 0,
      phase: "vote",
      participants: [],
      prompt: { contentId: "", text: "" },
      votes: {},
      top: [],
      deadlineAt: null,
      endedBecause: null,
    };
    startRound(state, { contentId: drawn.contentId, text: drawn.data.text }, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    switch (action.type) {
      case "vote": {
        if (state.phase !== "vote") return { ok: false, error: "现在不是投票阶段" };
        if (!state.participants.includes(actor.playerId)) return { ok: false, error: "你将从下一轮开始参与" };
        if (actor.playerId in state.votes) return { ok: false, error: "你已经投过票了" };
        if (!state.participants.includes(action.target)) return { ok: false, error: "只能投给本轮的玩家" };
        state.votes[actor.playerId] = action.target;
        return state.participants.every((p) => p in state.votes) ? settle(state) : { ok: true, state };
      }
      case "reveal": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以提前揭晓" };
        if (state.phase !== "vote") return { ok: false, error: "现在不是投票阶段" };
        return settle(state);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以进入下一轮" };
        if (state.phase !== "reveal") return { ok: false, error: "当前回合尚未揭晓" };
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "vote" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "finished" ? null : state.prompt.contentId),
  deadline: (state) => (state.phase === "vote" ? state.deadlineAt : null),
  onTimeout: (state) => (state.phase === "vote" ? settle(state) : { ok: true, state }),
  onResume(state, ctx) {
    if (state.phase === "vote") state.deadlineAt = timer(state.config.voteSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase !== "vote";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      participants: state.participants,
      prompt: state.prompt.text,
      submitted: Object.keys(state.votes),
      myVote: state.votes[viewer] ?? null,
      deadlineAt: state.deadlineAt,
      reveal: revealed ? { votes: state.votes, top: state.top } : null,
    };
  },

  publicSummary(state) {
    const base = `谁最可能 第 ${state.round} 轮，题目：「${state.prompt.text}」`;
    return state.phase === "vote"
      ? `${base}，已投票 ${Object.keys(state.votes).length}/${state.participants.length} 人（投票内容未公开）`
      : `${base}，已揭晓`;
  },
});
