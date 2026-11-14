/**
 * 「拒牌筹码」— pay a chip to refuse the card on offer, or take it with the chips on it.
 * Runs of consecutive cards only count their lowest value. Lowest total wins.
 * Pure rules; no content, no AI. Rule spec: docs/games/nothanks.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const LOW = 3;
export const HIGH = 35;
export const REMOVED = 9;
const POINTS_WIN = 3;
export const startingChips = (players: number) => (players <= 5 ? 11 : players === 6 ? 9 : 7);

const configSchema = z.object({
  games: z.number().int().min(1).max(5).default(1),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("take"), step: z.number().int() }),
  z.object({ type: z.literal("pass"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface NoThanksState {
  config: Config;
  game: number;
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: PlayerId[];
  deck: number[];
  card: number | null;
  pot: number;
  current: PlayerId;
  cards: Record<PlayerId, number[]>;
  /** Chip counts are secret until the end. */
  chips: Record<PlayerId, number>;
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface NoThanksView {
  game: number;
  totalGames: number;
  step: number;
  phase: NoThanksState["phase"];
  players: PlayerId[];
  card: number | null;
  pot: number;
  deckLeft: number;
  current: PlayerId;
  cards: Record<PlayerId, number[]>;
  myChips: number | null;
  /** Everyone's chips and scores, only once the game is over. */
  final: { chips: Record<PlayerId, number>; scores: Record<PlayerId, number> } | null;
  winners: PlayerId[];
  deadlineAt: number | null;
}

/** Card points: only the lowest card of each run of consecutive values counts. */
export function cardPoints(cards: number[]): number {
  const sorted = [...cards].sort((a, b) => a - b);
  return sorted.reduce((sum, c, i) => (i > 0 && c === (sorted[i - 1] as number) + 1 ? sum : sum + c), 0);
}
export const totalScore = (state: NoThanksState, p: PlayerId) =>
  cardPoints(state.cards[p] ?? []) - (state.chips[p] ?? 0);

function deal(state: NoThanksState, ctx: GameContext) {
  state.players = [...ctx.players];
  const deck = shuffle(
    Array.from({ length: HIGH - LOW + 1 }, (_, i) => i + LOW),
    ctx.random,
  ).slice(REMOVED);
  state.card = deck.shift() ?? null;
  state.deck = deck;
  state.pot = 0;
  state.cards = Object.fromEntries(state.players.map((p) => [p, []]));
  state.chips = Object.fromEntries(state.players.map((p) => [p, startingChips(state.players.length)]));
  state.current = state.players[(state.game - 1) % state.players.length] as PlayerId;
  state.winners = [];
  state.phase = "play";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
}

function take(state: NoThanksState, p: PlayerId, ctx: GameContext): GameResult<NoThanksState> {
  (state.cards[p] as number[]).push(state.card as number);
  state.chips[p] = (state.chips[p] ?? 0) + state.pot;
  state.pot = 0;
  state.step += 1;
  state.card = state.deck.shift() ?? null;
  if (state.card !== null) {
    // The taker faces the next card.
    state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return { ok: true, state };
  }
  state.phase = "gameOver";
  state.deadlineAt = null;
  const best = Math.min(...state.players.map((q) => totalScore(state, q)));
  state.winners = state.players.filter((q) => totalScore(state, q) === best);
  const scores: ScoreAward[] = state.winners.map((q) => ({
    playerId: q,
    points: POINTS_WIN,
    reason: "总分最低",
    key: `g${state.game}:win:${q}`,
  }));
  return { ok: true, state, scores };
}

function pass(state: NoThanksState, p: PlayerId, ctx: GameContext): GameResult<NoThanksState> {
  state.chips[p] = (state.chips[p] ?? 0) - 1;
  state.pot += 1;
  state.current = state.players[(state.players.indexOf(p) + 1) % state.players.length] as PlayerId;
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

export const noThanksGame = defineGame<NoThanksState, Action, NoThanksView, Config>({
  meta: {
    id: "nothanks",
    name: "拒牌筹码",
    description: "每张牌都是负分。花一个筹码拒绝它，或者收下它连同上面的筹码——规则一句话，纠结一整局。",
    minPlayers: 3,
    maxPlayers: 7,
    rulesSummary: `牌是 ${LOW}–${HIGH}，洗好后随机拿走 ${REMOVED} 张不用（谁也不知道是哪些）。每人有若干筹码（3–5 人 11 个，6 人 9 个，7 人 7 个），数量对别人保密。轮到你时，翻开的牌要么收下（连同牌上所有筹码），要么放一个筹码在牌上拒绝它，轮到下一个人；没有筹码只能收下。收下牌的人接着面对下一张。牌发完时结算：你的牌点数相加，但连号的一串只算最小的那张，再减去手里的筹码。`,
    scoringSummary: `总分最低的玩家 +${POINTS_WIN} 分（并列都得）。`,
    options: [{ key: "games", label: "局数", min: 1, max: 5, default: 1 }, secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3 || ctx.players.length > 7) return { ok: false, error: "需要 3–7 名玩家" };
    const state: NoThanksState = {
      config,
      game: 1,
      step: 0,
      phase: "play",
      players: [],
      deck: [],
      card: null,
      pot: 0,
      current: "",
      cards: {},
      chips: {},
      winners: [],
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
    switch (action.type) {
      case "take":
      case "pass": {
        if (state.phase !== "play") return { ok: false, error: "这一局已经结束" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (action.type === "take") return take(state, me, ctx);
        if ((state.chips[me] ?? 0) <= 0) return { ok: false, error: "你没有筹码了，只能收下" };
        return pass(state, me, ctx);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (state.phase !== "gameOver") return { ok: false, error: "这一局还没结束" };
        if (state.game >= state.config.games || ctx.players.length < 3 || ctx.players.length > 7) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.game += 1;
        deal(state, ctx);
        return { ok: true, state };
      }
    }
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  // An absent player refuses while they can afford it.
  onTimeout: (state, ctx) =>
    state.phase !== "play"
      ? { ok: true, state }
      : (state.chips[state.current] ?? 0) > 0
        ? pass(state, state.current, ctx)
        : take(state, state.current, ctx),
  onResume(state, ctx) {
    if (state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const over = state.phase !== "play";
    return {
      game: state.game,
      totalGames: state.config.games,
      step: state.step,
      phase: state.phase,
      players: state.players,
      card: state.card,
      pot: state.pot,
      deckLeft: state.deck.length,
      current: state.current,
      cards: state.cards,
      myChips: state.chips[viewer] ?? null,
      final: over
        ? { chips: state.chips, scores: Object.fromEntries(state.players.map((p) => [p, totalScore(state, p)])) }
        : null,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    return `拒牌筹码 第 ${state.game} 局，当前牌 ${state.card ?? "无"}（牌上 ${state.pot} 个筹码），剩 ${state.deck.length} 张，阶段：${state.phase}（各人筹码数未公开）`;
  },
});
