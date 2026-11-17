/**
 * 「烟花接龙」— cooperative. You see everyone's cards but your own. On your turn give a hint
 * about a colour or a number in someone's hand, discard a card to win a hint back, or play a
 * card blind onto the fireworks, which must go 1 to 5 in each colour.
 * Pure rules; no content, no AI. Rule spec: docs/games/fireworks.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const FW_COLORS = ["红", "黄", "绿", "蓝", "白"];
/** How many cards of each number a colour has: three 1s, two each of 2–4, one 5. */
const COPIES = [3, 2, 2, 2, 1];
export const FW_HINTS = 8;
export const FW_FUSES = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
export const fwHandSize = (players: number) => (players <= 3 ? 5 : 4);

export interface FwCard {
  id: string;
  color: string;
  number: number;
  /** What its holder has been told. */
  knownColor: boolean;
  knownNumber: boolean;
  notColors: string[];
  notNumbers: number[];
}
/** A card as its own holder sees it: only what the hints have revealed. */
export interface FwHidden {
  id: string;
  color: string | null;
  number: number | null;
  notColors: string[];
  notNumbers: number[];
}

const configSchema = z.object({ turnSeconds: z.number().int().min(0).max(600).default(0) });
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hint"),
    target: z.string(),
    color: z.string().optional(),
    number: z.number().int().min(1).max(5).optional(),
    step: z.number().int(),
  }),
  z.object({ type: z.literal("play"), cardId: z.string(), step: z.number().int() }),
  z.object({ type: z.literal("discard"), cardId: z.string(), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export type FwEvent =
  | { kind: "hint"; by: PlayerId; target: PlayerId; color?: string; number?: number; count: number }
  | { kind: "play"; by: PlayerId; color: string; number: number; ok: boolean }
  | { kind: "discard"; by: PlayerId; color: string; number: number };

export interface FireworksState {
  config: Config;
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: PlayerId[];
  current: PlayerId;
  hands: Record<PlayerId, FwCard[]>;
  deck: FwCard[];
  /** Highest number played in each colour. */
  stacks: Record<string, number>;
  discard: { color: string; number: number }[];
  hints: number;
  fuses: number;
  /** Turns left once the deck has run out; null before that. */
  finalTurns: number | null;
  log: FwEvent[];
  ended: "exploded" | "complete" | "deck" | null;
  deadlineAt: number | null;
}

export interface FireworksView {
  step: number;
  phase: FireworksState["phase"];
  players: PlayerId[];
  current: PlayerId;
  colors: string[];
  /** Other players' cards in full. */
  hands: Record<PlayerId, FwCard[]>;
  /** The viewer's own cards, reduced to what they have been told. */
  myHand: FwHidden[] | null;
  deckLeft: number;
  stacks: Record<string, number>;
  discard: { color: string; number: number }[];
  hints: number;
  fuses: number;
  finalTurns: number | null;
  score: number;
  log: FwEvent[];
  ended: FireworksState["ended"];
  deadlineAt: number | null;
}

export const fwScore = (state: FireworksState) => Object.values(state.stacks).reduce((sum, n) => sum + n, 0);

function buildDeck(): FwCard[] {
  return FW_COLORS.flatMap((color) =>
    COPIES.flatMap((copies, i) =>
      Array.from(
        { length: copies },
        (): FwCard => ({
          id: "",
          color,
          number: i + 1,
          knownColor: false,
          knownNumber: false,
          notColors: [],
          notNumbers: [],
        }),
      ),
    ),
  );
}

function end(state: FireworksState, why: NonNullable<FireworksState["ended"]>): GameResult<FireworksState> {
  state.ended = why;
  state.phase = "gameOver";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

/** Closes a turn: refill, count down the last round, pass to the next player. */
function endTurn(state: FireworksState, me: PlayerId, drew: boolean, ctx: GameContext): GameResult<FireworksState> {
  state.log = state.log.slice(-8);
  if (state.fuses <= 0) return end(state, "exploded");
  if (fwScore(state) === FW_COLORS.length * 5) return end(state, "complete");
  if (state.finalTurns !== null) {
    state.finalTurns -= 1;
    if (state.finalTurns <= 0) return end(state, "deck");
  } else if (drew && state.deck.length === 0) {
    // The last card has been drawn: everyone, this player included, gets one more turn.
    state.finalTurns = state.players.length;
  }
  state.current = state.players[(state.players.indexOf(me) + 1) % state.players.length] as PlayerId;
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function takeCard(state: FireworksState, me: PlayerId, cardId: string): { card: FwCard; drew: boolean } | null {
  const hand = state.hands[me] as FwCard[];
  const index = hand.findIndex((c) => c.id === cardId);
  if (index < 0) return null;
  const card = hand.splice(index, 1)[0] as FwCard;
  const next = state.deck.shift();
  if (next) hand.push(next);
  return { card, drew: !!next };
}

function discard(state: FireworksState, me: PlayerId, cardId: string, ctx: GameContext): GameResult<FireworksState> {
  const taken = takeCard(state, me, cardId);
  if (!taken) return { ok: false, error: "你手里没有这张牌" };
  state.discard.push({ color: taken.card.color, number: taken.card.number });
  state.hints = Math.min(FW_HINTS, state.hints + 1);
  state.log.push({ kind: "discard", by: me, color: taken.card.color, number: taken.card.number });
  return endTurn(state, me, taken.drew, ctx);
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const fireworksGame = defineGame<FireworksState, Action, FireworksView, Config>({
  meta: {
    id: "fireworks",
    name: "烟花接龙",
    description: "合作游戏。你看得到所有人的牌，唯独看不到自己的。靠队友有限的提示，把五种颜色的烟花各自从 1 接到 5。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `五种颜色，每种颜色有三张 1、两张 2、两张 3、两张 4、一张 5，共 50 张。2–3 人每人 5 张牌，4–5 人每人 4 张；自己的牌自己看不到。有 ${FW_HINTS} 个提示和 ${FW_FUSES} 条引线。轮到你时三选一：一，花一个提示，告诉一位队友他手里哪些牌是某个颜色，或哪些牌是某个数字（必须把符合的全部指出来）。二，弃掉一张自己的牌，拿回一个提示。三，打出一张自己的牌：如果它正好是某个颜色的下一张就接上（接上 5 再拿回一个提示），否则烧掉一条引线、这张牌作废。打出或弃牌后摸一张补上。三条引线烧完，烟花爆炸，全队 0 分；牌堆摸完后每人再行动一次结束；五种颜色全部接到 5 则立刻结束。得分是五堆烟花最上面的数字之和，满分 25。`,
    scoringSummary: "没有爆炸时：21 分以上每人 +3，16–20 分每人 +2，11–15 分每人 +1。",
    options: [secondsOption("turnSeconds", "每步时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    // Ids are handed out after shuffling: a player's own cards carry their ids, so an id must say nothing.
    const deck = shuffle(buildDeck(), ctx.random).map((c, i) => ({ ...c, id: `f${i}` }));
    const size = fwHandSize(ctx.players.length);
    const state: FireworksState = {
      config,
      step: 1,
      phase: "play",
      players: [...ctx.players],
      current: ctx.players[0] as PlayerId,
      hands: Object.fromEntries(ctx.players.map((p) => [p, deck.splice(0, size)])),
      deck,
      stacks: Object.fromEntries(FW_COLORS.map((c) => [c, 0])),
      discard: [],
      hints: FW_HINTS,
      fuses: FW_FUSES,
      finalTurns: null,
      log: [],
      ended: null,
      deadlineAt: timer(config.turnSeconds, ctx),
    };
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以结束" };
      if (state.phase !== "gameOver") return { ok: false, error: "还没结束" };
      const score = state.ended === "exploded" ? 0 : fwScore(state);
      const points = score >= 21 ? 3 : score >= 16 ? 2 : score >= 11 ? 1 : 0;
      state.phase = "finished";
      state.step += 1;
      const scores: ScoreAward[] =
        points > 0
          ? state.players.map((p) => ({ playerId: p, points, reason: `合作烟花 ${score} 分`, key: `coop:${p}` }))
          : [];
      return { ok: true, state, finished: true, scores };
    }
    if (state.phase !== "play") return { ok: false, error: "这一局已经结束" };
    if (me !== state.current) return { ok: false, error: "还没轮到你" };
    switch (action.type) {
      case "hint": {
        if (state.hints <= 0) return { ok: false, error: "没有提示了，先弃一张牌" };
        if (action.target === me || !state.players.includes(action.target))
          return { ok: false, error: "不能提示这位玩家" };
        const byColor = action.color !== undefined;
        if (byColor === (action.number !== undefined)) return { ok: false, error: "提示颜色或数字，二选一" };
        if (byColor && !FW_COLORS.includes(action.color as string)) return { ok: false, error: "没有这种颜色" };
        const hand = state.hands[action.target] as FwCard[];
        const hit = (c: FwCard) => (byColor ? c.color === action.color : c.number === action.number);
        const count = hand.filter(hit).length;
        if (count === 0) return { ok: false, error: "他手里没有这样的牌，不能这样提示" };
        for (const c of hand) {
          if (byColor) {
            if (hit(c)) c.knownColor = true;
            else if (!c.notColors.includes(action.color as string)) c.notColors.push(action.color as string);
          } else if (hit(c)) c.knownNumber = true;
          else if (!c.notNumbers.includes(action.number as number)) c.notNumbers.push(action.number as number);
        }
        state.hints -= 1;
        state.log.push({
          kind: "hint",
          by: me,
          target: action.target,
          ...(byColor ? { color: action.color } : { number: action.number }),
          count,
        });
        return endTurn(state, me, false, ctx);
      }
      case "discard":
        if (state.hints >= FW_HINTS) return { ok: false, error: "提示是满的，不能弃牌" };
        return discard(state, me, action.cardId, ctx);
      case "play": {
        const taken = takeCard(state, me, action.cardId);
        if (!taken) return { ok: false, error: "你手里没有这张牌" };
        const { color, number } = taken.card;
        const ok = state.stacks[color] === number - 1;
        if (ok) {
          state.stacks[color] = number;
          if (number === 5) state.hints = Math.min(FW_HINTS, state.hints + 1);
        } else {
          state.fuses -= 1;
          state.discard.push({ color, number });
        }
        state.log.push({ kind: "play", by: me, color, number, ok });
        return endTurn(state, me, taken.drew, ctx);
      }
    }
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  // An absent player discards their oldest card, or gives the plainest hint when hints are full.
  onTimeout(state, ctx) {
    if (state.phase !== "play") return { ok: true, state };
    const me = state.current;
    const oldest = (state.hands[me] as FwCard[])[0];
    if (state.hints < FW_HINTS && oldest) return discard(state, me, oldest.id, ctx);
    const target = state.players.find((p) => p !== me) as PlayerId;
    const number = (state.hands[target] as FwCard[])[0]?.number as number;
    for (const c of state.hands[target] as FwCard[]) {
      if (c.number === number) c.knownNumber = true;
      else if (!c.notNumbers.includes(number)) c.notNumbers.push(number);
    }
    state.hints -= 1;
    const count = (state.hands[target] as FwCard[]).filter((c) => c.number === number).length;
    state.log.push({ kind: "hint", by: me, target, number, count });
    return endTurn(state, me, false, ctx);
  },
  onResume(state, ctx) {
    if (state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const open = state.phase !== "play";
    const mine = state.hands[viewer];
    return {
      step: state.step,
      phase: state.phase,
      players: state.players,
      current: state.current,
      colors: FW_COLORS,
      hands: Object.fromEntries(Object.entries(state.hands).filter(([p]) => open || p !== viewer)),
      myHand: mine
        ? mine.map((c) => ({
            id: c.id,
            color: c.knownColor ? c.color : null,
            number: c.knownNumber ? c.number : null,
            notColors: c.notColors,
            notNumbers: c.notNumbers,
          }))
        : null,
      deckLeft: state.deck.length,
      stacks: state.stacks,
      discard: state.discard,
      hints: state.hints,
      fuses: state.fuses,
      finalTurns: state.finalTurns,
      score: fwScore(state),
      log: state.log,
      ended: state.ended,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const stacks = FW_COLORS.map((c) => `${c}${state.stacks[c]}`).join(" ");
    return `烟花接龙，阶段：${state.phase}，烟花 ${stacks}（共 ${fwScore(state)} 分），提示 ${state.hints}，引线 ${state.fuses}，牌堆 ${state.deck.length}（各人手牌不向本人公开）`;
  },
});
