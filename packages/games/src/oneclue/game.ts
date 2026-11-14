/**
 * 「不撞词」— cooperative word guessing. Everyone but the guesser sees a secret word and writes
 * one clue; identical clues cancel out; the guesser gets one try. Rule spec: docs/games/oneclue.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { drawPayload, norm, roundsOption, secondsOption, timer } from "../util.ts";

export const CLUE_WORD_MAX = 10;
export const POINTS_TEAM_CORRECT = 1;

const payload = z.object({ word: z.string() });
/** Payload shape of this game's content type (used to validate imported and generated content). */
export const oneclueContentSchema = payload;
const configSchema = z.object({
  rounds: z.number().int().min(0).max(30).default(6),
  clueSeconds: z.number().int().min(0).max(600).default(60),
  guessSeconds: z.number().int().min(0).max(600).default(60),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clue"), step: z.number().int(), text: z.string().trim().min(1).max(CLUE_WORD_MAX) }),
  z.object({ type: z.literal("guess"), step: z.number().int(), text: z.string().trim().min(1).max(20) }),
  /** Guesser: give up this word. */
  z.object({ type: z.literal("pass"), step: z.number().int() }),
  /** Host ruling after the reveal: accept the guess as correct (synonym, typo). */
  z.object({ type: z.literal("accept"), step: z.number().int() }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface OneClueState {
  config: Config;
  round: number;
  step: number;
  phase: "clue" | "guess" | "reveal" | "finished";
  participants: PlayerId[];
  guesser: PlayerId;
  turns: Record<PlayerId, number>;
  word: { contentId: string; text: string };
  clues: Record<PlayerId, string>;
  /** Authors whose clue collided with someone else's and was removed. */
  cancelled: PlayerId[];
  guess: string | null;
  correct: boolean | null;
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | null;
}

export interface OneClueView {
  round: number;
  totalRounds: number;
  step: number;
  phase: OneClueState["phase"];
  participants: PlayerId[];
  guesser: PlayerId;
  /** Hidden from the guesser until the reveal. */
  word: string | null;
  submitted: PlayerId[];
  myClue: string | null;
  /**
   * Clue givers see every clue once all are in; the guesser only ever sees the surviving ones
   * (cancelled clues come without text) until the reveal.
   */
  clues: { playerId: PlayerId; text: string | null; cancelled: boolean }[] | null;
  guess: string | null;
  correct: boolean | null;
  deadlineAt: number | null;
}

const givers = (state: OneClueState) => state.participants.filter((p) => p !== state.guesser);

function startRound(state: OneClueState, word: OneClueState["word"], ctx: GameContext) {
  state.phase = "clue";
  state.step += 1;
  state.participants = [...ctx.players];
  let guesser = state.participants[0] as PlayerId;
  for (const p of state.participants) if ((state.turns[p] ?? 0) < (state.turns[guesser] ?? 0)) guesser = p;
  state.turns[guesser] = (state.turns[guesser] ?? 0) + 1;
  state.guesser = guesser;
  state.word = word;
  state.clues = {};
  state.cancelled = [];
  state.guess = null;
  state.correct = null;
  state.deadlineAt = timer(state.config.clueSeconds, ctx);
}

function beginGuess(state: OneClueState, ctx: GameContext): GameResult<OneClueState> {
  const seen = new Map<string, PlayerId[]>();
  for (const [author, text] of Object.entries(state.clues)) {
    seen.set(norm(text), [...(seen.get(norm(text)) ?? []), author]);
  }
  state.cancelled = [...seen.values()].filter((authors) => authors.length > 1).flat();
  state.phase = "guess";
  state.step += 1;
  state.deadlineAt = timer(state.config.guessSeconds, ctx);
  return { ok: true, state };
}

function teamAward(state: OneClueState): ScoreAward[] {
  return state.participants.map((p) => ({
    playerId: p,
    points: POINTS_TEAM_CORRECT,
    reason: "团队猜中",
    key: `r${state.round}:team:${p}`,
  }));
}

function settle(state: OneClueState, guess: string | null): GameResult<OneClueState> {
  state.guess = guess;
  state.correct = guess !== null && norm(guess) === norm(state.word.text);
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state, scores: state.correct ? teamAward(state) : [] };
}

function advance(state: OneClueState, ctx: GameContext): GameResult<OneClueState> {
  const end = (why: OneClueState["endedBecause"]): GameResult<OneClueState> => {
    state.phase = "finished";
    state.step += 1;
    state.endedBecause = why;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  };
  if (state.config.rounds > 0 && state.round >= state.config.rounds) return end("rounds");
  if (ctx.players.length < 3) return end("rounds");
  const drawn = drawPayload(ctx, payload);
  if (!drawn) return end("no-content");
  state.round += 1;
  startRound(state, { contentId: drawn.contentId, text: drawn.data.word }, ctx);
  return { ok: true, state };
}

export const oneClueGame = defineGame<OneClueState, Action, OneClueView, Config>({
  meta: {
    id: "oneclue",
    name: "不撞词",
    description: "合作猜词：每人给猜词者写一个词作线索，但和别人撞了的线索会被划掉。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "猜词者轮流担任，看不到目标词。其他人各写一个线索词（最多 10 字，不能包含目标词），互相看不到。全部提交后，内容相同的线索全部作废；猜词者只能看到剩下的线索，只有一次机会猜词，也可以放弃。猜的词与目标词意思相同但写法不同时，房主可以判为正确。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `团队计分：猜中则本轮所有人 +${POINTS_TEAM_CORRECT} 分；猜错或放弃不得分。`,
    contentType: "guess-word",
    options: [
      roundsOption(6),
      secondsOption("clueSeconds", "写线索时限", 60),
      secondsOption("guessSeconds", "猜词时限", 60),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const drawn = drawPayload(ctx, payload);
    if (!drawn) return { ok: false, error: "题库中没有可用的词语" };
    const state: OneClueState = {
      config,
      round: 1,
      step: 0,
      phase: "clue",
      participants: [],
      guesser: "",
      turns: {},
      word: { contentId: "", text: "" },
      clues: {},
      cancelled: [],
      guess: null,
      correct: null,
      deadlineAt: null,
      endedBecause: null,
    };
    startRound(state, { contentId: drawn.contentId, text: drawn.data.word }, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    const me = actor.playerId;
    switch (action.type) {
      case "clue": {
        if (state.phase !== "clue") return { ok: false, error: "现在不是写线索的阶段" };
        if (!givers(state).includes(me))
          return { ok: false, error: me === state.guesser ? "猜词者不能写线索" : "你将从下一轮开始参与" };
        if (me in state.clues) return { ok: false, error: "你已经提交过了" };
        const clue = norm(action.text);
        const target = norm(state.word.text);
        if (!clue) return { ok: false, error: "请输入一个词" };
        if (clue.includes(target) || target.includes(clue))
          return { ok: false, error: "线索不能包含目标词（或它的一部分）" };
        state.clues[me] = action.text;
        return givers(state).every((p) => p in state.clues) ? beginGuess(state, ctx) : { ok: true, state };
      }
      case "guess": {
        if (state.phase !== "guess") return { ok: false, error: "现在不是猜词阶段" };
        if (me !== state.guesser) return { ok: false, error: "只有猜词者可以猜" };
        return settle(state, action.text);
      }
      case "pass": {
        if (state.phase !== "guess") return { ok: false, error: "现在不是猜词阶段" };
        if (me !== state.guesser) return { ok: false, error: "只有猜词者可以放弃" };
        return settle(state, null);
      }
      case "accept": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以改判" };
        if (state.phase !== "reveal" || state.correct || state.guess === null)
          return { ok: false, error: "现在没有可以改判的猜测" };
        state.correct = true;
        state.step += 1;
        return { ok: true, state, scores: teamAward(state) };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        if (state.phase === "clue") return beginGuess(state, ctx);
        if (state.phase === "guess") return settle(state, null);
        return advance(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "clue" || state.phase === "guess" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  // Exposed only after the reveal: the content id identifies the secret word.
  currentContentId: (state) => (state.phase === "reveal" ? state.word.contentId : null),
  atSafePoint: (state) => state.phase === "reveal",
  deadline: (state) => (state.phase === "clue" || state.phase === "guess" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "clue") return beginGuess(state, ctx);
    if (state.phase === "guess") return settle(state, null);
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "clue") state.deadlineAt = timer(state.config.clueSeconds, ctx);
    if (state.phase === "guess") state.deadlineAt = timer(state.config.guessSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const revealed = state.phase === "reveal" || state.phase === "finished";
    const isGuesser = viewer === state.guesser;
    const knowsWord = revealed || (!isGuesser && state.participants.includes(viewer));
    const cluesOpen = state.phase !== "clue";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      participants: state.participants,
      guesser: state.guesser,
      word: knowsWord ? state.word.text : null,
      submitted: Object.keys(state.clues),
      myClue: state.clues[viewer] ?? null,
      clues: cluesOpen
        ? Object.entries(state.clues).map(([playerId, text]) => {
            const cancelled = state.cancelled.includes(playerId);
            // Before the reveal only people who know the word may read cancelled clues.
            return { playerId, text: cancelled && !knowsWord ? null : text, cancelled };
          })
        : null,
      guess: state.guess,
      correct: state.correct,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const base = `不撞词 第 ${state.round} 轮，阶段：${state.phase}`;
    if (state.phase === "reveal" || state.phase === "finished") {
      return `${base}，目标词「${state.word.text}」，${state.correct ? "猜中" : "没猜中"}（已揭晓）`;
    }
    return `${base}（目标词与线索未公开，猜词者不能看到目标词）`;
  },
});
