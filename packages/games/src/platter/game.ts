/**
 * 「凑一桌」— a market of double-sided cards: one side is an ingredient, the other a scoring
 * rule. On your turn take one rule, or two ingredients. At the end every rule you kept scores
 * against your own ingredients. The six ingredients are named by a theme (content), so the
 * same rules can be played with any group's own vocabulary.
 * Pure rules; no AI. Rule spec: docs/games/platter.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

const KINDS = 6;
const COLUMNS = 3;
const ROWS = 2;
const CARDS_PER_KIND = 10;
/** Cards of each kind in play, by number of players. */
export const cardsPerKind = (players: number) => (players <= 2 ? 5 : players === 3 ? 7 : players === 4 ? 9 : 10);

export const platterThemeSchema = z.object({
  name: z.string().min(1).max(16),
  kinds: z.array(z.object({ label: z.string().min(1).max(10), mark: z.string().max(4).optional() })).length(KINDS),
  /** Among the themes on offer the highest weight is used; a private pack outranks the built-in one. */
  weight: z.number().optional(),
});
export type PlatterTheme = z.infer<typeof platterThemeSchema>;

const FALLBACK_THEME: PlatterTheme = {
  name: "零食局",
  kinds: ["薯片", "可乐", "辣条", "泡面", "瓜子", "奶茶"].map((label) => ({ label })),
};

export type PlatterRule =
  | { t: "per"; items: { k: number; pts: number }[] }
  | { t: "set"; kinds: number[]; pts: number }
  | { t: "multi"; k: number; n: number; pts: number }
  | { t: "most"; k: number; pts: number }
  | { t: "fewest"; k: number; pts: number }
  | { t: "parity"; k: number; even: number; odd: number }
  | { t: "mostTotal"; pts: number }
  | { t: "fewestTotal"; pts: number }
  | { t: "missing"; pts: number }
  | { t: "rainbow"; pts: number }
  | { t: "atLeast"; n: number; pts: number };

export interface PlatterCard {
  id: string;
  kind: number;
  rule: PlatterRule;
}

/** The rule side of the ten cards of kind `k`; they mostly reward the other five kinds. */
function rulesOf(k: number): PlatterRule[] {
  const o = (i: number) => (k + i) % KINDS;
  const special: PlatterRule[] = [
    { t: "mostTotal", pts: 10 },
    { t: "fewestTotal", pts: 7 },
    { t: "missing", pts: 5 },
    { t: "rainbow", pts: 12 },
    { t: "atLeast", n: 2, pts: 3 },
    { t: "atLeast", n: 3, pts: 5 },
  ];
  return [
    k % 2 === 0 ? { t: "per", items: [{ k: o(1), pts: 2 }] } : { t: "parity", k: o(1), even: 7, odd: 3 },
    {
      t: "per",
      items: [
        { k: o(2), pts: 3 },
        { k: o(4), pts: -2 },
      ],
    },
    {
      t: "per",
      items: [
        { k: o(3), pts: 2 },
        { k: o(5), pts: 1 },
        { k: o(1), pts: -2 },
      ],
    },
    { t: "set", kinds: [o(1), o(2)], pts: 5 },
    { t: "set", kinds: [o(3), o(4)], pts: 5 },
    { t: "set", kinds: [o(5), o(1), o(3)], pts: 8 },
    { t: "multi", k: o(2), n: 2, pts: 5 },
    { t: "multi", k: o(4), n: 3, pts: 8 },
    k % 3 === 0 ? { t: "fewest", k: o(5), pts: 7 } : { t: "most", k: o(5), pts: 10 },
    special[k] as PlatterRule,
  ];
}

export const ALL_CARDS: PlatterCard[] = Array.from({ length: KINDS }, (_, k) =>
  rulesOf(k).map((rule, i): PlatterCard => ({ id: `${k}-${i}`, kind: k, rule })),
).flat();
const byId = new Map(ALL_CARDS.map((c) => [c.id, c]));
export const cardOf = (id: string) => byId.get(id) as PlatterCard;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** The rule in the players' words, with the theme's names for the six kinds. */
export function describeRule(rule: PlatterRule, theme: PlatterTheme): string {
  const name = (k: number) => theme.kinds[k]?.label ?? "?";
  switch (rule.t) {
    case "per":
      return rule.items.map((i) => `每张${name(i.k)} ${signed(i.pts)}`).join("，");
    case "set":
      return `每凑齐一组 ${rule.kinds.map(name).join(" + ")} ${signed(rule.pts)}`;
    case "multi":
      return `每 ${rule.n} 张${name(rule.k)} ${signed(rule.pts)}`;
    case "most":
      return `${name(rule.k)}全场最多 ${signed(rule.pts)}（并列也算）`;
    case "fewest":
      return `${name(rule.k)}全场最少 ${signed(rule.pts)}（并列也算）`;
    case "parity":
      return `${name(rule.k)}是偶数张 ${signed(rule.even)}，奇数张 ${signed(rule.odd)}（没有不得分）`;
    case "mostTotal":
      return `牌的总数全场最多 ${signed(rule.pts)}（并列也算）`;
    case "fewestTotal":
      return `牌的总数全场最少 ${signed(rule.pts)}（并列也算）`;
    case "missing":
      return `每缺一种 ${signed(rule.pts)}`;
    case "rainbow":
      return `每凑齐六种各一张 ${signed(rule.pts)}`;
    case "atLeast":
      return `每有一种达到 ${rule.n} 张 ${signed(rule.pts)}`;
  }
}

/** What a rule is worth to `me`, given everyone's ingredient counts. */
export function scoreRule(rule: PlatterRule, me: PlayerId, items: Record<PlayerId, number[]>): number {
  const mine = items[me] ?? [];
  const count = (k: number) => mine[k] ?? 0;
  const total = (p: PlayerId) => (items[p] ?? []).reduce((a, b) => a + b, 0);
  const everyone = Object.keys(items);
  switch (rule.t) {
    case "per":
      return rule.items.reduce((sum, i) => sum + count(i.k) * i.pts, 0);
    case "set":
      return Math.min(...rule.kinds.map(count)) * rule.pts;
    case "multi":
      return Math.floor(count(rule.k) / rule.n) * rule.pts;
    case "most":
      return everyone.every((p) => (items[p]?.[rule.k] ?? 0) <= count(rule.k)) ? rule.pts : 0;
    case "fewest":
      return everyone.every((p) => (items[p]?.[rule.k] ?? 0) >= count(rule.k)) ? rule.pts : 0;
    case "parity":
      return count(rule.k) === 0 ? 0 : count(rule.k) % 2 === 0 ? rule.even : rule.odd;
    case "mostTotal":
      return everyone.every((p) => total(p) <= total(me)) ? rule.pts : 0;
    case "fewestTotal":
      return everyone.every((p) => total(p) >= total(me)) ? rule.pts : 0;
    case "missing":
      return mine.filter((n) => n === 0).length * rule.pts;
    case "rainbow":
      return Math.min(...mine) * rule.pts;
    case "atLeast":
      return mine.filter((n) => n >= rule.n).length * rule.pts;
  }
}

const configSchema = z.object({
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const slot = z.object({
  col: z
    .number()
    .int()
    .min(0)
    .max(COLUMNS - 1),
  row: z
    .number()
    .int()
    .min(0)
    .max(ROWS - 1),
});
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("takeRule"),
    step: z.number().int(),
    pile: z
      .number()
      .int()
      .min(0)
      .max(COLUMNS - 1),
  }),
  z.object({ type: z.literal("takeItems"), step: z.number().int(), slots: z.array(slot).min(1).max(2) }),
  /** Free, once per turn, before taking: turn one of your rules over into its ingredient for good. */
  z.object({ type: z.literal("flip"), step: z.number().int(), cardId: z.string() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface PlatterState {
  config: Config;
  step: number;
  phase: "play" | "finished";
  players: PlayerId[];
  current: PlayerId;
  theme: PlatterTheme;
  /** PlatterCard ids; index 0 is the top, whose rule side everyone sees. The rest is hidden. */
  piles: string[][];
  /** market[col][row]: ingredient cards on offer under pile `col`. */
  market: (string | null)[][];
  rules: Record<PlayerId, string[]>;
  items: Record<PlayerId, number[]>;
  /** The current player already turned a rule over this turn. */
  flipped: boolean;
  winners: PlayerId[];
  deadlineAt: number | null;
}

interface RuleView {
  id: string;
  kind: number;
  text: string;
  /** What it is worth right now. */
  points: number;
}

export interface PlatterView {
  step: number;
  phase: PlatterState["phase"];
  players: PlayerId[];
  current: PlayerId;
  theme: PlatterTheme;
  /** `worth`: what the top rule would score for the viewer right now (null for non-players). */
  piles: { left: number; top: { id: string; kind: number; text: string; worth: number | null } | null }[];
  market: ({ kind: number } | null)[][];
  rules: Record<PlayerId, RuleView[]>;
  items: Record<PlayerId, number[]>;
  totals: Record<PlayerId, number>;
  canFlip: boolean;
  /** How many ingredients must be taken at once (2, or 1 when only one is left). */
  mustTake: number;
  winners: PlayerId[];
  deadlineAt: number | null;
}

export const totalOf = (state: PlatterState, p: PlayerId) =>
  (state.rules[p] ?? []).reduce((sum, id) => sum + scoreRule(cardOf(id).rule, p, state.items), 0);

const onOffer = (state: PlatterState) => state.market.flat().filter((c) => c !== null).length;

/** An empty pile is restocked with the bottom half of the fullest one, so three rules stay on offer. */
function restock(state: PlatterState) {
  for (const pile of state.piles) {
    if (pile.length > 0) continue;
    const donor = state.piles.reduce((a, b) => (b.length > a.length ? b : a));
    if (donor.length < 2) continue;
    pile.push(...donor.splice(Math.ceil(donor.length / 2)));
  }
}

function refill(state: PlatterState) {
  for (let col = 0; col < COLUMNS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const column = state.market[col] as (string | null)[];
      if (column[row] !== null) continue;
      restock(state);
      column[row] = state.piles[col]?.shift() ?? null;
    }
  }
  restock(state);
}

function endTurn(state: PlatterState, ctx: GameContext): GameResult<PlatterState> {
  refill(state);
  state.step += 1;
  state.flipped = false;
  if (onOffer(state) === 0 && state.piles.every((p) => p.length === 0)) {
    state.phase = "finished";
    state.deadlineAt = null;
    const totals = state.players.map((p) => totalOf(state, p));
    const best = Math.max(...totals);
    state.winners = state.players.filter((_, i) => totals[i] === best);
    const scores: ScoreAward[] = state.players
      .map((p, i) => ({
        playerId: p,
        points: Math.max(0, totals[i] as number),
        reason: "规则牌得分",
        key: `final:${p}`,
      }))
      .filter((s) => s.points > 0);
    return { ok: true, state, scores, finished: true };
  }
  state.current = state.players[(state.players.indexOf(state.current) + 1) % state.players.length] as PlayerId;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function takeItems(
  state: PlatterState,
  me: PlayerId,
  slots: { col: number; row: number }[],
  ctx: GameContext,
): GameResult<PlatterState> {
  const need = Math.min(2, onOffer(state));
  if (need === 0) return { ok: false, error: "桌上没有材料了，只能拿规则牌" };
  if (slots.length !== need) return { ok: false, error: `要一次拿 ${need} 张材料` };
  const [a, b] = slots;
  if (a && b && a.col === b.col && a.row === b.row) return { ok: false, error: "不能拿同一张两次" };
  const taken = slots.map((s) => state.market[s.col]?.[s.row] ?? null);
  if (taken.some((id) => id === null)) return { ok: false, error: "那个位置已经空了" };
  const mine = state.items[me] as number[];
  for (const [i, s] of slots.entries()) {
    const kind = cardOf(taken[i] as string).kind;
    mine[kind] = (mine[kind] ?? 0) + 1;
    (state.market[s.col] as (string | null)[])[s.row] = null;
  }
  return endTurn(state, ctx);
}

function takeRule(state: PlatterState, me: PlayerId, pile: number, ctx: GameContext): GameResult<PlatterState> {
  const id = state.piles[pile]?.shift();
  if (!id) return { ok: false, error: "这一堆已经没有规则牌了" };
  (state.rules[me] as string[]).push(id);
  return endTurn(state, ctx);
}

export const platterGame = defineGame<PlatterState, Action, PlatterView, Config>({
  meta: {
    id: "platter",
    name: "凑一桌",
    description:
      "每张牌一面是材料，一面是计分规则。轮到你：拿一张规则，或者拿两张材料。最后看你攒的规则配不配得上你攒的材料。",
    minPlayers: 2,
    maxPlayers: 6,
    rulesSummary: `一共六种材料，每张牌正面是一种材料，背面是一条计分规则。桌上有三堆牌，每堆顶上露出规则那一面，下面各摆两张翻成材料的牌。轮到你时二选一：拿走一堆顶上的规则牌；或者从桌上拿两张材料（只剩一张就拿一张），空位从它上面那堆补。每回合拿牌之前，还可以免费把自己的一张规则牌翻成它背面的材料，翻了就翻不回来。某一堆拿空了，从最多的那堆分一半过来。所有牌拿完时结束。`,
    scoringSummary: "每张规则牌按你自己的材料算分（有些规则会扣分，有些要和全场比多少），加起来就是你的得分。",
    options: [secondsOption("turnSeconds", "每步时限", 0)],
    contentType: "platter-theme",
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    const n = ctx.players.length;
    if (n < 2 || n > 6) return { ok: false, error: "需要 2–6 名玩家" };
    // Themes are looked at, not used up: the same group can play its own pack every time.
    const themes = ctx
      .peekContent(12)
      .map((item) => platterThemeSchema.safeParse(item.payload))
      .flatMap((r) => (r.success ? [r.data] : []));
    const theme = themes.reduce<PlatterTheme>(
      (best, t) => ((t.weight ?? 0) > (best.weight ?? -1) ? t : best),
      themes[0] ?? FALLBACK_THEME,
    );
    const deck = shuffle(
      Array.from({ length: KINDS }, (_, k) =>
        shuffle(
          ALL_CARDS.filter((c) => c.kind === k),
          ctx.random,
        ).slice(0, Math.min(CARDS_PER_KIND, cardsPerKind(n))),
      ).flat(),
      ctx.random,
    ).map((c) => c.id);
    const state: PlatterState = {
      config,
      step: 1,
      phase: "play",
      players: [...ctx.players],
      current: ctx.players[0] as PlayerId,
      theme: { name: theme.name, kinds: theme.kinds },
      piles: Array.from({ length: COLUMNS }, (_, i) => deck.filter((_, j) => j % COLUMNS === i)),
      market: Array.from({ length: COLUMNS }, () => Array.from({ length: ROWS }, () => null)),
      rules: Object.fromEntries(ctx.players.map((p) => [p, []])),
      items: Object.fromEntries(ctx.players.map((p) => [p, Array.from({ length: KINDS }, () => 0)])),
      flipped: false,
      winners: [],
      deadlineAt: timer(config.turnSeconds, ctx),
    };
    refill(state);
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (me !== state.current) return { ok: false, error: "还没轮到你" };
    switch (action.type) {
      case "flip": {
        if (state.flipped) return { ok: false, error: "这回合已经翻过一张了" };
        const mine = state.rules[me] as string[];
        const index = mine.indexOf(action.cardId);
        if (index < 0) return { ok: false, error: "这张规则牌不在你手里" };
        mine.splice(index, 1);
        const items = state.items[me] as number[];
        const kind = cardOf(action.cardId).kind;
        items[kind] = (items[kind] ?? 0) + 1;
        state.flipped = true;
        // Same turn, same step: the player still has to take cards.
        return { ok: true, state };
      }
      case "takeRule":
        return takeRule(state, me, action.pile, ctx);
      case "takeItems":
        return takeItems(state, me, action.slots, ctx);
    }
  },

  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  // An absent player takes whatever is first on the table.
  onTimeout(state, ctx) {
    if (state.phase !== "play") return { ok: true, state };
    const slots = state.market
      .flatMap((column, col) => column.map((id, row) => (id === null ? null : { col, row })))
      .filter((s) => s !== null)
      .slice(0, 2);
    if (slots.length > 0) return takeItems(state, state.current, slots, ctx);
    return takeRule(
      state,
      state.current,
      Math.max(
        0,
        state.piles.findIndex((p) => p.length > 0),
      ),
      ctx,
    );
  },
  onResume(state, ctx) {
    if (state.phase === "play") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    return {
      step: state.step,
      phase: state.phase,
      players: state.players,
      current: state.current,
      theme: state.theme,
      piles: state.piles.map((pile) => {
        const top = pile[0] ? cardOf(pile[0]) : null;
        return {
          left: pile.length,
          top: top
            ? {
                id: top.id,
                kind: top.kind,
                text: describeRule(top.rule, state.theme),
                worth: state.players.includes(viewer) ? scoreRule(top.rule, viewer, state.items) : null,
              }
            : null,
        };
      }),
      market: state.market.map((column) => column.map((id) => (id === null ? null : { kind: cardOf(id).kind }))),
      rules: Object.fromEntries(
        state.players.map((p) => [
          p,
          (state.rules[p] ?? []).map((id): RuleView => {
            const card = cardOf(id);
            return {
              id,
              kind: card.kind,
              text: describeRule(card.rule, state.theme),
              points: scoreRule(card.rule, p, state.items),
            };
          }),
        ]),
      ),
      items: state.items,
      totals: Object.fromEntries(state.players.map((p) => [p, totalOf(state, p)])),
      canFlip: state.phase === "play" && viewer === state.current && !state.flipped,
      mustTake: Math.min(2, onOffer(state)),
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const left = state.piles.reduce((n, p) => n + p.length, 0) + onOffer(state);
    return `凑一桌（主题：${state.theme.name}），还剩 ${left} 张牌，阶段：${state.phase}`;
  },
});
