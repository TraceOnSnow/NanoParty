/**
 * 「四叶联想」— cooperative. Everyone gets four two-word cards laid in a ring and writes one clue
 * for each pair of neighbouring words. Then the group rebuilds each ring from the clues alone,
 * with a decoy card mixed in. Rule spec: docs/games/clover.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";
import { dealWords } from "../words.ts";

export const SLOTS = 4;
export const CLOVER_PERFECT = 6;

const configSchema = z.object({ writeSeconds: z.number().int().min(0).max(900).default(0) });
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("clues"),
    step: z.number().int(),
    clues: z.array(z.string().trim().min(1).max(12)).length(SLOTS),
  }),
  /** Put a tray card into a slot (card = null empties the slot). */
  z.object({
    type: z.literal("place"),
    step: z.number().int(),
    slot: z
      .number()
      .int()
      .min(0)
      .max(SLOTS - 1),
    card: z.number().int().min(0).max(SLOTS).nullable(),
    flipped: z.boolean().default(false),
  }),
  z.object({ type: z.literal("submit"), step: z.number().int() }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

type Words = [string, string];
interface Board {
  /** Ring order. Clue k links cards[k][1] with cards[(k + 1) % 4][0]. */
  cards: Words[];
  decoy: Words;
  clues: string[] | null;
}
interface TrayCard {
  id: number;
  /** As shown to the solvers (possibly turned round). */
  words: Words;
}
interface Solve {
  author: PlayerId;
  tray: TrayCard[];
  /** Secret: for each tray id, its true slot (-1 = decoy) and whether it is shown turned round. */
  truth: { slot: number; turned: boolean }[];
  slots: ({ card: number; flipped: boolean } | null)[];
  locked: boolean[];
  attempt: 1 | 2;
  points: number | null;
}

export interface CloverState {
  config: Config;
  step: number;
  phase: "write" | "solve" | "result" | "finished";
  participants: PlayerId[];
  boards: Record<PlayerId, Board>;
  queue: PlayerId[];
  solve: Solve | null;
  total: number;
  deadlineAt: number | null;
}

export interface CloverView {
  step: number;
  phase: CloverState["phase"];
  participants: PlayerId[];
  /** Write phase: your own ring and whether you have submitted. */
  myCards: Words[] | null;
  myClues: string[] | null;
  submitted: PlayerId[];
  boardsLeft: number;
  solve: {
    author: PlayerId;
    clues: string[];
    tray: TrayCard[];
    slots: Solve["slots"];
    locked: boolean[];
    attempt: 1 | 2;
    points: number | null;
    /** The right answer, once this ring is settled: the words of each slot in order. */
    answer: Words[] | null;
  } | null;
  total: number;
  deadlineAt: number | null;
}

const correct = (s: Solve, k: number) => {
  const placed = s.slots[k];
  if (!placed) return false;
  const truth = s.truth[placed.card] as { slot: number; turned: boolean };
  return truth.slot === k && placed.flipped === truth.turned;
};

function openSolve(state: CloverState, ctx: GameContext): GameResult<CloverState> {
  const author = state.queue.shift();
  if (!author) {
    state.phase = "finished";
    state.step += 1;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  }
  const board = state.boards[author] as Board;
  const entries = shuffle(
    [...board.cards.map((words, slot) => ({ words, slot })), { words: board.decoy, slot: -1 }],
    ctx.random,
  );
  const turned = entries.map(() => ctx.random() < 0.5);
  state.solve = {
    author,
    tray: entries.map((e, id) => ({ id, words: turned[id] ? [e.words[1], e.words[0]] : e.words })),
    truth: entries.map((e, id) => ({ slot: e.slot, turned: turned[id] as boolean })),
    slots: Array(SLOTS).fill(null),
    locked: Array(SLOTS).fill(false),
    attempt: 1,
    points: null,
  };
  state.phase = "solve";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

function toSolving(state: CloverState, ctx: GameContext): GameResult<CloverState> {
  state.queue = state.participants.filter((p) => state.boards[p]?.clues);
  return openSolve(state, ctx);
}

function settle(state: CloverState, s: Solve, points: number): GameResult<CloverState> {
  s.points = points;
  state.total += points;
  state.phase = "result";
  state.step += 1;
  const scores: ScoreAward[] =
    points === 0
      ? []
      : state.participants.map((p) => ({
          playerId: p,
          points,
          reason: `还原了 ${s.author === p ? "自己" : "队友"}的四叶`,
          key: `board:${s.author}:${p}`,
        }));
  return { ok: true, state, scores };
}

export const cloverGame = defineGame<CloverState, Action, CloverView, Config>({
  meta: {
    id: "clover",
    name: "四叶联想",
    description: "合作游戏。给相邻的两个词各写一条提示，然后大家只凭提示把彼此的卡片摆回原位——还混进了一张干扰卡。",
    minPlayers: 3,
    maxPlayers: 6,
    rulesSummary: `全员合作。每人拿到围成一圈的 4 张卡，每张卡有两个词；相邻两张卡挨着的两个词组成一对，共 4 对。每人为每一对写一条提示（一个词，不能包含自己卡上的词）。全部写完后，依次还原每个人的四叶：这 4 张卡加 1 张干扰卡被打乱（方向也可能被调转），作者以外的人商量着把卡放回 4 个位置并调好方向，作者不能出声提示。第一次提交全对得 ${CLOVER_PERFECT} 分；否则放对的保留、放错的退回，再试一次，最后每放对一张得 1 分。`,
    scoringSummary: "团队得分：每还原一份四叶，所有人获得同样的分数。",
    options: [secondsOption("writeSeconds", "写提示时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const words = dealWords(ctx.players.length * 10, ctx.random);
    const pair = (): Words => [words.pop() as string, words.pop() as string];
    const state: CloverState = {
      config,
      step: 1,
      phase: "write",
      participants: [...ctx.players],
      boards: Object.fromEntries(
        ctx.players.map((p) => [p, { cards: [pair(), pair(), pair(), pair()], decoy: pair(), clues: null }]),
      ),
      queue: [],
      solve: null,
      total: 0,
      deadlineAt: timer(config.writeSeconds, ctx),
    };
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (action.type === "advance") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
      if (state.phase === "write") {
        if (!state.participants.some((p) => state.boards[p]?.clues)) return { ok: false, error: "还没有人写完提示" };
        return toSolving(state, ctx);
      }
      if (state.phase === "result") return openSolve(state, ctx);
      return { ok: false, error: "先完成这一份的还原" };
    }
    if (!state.participants.includes(me)) return { ok: false, error: "这一局已经开始，下一局再加入" };
    if (action.type === "clues") {
      if (state.phase !== "write") return { ok: false, error: "写提示的时间已经结束" };
      const board = state.boards[me] as Board;
      if (board.clues) return { ok: false, error: "你已经提交过了" };
      const mine = board.cards.flat();
      if (action.clues.some((c) => mine.some((w) => c.includes(w)))) {
        return { ok: false, error: "提示里不能出现自己卡上的词" };
      }
      board.clues = action.clues;
      return state.participants.every((p) => state.boards[p]?.clues) ? toSolving(state, ctx) : { ok: true, state };
    }
    const s = state.solve;
    if (state.phase !== "solve" || !s) return { ok: false, error: "现在不是还原阶段" };
    if (me === s.author) return { ok: false, error: "这是你的四叶，交给队友来还原" };
    if (action.type === "place") {
      if (s.locked[action.slot]) return { ok: false, error: "这个位置已经放对了" };
      if (action.card !== null) {
        const at = s.slots.findIndex((x) => x?.card === action.card);
        if (at >= 0 && s.locked[at]) return { ok: false, error: "这张卡已经放对了" };
        if (at >= 0) s.slots[at] = null;
      }
      s.slots[action.slot] = action.card === null ? null : { card: action.card, flipped: action.flipped };
      return { ok: true, state };
    }
    if (s.slots.some((x) => x === null)) return { ok: false, error: "四个位置都要放上卡" };
    const right = s.slots.map((_, k) => correct(s, k));
    const count = right.filter(Boolean).length;
    if (s.attempt === 1 && count === SLOTS) return settle(state, s, CLOVER_PERFECT);
    if (s.attempt === 2) return settle(state, s, count);
    s.attempt = 2;
    s.locked = right;
    s.slots = s.slots.map((x, k) => (right[k] ? x : null));
    state.step += 1;
    return { ok: true, state };
  },

  atSafePoint: (state) => state.phase === "result",
  deadline: (state) => (state.phase === "write" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase !== "write") return { ok: true, state };
    // Rings without clues are left out; with none at all the game just ends.
    return toSolving(state, ctx);
  },
  onResume(state, ctx) {
    if (state.phase === "write") state.deadlineAt = timer(state.config.writeSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const board = state.boards[viewer];
    const s = state.solve;
    const settled = state.phase === "result" || state.phase === "finished";
    return {
      step: state.step,
      phase: state.phase,
      participants: state.participants,
      myCards: state.phase === "write" && board ? board.cards : null,
      myClues: state.phase === "write" ? (board?.clues ?? null) : null,
      submitted: state.participants.filter((p) => state.boards[p]?.clues),
      boardsLeft: state.queue.length,
      solve:
        s && state.phase !== "write"
          ? {
              author: s.author,
              clues: (state.boards[s.author] as Board).clues as string[],
              tray: s.tray,
              slots: s.slots,
              locked: s.locked,
              attempt: s.attempt,
              points: s.points,
              answer: settled ? (state.boards[s.author] as Board).cards : null,
            }
          : null,
      total: state.total,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    if (state.phase === "write") {
      return `四叶联想：大家正在写提示（${state.participants.filter((p) => state.boards[p]?.clues).length}/${state.participants.length}），内容未公开`;
    }
    const s = state.solve;
    const clues = s ? ((state.boards[s.author] as Board).clues ?? []).join(" / ") : "";
    return `四叶联想：正在还原一份四叶，提示：${clues}；第 ${s?.attempt ?? 1} 次尝试${s?.points != null ? `，得 ${s.points} 分` : "（正确摆法未公开）"}。团队累计 ${state.total} 分，还剩 ${state.queue.length} 份`;
  },
});
