/**
 * 「攒七张」— everyone holds seven cards. On your turn draw one (from the deck, or any card in
 * the open discard area) and discard one. Cards have a base strength and effects that depend
 * on the suits of the rest of your hand: bonuses, penalties, and blanking. When the discard
 * area fills up, the strongest hand wins.
 * Suits and card names come from a theme (content); the rules never read the names.
 * Pure rules; no AI. Rule spec: docs/games/seven.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const SEVEN_SUITS = 8;
export const SEVEN_PER_SUIT = 7;
export const SEVEN_HAND = 7;
/** The game ends when this many cards lie in the discard area. */
export const END_DISCARDS = 10;

export const sevenThemeSchema = z.object({
  name: z.string().min(1).max(16),
  suits: z.array(z.object({ label: z.string().min(1).max(8) })).length(SEVEN_SUITS),
  /** Optional card names, [suit][card]; cards without a name are called "<suit> <number>". */
  cards: z
    .array(z.array(z.string().min(1).max(12)).length(SEVEN_PER_SUIT))
    .length(SEVEN_SUITS)
    .optional(),
  weight: z.number().optional(),
});
export type SevenTheme = z.infer<typeof sevenThemeSchema>;

const FALLBACK_THEME: SevenTheme = {
  name: "夜市",
  suits: ["小吃", "饮料", "摊主", "天气", "熟人", "麻烦", "运气", "地方"].map((label) => ({ label })),
};

export type SevenEffect =
  /** ±pts for every other counting card of the suit. */
  | { t: "perSuit"; suit: number; pts: number }
  /** +pts if the hand has a counting card of the suit. */
  | { t: "ifSuit"; suit: number; pts: number }
  /** −pts unless the hand has a counting card of the suit. */
  | { t: "unlessSuit"; suit: number; pts: number }
  /** +pts if the hand has no counting card of the suit. */
  | { t: "ifNoSuit"; suit: number; pts: number }
  /** This card is blank unless the hand has another card of the suit. */
  | { t: "blankUnless"; suit: number }
  /** Blanks every other card of the suit in the hand. */
  | { t: "blanks"; suit: number }
  /** +pts for every different suit among the counting cards of the hand. */
  | { t: "perDistinct"; pts: number }
  /** +pts if all counting cards of the hand are of different suits. */
  | { t: "allDifferent"; pts: number }
  /** Adds the highest base strength among the other counting cards. */
  | { t: "highestBase" };

export interface SevenCard {
  id: string;
  suit: number;
  index: number;
  base: number;
  effects: SevenEffect[];
}

/** The seven cards of suit `s`. Their effects point at the other suits, rotated per suit. */
function cardsOf(s: number): SevenCard[] {
  const o = (i: number) => (s + i) % SEVEN_SUITS;
  const special: { base: number; effects: SevenEffect[] }[] = [
    { base: 4, effects: [{ t: "perDistinct", pts: 3 }] },
    { base: 3, effects: [{ t: "allDifferent", pts: 40 }] },
    { base: 8, effects: [{ t: "ifNoSuit", suit: o(1), pts: 18 }] },
    { base: 22, effects: [{ t: "unlessSuit", suit: o(2), pts: -12 }] },
    { base: 16, effects: [] },
    {
      base: 2,
      effects: [
        { t: "perSuit", suit: o(6), pts: 5 },
        { t: "perSuit", suit: o(7), pts: 5 },
      ],
    },
    {
      base: 10,
      effects: [
        { t: "ifSuit", suit: o(3), pts: 8 },
        { t: "ifSuit", suit: o(5), pts: 8 },
      ],
    },
    { base: 0, effects: [{ t: "highestBase" }] },
  ];
  const table: { base: number; effects: SevenEffect[] }[] = [
    { base: 5, effects: [{ t: "perSuit", suit: o(1), pts: 6 }] },
    { base: 9, effects: [{ t: "ifSuit", suit: o(2), pts: 10 }] },
    { base: 18, effects: [{ t: "perSuit", suit: o(3), pts: -6 }] },
    { base: 24, effects: [{ t: "blankUnless", suit: o(4) }] },
    { base: 20, effects: [{ t: "blanks", suit: o(5) }] },
    { base: 7, effects: [{ t: "perSuit", suit: s, pts: 7 }] },
    special[s] as { base: number; effects: SevenEffect[] },
  ];
  return table.map((c, index) => ({ id: `${s}-${index}`, suit: s, index, ...c }));
}

export const SEVEN_CARDS: SevenCard[] = Array.from({ length: SEVEN_SUITS }, (_, s) => cardsOf(s)).flat();
const byId = new Map(SEVEN_CARDS.map((c) => [c.id, c]));
export const sevenCard = (id: string) => byId.get(id) as SevenCard;

export const sevenCardName = (card: SevenCard, theme: SevenTheme) =>
  theme.cards?.[card.suit]?.[card.index] ?? `${theme.suits[card.suit]?.label ?? "?"} ${card.index + 1}`;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function effectText(e: SevenEffect, card: SevenCard, suit: (k: number) => string): string {
  switch (e.t) {
    case "perSuit":
      return `手里每有一张${e.suit === card.suit ? "别的" : ""}${suit(e.suit)} ${signed(e.pts)}`;
    case "ifSuit":
      return `手里有${suit(e.suit)} ${signed(e.pts)}`;
    case "unlessSuit":
    case "ifNoSuit":
      return `手里没有${suit(e.suit)} ${signed(e.pts)}`;
    case "blankUnless":
      return `手里没有${suit(e.suit)}时，这张牌作废`;
    case "blanks":
      return `让手里所有${suit(e.suit)}作废`;
    case "perDistinct":
      return `手里每有一种类别 ${signed(e.pts)}`;
    case "allDifferent":
      return `手里的牌类别全都不同 ${signed(e.pts)}`;
    case "highestBase":
      return "加上手里其它牌中最高的基础分";
  }
}

export function describeSevenEffects(card: SevenCard, theme: SevenTheme): string {
  const suit = (k: number) => `「${theme.suits[k]?.label ?? "?"}」`;
  if (card.effects.length === 0) return "没有效果";
  return card.effects.map((e) => effectText(e, card, suit)).join("；");
}

export interface SevenScore {
  total: number;
  cards: { id: string; blank: boolean; value: number }[];
}

/**
 * Scores a hand. Blanking is settled first, in two steps: cards that blank themselves, then
 * cards that blank a suit (only if they are not blank themselves). A blank card is worth
 * nothing, has no effect, and does not count as its suit for anything else.
 */
export function scoreSevenHand(ids: string[]): SevenScore {
  const cards = ids.map(sevenCard);
  const selfBlank = new Set(
    cards
      .filter((c) =>
        c.effects.some((e) => e.t === "blankUnless" && !cards.some((x) => x.id !== c.id && x.suit === e.suit)),
      )
      .map((c) => c.id),
  );
  const blank = new Set(selfBlank);
  for (const c of cards) {
    if (selfBlank.has(c.id)) continue;
    for (const e of c.effects) {
      if (e.t !== "blanks") continue;
      for (const x of cards) if (x.id !== c.id && x.suit === e.suit) blank.add(x.id);
    }
  }
  const live = cards.filter((c) => !blank.has(c.id));
  const count = (suit: number, except: string) => live.filter((x) => x.suit === suit && x.id !== except).length;
  const distinct = new Set(live.map((c) => c.suit)).size;
  const scored = cards.map((c) => {
    if (blank.has(c.id)) return { id: c.id, blank: true, value: 0 };
    let value = c.base;
    for (const e of c.effects) {
      switch (e.t) {
        case "perSuit":
          value += count(e.suit, c.id) * e.pts;
          break;
        case "ifSuit":
          if (count(e.suit, c.id) > 0) value += e.pts;
          break;
        case "unlessSuit":
        case "ifNoSuit":
          if (count(e.suit, c.id) === 0) value += e.pts;
          break;
        case "perDistinct":
          value += distinct * e.pts;
          break;
        case "allDifferent":
          if (distinct === live.length) value += e.pts;
          break;
        case "highestBase":
          value += Math.max(0, ...live.filter((x) => x.id !== c.id).map((x) => x.base));
          break;
      }
    }
    return { id: c.id, blank: false, value };
  });
  return { total: scored.reduce((sum, c) => sum + c.value, 0), cards: scored };
}

const configSchema = z.object({
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  /** Draw the hidden top card of the deck. */
  z.object({ type: z.literal("draw"), step: z.number().int() }),
  /** Take a face-up card from the discard area. */
  z.object({ type: z.literal("take"), step: z.number().int(), cardId: z.string() }),
  z.object({ type: z.literal("discard"), step: z.number().int(), cardId: z.string() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface SevenState {
  config: Config;
  step: number;
  phase: "draw" | "discard" | "finished";
  players: PlayerId[];
  current: PlayerId;
  theme: SevenTheme;
  /** Hidden; index 0 is the top. */
  deck: string[];
  /** Face up for everyone. */
  discards: string[];
  /** Secret until the end. */
  hands: Record<PlayerId, string[]>;
  winners: PlayerId[];
  deadlineAt: number | null;
}

interface CardView {
  id: string;
  suit: number;
  name: string;
  base: number;
  text: string;
}

export interface SevenView {
  step: number;
  phase: SevenState["phase"];
  players: PlayerId[];
  current: PlayerId;
  theme: { name: string; suits: { label: string }[] };
  deckLeft: number;
  discards: CardView[];
  endAt: number;
  /** My own hand with what each card is worth right now; null for someone who is not playing. */
  hand: (CardView & { blank: boolean; value: number })[] | null;
  myTotal: number | null;
  /** While I must discard: what my hand would be worth without each card. */
  ifDiscard: Record<string, number> | null;
  /** While cards can be drawn: the best total I could reach by taking each open card. */
  ifTake: Record<string, number> | null;
  handSizes: Record<PlayerId, number>;
  /** Everyone's hand and total, only once the game is over. */
  final: Record<PlayerId, { total: number; cards: (CardView & { blank: boolean; value: number })[] }> | null;
  winners: PlayerId[];
  deadlineAt: number | null;
}

function nextTurn(state: SevenState, ctx: GameContext): GameResult<SevenState> {
  state.step += 1;
  if (state.discards.length >= END_DISCARDS) {
    state.phase = "finished";
    state.deadlineAt = null;
    const totals = state.players.map((p) => scoreSevenHand(state.hands[p] ?? []).total);
    const best = Math.max(...totals);
    state.winners = state.players.filter((_, i) => totals[i] === best);
    const scores: ScoreAward[] = state.players
      .map((p, i) => ({ playerId: p, points: Math.max(0, totals[i] as number), reason: "手牌总分", key: `final:${p}` }))
      .filter((s) => s.points > 0);
    return { ok: true, state, scores, finished: true };
  }
  state.phase = "draw";
  state.current = state.players[(state.players.indexOf(state.current) + 1) % state.players.length] as PlayerId;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function draw(state: SevenState, me: PlayerId, from: "deck" | string): GameResult<SevenState> {
  let id: string | undefined;
  if (from === "deck") {
    id = state.deck.shift();
    if (!id) return { ok: false, error: "牌堆已经空了，只能从弃牌区拿" };
  } else {
    const index = state.discards.indexOf(from);
    if (index < 0) return { ok: false, error: "这张牌不在弃牌区" };
    id = state.discards.splice(index, 1)[0] as string;
  }
  (state.hands[me] as string[]).push(id);
  state.phase = "discard";
  state.step += 1;
  return { ok: true, state };
}

function discard(state: SevenState, me: PlayerId, cardId: string, ctx: GameContext): GameResult<SevenState> {
  const hand = state.hands[me] as string[];
  const index = hand.indexOf(cardId);
  if (index < 0) return { ok: false, error: "这张牌不在你手里" };
  hand.splice(index, 1);
  state.discards.push(cardId);
  return nextTurn(state, ctx);
}

export const sevenGame = defineGame<SevenState, Action, SevenView, Config>({
  meta: {
    id: "seven",
    name: "攒七张",
    description:
      "每人七张牌，摸一张弃一张。牌和牌之间会互相加分、扣分、甚至让对方作废——弃牌区摆满时，手牌总分最高的人赢。",
    minPlayers: 2,
    maxPlayers: 6,
    rulesSummary: `一共 ${SEVEN_SUITS} 个类别、${SEVEN_CARDS.length} 张牌，每张牌有基础分和一条效果，效果看的是你手里其它牌的类别。每人发 ${SEVEN_HAND} 张，手牌只有自己看得到。轮到你时先摸一张：摸牌堆顶的暗牌，或者从公开的弃牌区里挑一张；然后从手里弃一张到弃牌区。弃牌区摆到 ${END_DISCARDS} 张时立刻结束。作废的牌不算分、效果失效，也不再算作它的类别。`,
    scoringSummary: "结束时每张没作废的牌按「基础分 + 效果」算分，加起来就是你的得分。",
    options: [secondsOption("turnSeconds", "每步时限", 0)],
    contentType: "seven-theme",
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    const n = ctx.players.length;
    if (n < 2 || n > 6) return { ok: false, error: "需要 2–6 名玩家" };
    const themes = ctx
      .peekContent(12)
      .map((item) => sevenThemeSchema.safeParse(item.payload))
      .flatMap((r) => (r.success ? [r.data] : []));
    const theme = themes.reduce<SevenTheme>(
      (best, t) => ((t.weight ?? 0) > (best.weight ?? -1) ? t : best),
      themes[0] ?? FALLBACK_THEME,
    );
    const deck = shuffle(
      SEVEN_CARDS.map((c) => c.id),
      ctx.random,
    );
    const state: SevenState = {
      config,
      step: 1,
      phase: "draw",
      players: [...ctx.players],
      current: ctx.players[0] as PlayerId,
      theme: { name: theme.name, suits: theme.suits, ...(theme.cards ? { cards: theme.cards } : {}) },
      deck,
      discards: [],
      hands: Object.fromEntries(ctx.players.map((p) => [p, deck.splice(0, SEVEN_HAND)])),
      winners: [],
      deadlineAt: timer(config.turnSeconds, ctx),
    };
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (me !== state.current) return { ok: false, error: "还没轮到你" };
    switch (action.type) {
      case "draw":
      case "take":
        if (state.phase !== "draw") return { ok: false, error: "你已经摸过牌了，现在要弃一张" };
        return draw(state, me, action.type === "draw" ? "deck" : action.cardId);
      case "discard":
        if (state.phase !== "discard") return { ok: false, error: "先摸一张牌" };
        return discard(state, me, action.cardId, ctx);
    }
  },

  deadline: (state) => (state.phase === "finished" ? null : state.deadlineAt),
  // An absent player draws and throws the same card away, leaving their hand as it was.
  onTimeout(state, ctx) {
    if (state.phase === "finished") return { ok: true, state };
    const me = state.current;
    if (state.phase === "draw") {
      const drawn = draw(state, me, state.deck.length > 0 ? "deck" : (state.discards[0] as string));
      if (!drawn.ok) return drawn;
    }
    return discard(state, me, (state.hands[me] as string[]).at(-1) as string, ctx);
  },
  onResume(state, ctx) {
    if (state.phase !== "finished") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const card = (id: string): CardView => {
      const c = sevenCard(id);
      return {
        id,
        suit: c.suit,
        name: sevenCardName(c, state.theme),
        base: c.base,
        text: describeSevenEffects(c, state.theme),
      };
    };
    const scoredHand = (ids: string[]) => {
      const score = scoreSevenHand(ids);
      return {
        total: score.total,
        cards: score.cards.map((s) => ({ ...card(s.id), blank: s.blank, value: s.value })),
      };
    };
    const myIds = state.hands[viewer] ?? null;
    const mine = myIds ? scoredHand(myIds) : null;
    const without = (ids: string[], id: string) => scoreSevenHand(ids.filter((x) => x !== id)).total;
    // Planning help computed from the viewer's own hand and the open cards only.
    const ifDiscard =
      myIds && state.phase === "discard" && viewer === state.current
        ? Object.fromEntries(myIds.map((id) => [id, without(myIds, id)]))
        : null;
    const ifTake =
      myIds && state.phase === "draw"
        ? Object.fromEntries(state.discards.map((d) => [d, Math.max(...myIds.map((x) => without([...myIds, d], x)))]))
        : null;
    return {
      step: state.step,
      phase: state.phase,
      players: state.players,
      current: state.current,
      theme: { name: state.theme.name, suits: state.theme.suits },
      deckLeft: state.deck.length,
      discards: state.discards.map(card),
      endAt: END_DISCARDS,
      hand: mine?.cards ?? null,
      myTotal: mine?.total ?? null,
      ifDiscard,
      ifTake,
      handSizes: Object.fromEntries(state.players.map((p) => [p, state.hands[p]?.length ?? 0])),
      final:
        state.phase === "finished"
          ? Object.fromEntries(state.players.map((p) => [p, scoredHand(state.hands[p] ?? [])]))
          : null,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    return `攒七张（主题：${state.theme.name}），弃牌区 ${state.discards.length}/${END_DISCARDS} 张，阶段：${state.phase}（各人手牌未公开）`;
  },
});
