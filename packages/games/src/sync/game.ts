/**
 * 「心照不宣」— a cooperative game without turns. Everyone holds numbers from 1 to 100 and the
 * table must play them all in rising order without saying what anyone holds. Whoever feels
 * their lowest card is next simply plays it.
 * Pure rules; no content, no AI. Rule spec: docs/games/sync.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { shuffle } from "../util.ts";

const MAX_LIVES = 5;
const MAX_STARS = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
/** The fewer the players, the more levels: each level deals one more card to everyone. */
export const syncLevels = (players: number) => (players <= 2 ? 12 : players === 3 ? 10 : players === 4 ? 8 : 6);
export const syncLives = (players: number) => Math.min(MAX_LIVES, players);
/** Finishing these levels earns a star or a life. */
const REWARDS: Record<number, "star" | "life"> = { 2: "star", 3: "life", 5: "star", 6: "life", 8: "star", 9: "life" };

const configSchema = z.object({
  levels: z.number().int().min(0).max(12).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  /** There are no turns, so a play is tied to the deal and to the card itself, not to a step. */
  z.object({ type: z.literal("play"), card: z.number().int(), round: z.number().int() }),
  z.object({ type: z.literal("star"), on: z.boolean(), round: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SyncState {
  config: Config;
  level: number;
  totalLevels: number;
  /** Counts deals; plays are bound to it. */
  round: number;
  step: number;
  phase: "play" | "levelOver" | "won" | "lost" | "finished";
  players: PlayerId[];
  hands: Record<PlayerId, number[]>;
  pile: { card: number; by: PlayerId }[];
  lives: number;
  stars: number;
  starVotes: PlayerId[];
  /** The last thing that went wrong or was thrown away, for everyone to see. */
  shown: { kind: "mistake" | "star"; card?: number; by?: PlayerId; cards: { by: PlayerId; card: number }[] } | null;
  reward: "star" | "life" | null;
}

export interface SyncView {
  level: number;
  totalLevels: number;
  round: number;
  step: number;
  phase: SyncState["phase"];
  players: PlayerId[];
  myHand: number[] | null;
  /** How many cards each player still holds. */
  counts: Record<PlayerId, number>;
  /** Everyone's cards, only once the game is lost or won. */
  hands: Record<PlayerId, number[]> | null;
  pile: { card: number; by: PlayerId }[];
  lives: number;
  stars: number;
  starVotes: PlayerId[];
  shown: SyncState["shown"];
  reward: SyncState["reward"];
}

function deal(state: SyncState, ctx: GameContext) {
  state.players = [...ctx.players];
  const deck = shuffle(
    Array.from({ length: 100 }, (_, i) => i + 1),
    ctx.random,
  );
  state.hands = Object.fromEntries(state.players.map((p) => [p, deck.splice(0, state.level).sort((a, b) => a - b)]));
  state.pile = [];
  state.starVotes = [];
  state.shown = null;
  state.reward = null;
  state.phase = "play";
  state.round += 1;
  state.step += 1;
}

const holders = (state: SyncState) => state.players.filter((p) => (state.hands[p] ?? []).length > 0);

/** After cards left the hands: is the level done, and is that the last one? */
function afterPlay(state: SyncState): GameResult<SyncState> {
  state.step += 1;
  state.starVotes = state.starVotes.filter((p) => holders(state).includes(p));
  if (state.lives <= 0) {
    state.phase = "lost";
    return { ok: true, state };
  }
  if (holders(state).length > 0) return { ok: true, state };
  if (state.level >= state.totalLevels) {
    state.phase = "won";
    return { ok: true, state };
  }
  const reward = REWARDS[state.level] ?? null;
  if (reward === "life") state.lives = Math.min(MAX_LIVES, state.lives + 1);
  if (reward === "star") state.stars = Math.min(MAX_STARS, state.stars + 1);
  state.reward = reward;
  state.phase = "levelOver";
  return { ok: true, state };
}

function finish(state: SyncState): GameResult<SyncState> {
  const cleared = state.phase === "won" ? state.totalLevels : state.level - 1;
  const points = state.phase === "won" ? 3 : cleared * 2 >= state.totalLevels ? 1 : 0;
  state.phase = "finished";
  state.step += 1;
  const scores: ScoreAward[] =
    points > 0
      ? state.players.map((p) => ({ playerId: p, points, reason: `合作通过 ${cleared} 关`, key: `coop:${p}` }))
      : [];
  return { ok: true, state, finished: true, scores };
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const syncGame = defineGame<SyncState, Action, SyncView, Config>({
  meta: {
    id: "sync",
    name: "心照不宣",
    description:
      "合作游戏，没有回合。每人手里几张 1–100 的数字牌，全桌要从小到大把它们打完——不许说自己有什么，全凭感觉什么时候轮到自己。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `第 1 关每人 1 张牌，第 2 关每人 2 张，以此类推（2 人 12 关，3 人 10 关，4 人 8 关，5 人以上 6 关）。牌是 1–100 各一张。没有顺序，谁觉得自己最小的那张该出了就出。不能用语音或文字透露自己的牌——只能靠等待的时间长短互相感觉。如果有人出牌时，别人手里还有更小的牌，算一次失误：全队掉 1 条命，所有更小的牌亮出来弃掉。命数等于人数（最多 ${MAX_LIVES}）。手里卡住时可以提议用一颗「星」：所有还有牌的人都同意，每人亮出并弃掉自己最小的一张。通过第 2、5、8 关各得一颗星，通过第 3、6、9 关各得一条命。`,
    scoringSummary: "全部通关：每人 +3 分。没通关但过了一半以上的关：每人 +1 分。",
    options: [{ key: "levels", label: "关数", min: 0, max: 12, default: 0, hint: "0 = 按人数" }],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const fit = Math.floor(100 / ctx.players.length);
    const state: SyncState = {
      config,
      level: 1,
      totalLevels: Math.min(fit, config.levels || syncLevels(ctx.players.length)),
      round: 0,
      step: 0,
      phase: "play",
      players: [],
      hands: {},
      pile: [],
      lives: syncLives(ctx.players.length),
      stars: 1,
      starVotes: [],
      shown: null,
      reward: null,
    };
    deal(state, ctx);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    const me = actor.playerId;
    if (action.type === "next") {
      if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
      if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
      if (state.phase === "won" || state.phase === "lost") return finish(state);
      if (state.phase !== "levelOver") return { ok: false, error: "这一关还没打完" };
      if (!countOk(ctx.players.length) || (state.level + 1) * ctx.players.length > 100) return finish(state);
      state.level += 1;
      deal(state, ctx);
      return { ok: true, state };
    }
    if (state.phase !== "play") return { ok: false, error: "这一关已经结束" };
    if (action.round !== state.round) return { ok: false, error: "该操作已过期" };
    const hand = state.hands[me] ?? [];
    if (hand.length === 0) return { ok: false, error: "你手里没有牌了" };
    if (action.type === "star") {
      if (state.stars <= 0) return { ok: false, error: "没有星了" };
      state.starVotes = state.starVotes.filter((p) => p !== me);
      if (action.on) state.starVotes.push(me);
      if (holders(state).every((p) => state.starVotes.includes(p))) {
        state.stars -= 1;
        state.shown = {
          kind: "star",
          cards: holders(state).map((p) => ({ by: p, card: (state.hands[p] as number[]).shift() as number })),
        };
        state.starVotes = [];
        return afterPlay(state);
      }
      state.step += 1;
      return { ok: true, state };
    }
    if (action.card !== hand[0]) return { ok: false, error: "只能出自己最小的那张" };
    hand.shift();
    state.pile.push({ card: action.card, by: me });
    const lower = state.players.flatMap((p) =>
      (state.hands[p] ?? []).filter((c) => c < action.card).map((card) => ({ by: p, card })),
    );
    if (lower.length > 0) {
      for (const p of state.players) state.hands[p] = (state.hands[p] ?? []).filter((c) => c > action.card);
      state.lives -= 1;
      state.shown = { kind: "mistake", card: action.card, by: me, cards: lower };
    }
    return afterPlay(state);
  },

  atSafePoint: (state) => state.phase !== "play",

  view(state, viewer) {
    const open = state.phase === "lost" || state.phase === "won" || state.phase === "finished";
    return {
      level: state.level,
      totalLevels: state.totalLevels,
      round: state.round,
      step: state.step,
      phase: state.phase,
      players: state.players,
      myHand: state.hands[viewer] ?? null,
      counts: Object.fromEntries(state.players.map((p) => [p, state.hands[p]?.length ?? 0])),
      hands: open ? state.hands : null,
      pile: state.pile,
      lives: state.lives,
      stars: state.stars,
      starVotes: state.starVotes,
      shown: state.shown,
      reward: state.reward,
    };
  },

  publicSummary(state) {
    return `心照不宣 第 ${state.level}/${state.totalLevels} 关，阶段：${state.phase}，剩 ${state.lives} 条命、${state.stars} 颗星，已打出 ${state.pile.length} 张（各人手牌未公开）`;
  },
});
