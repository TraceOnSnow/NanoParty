/**
 * 「别翻重」— flip cards one at a time and stop before you flip a number you already have.
 * The special cards are hostile: minus and halving cards to hand out, and actions that steal,
 * swap, discard or force more flips. Seven different numbers ends the round with a bonus.
 * Pure rules; no content, no AI. The only hidden thing is the order of the deck.
 * Rule spec: docs/games/flipout.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const FLIP_TARGET = 7;
export const FLIP_BONUS = 15;
const POINTS_WIN = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const LOG_SIZE = 8;

export type FlipAction = "onemore" | "flipfour" | "swap" | "steal" | "discard";
export type FlipCard =
  | { id: string; kind: "num"; value: number; special?: "zero" | "unlucky" | "lucky" }
  | { id: string; kind: "mod"; minus: number }
  | { id: string; kind: "mod"; half: true }
  | { id: string; kind: "act"; act: FlipAction };

/** 92 numbers (one 0, n copies of n up to 13), 6 modifiers, 10 actions. */
export function buildFlipDeck(): FlipCard[] {
  const deck: FlipCard[] = [{ id: "n0", kind: "num", value: 0, special: "zero" }];
  for (let value = 1; value <= 13; value++) {
    for (let copy = 1; copy <= value; copy++) {
      const special = copy === 1 && value === 7 ? "unlucky" : copy === 1 && value === 13 ? "lucky" : undefined;
      deck.push({ id: `n${value}-${copy}`, kind: "num", value, ...(special ? { special } : {}) });
    }
  }
  for (const minus of [2, 4, 6, 8, 10]) deck.push({ id: `m${minus}`, kind: "mod", minus });
  deck.push({ id: "mhalf", kind: "mod", half: true });
  for (const act of ["onemore", "flipfour", "swap", "steal", "discard"] as FlipAction[]) {
    deck.push({ id: `a-${act}-1`, kind: "act", act }, { id: `a-${act}-2`, kind: "act", act });
  }
  return deck;
}

const configSchema = z.object({
  target: z.number().int().min(50).max(500).default(200),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const pick = z.object({ player: z.string(), cardId: z.string() });
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hit"), step: z.number().int() }),
  z.object({ type: z.literal("stay"), step: z.number().int() }),
  /** Hand a drawn modifier, "one more" or "flip four" to a player. */
  z.object({ type: z.literal("give"), target: z.string(), step: z.number().int() }),
  /** Use a drawn steal / discard (one card) or swap (two cards of two players). */
  z.object({ type: z.literal("use"), cards: z.array(pick).min(1).max(2), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

type Status = "active" | "stayed" | "bust";
type Task =
  | { t: "draw"; p: PlayerId; thenStay?: boolean }
  | { t: "flip4"; p: PlayerId; left: number; held: FlipCard[] }
  | { t: "assign"; by: PlayerId; card: FlipCard }
  | { t: "stay"; p: PlayerId };

export interface FlipEvent {
  kind: "draw" | "bust" | "stay" | "flip7" | "give" | "steal" | "swap" | "discard" | "wipe" | "fizzle";
  by: PlayerId;
  target?: PlayerId;
  card?: FlipCard;
  other?: FlipCard;
}

export interface FlipoutState {
  config: Config;
  round: number;
  step: number;
  /** turn: hit or stay. assign: choose who gets a card. use: choose the card(s) for an action. */
  phase: "turn" | "assign" | "use" | "roundOver" | "gameOver" | "finished";
  players: PlayerId[];
  dealer: PlayerId;
  current: PlayerId;
  status: Record<PlayerId, Status>;
  cards: Record<PlayerId, FlipCard[]>;
  totals: Record<PlayerId, number>;
  /** Scores of the round just finished. */
  roundScores: Record<PlayerId, number> | null;
  flip7: PlayerId | null;
  deck: FlipCard[];
  discard: FlipCard[];
  tasks: Task[];
  pending: { by: PlayerId; card: FlipCard } | null;
  needAdvance: boolean;
  log: FlipEvent[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface FlipoutView {
  round: number;
  step: number;
  phase: FlipoutState["phase"];
  target: number;
  players: PlayerId[];
  dealer: PlayerId;
  current: PlayerId;
  status: Record<PlayerId, Status>;
  cards: Record<PlayerId, FlipCard[]>;
  totals: Record<PlayerId, number>;
  /** What each player would score if the round ended now. */
  preview: Record<PlayerId, number>;
  roundScores: Record<PlayerId, number> | null;
  flip7: PlayerId | null;
  deckLeft: number;
  pending: { by: PlayerId; card: FlipCard } | null;
  log: FlipEvent[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

const numbers = (cards: FlipCard[]) => cards.filter((c): c is Extract<FlipCard, { kind: "num" }> => c.kind === "num");
const hasZero = (cards: FlipCard[]) => numbers(cards).some((c) => c.special === "zero");

/** A repeated number busts, except that the lucky 13 lets its holder keep one more 13. */
export function isFlipBust(cards: FlipCard[]): boolean {
  const nums = numbers(cards);
  const lucky = nums.some((c) => c.special === "lucky");
  const seen = new Map<number, number>();
  for (const c of nums) seen.set(c.value, (seen.get(c.value) ?? 0) + 1);
  for (const [value, count] of seen) if (count > (value === 13 && lucky ? 2 : 1)) return true;
  return false;
}

/** Numbers, then halve (rounded down), then the minus cards, never below zero, then the bonus. */
export function flipRoundScore(cards: FlipCard[], status: Status, flip7: boolean): number {
  if (status === "bust") return 0;
  if (hasZero(cards) && !flip7) return 0;
  let total = numbers(cards).reduce((sum, c) => sum + c.value, 0);
  if (cards.some((c) => c.kind === "mod" && "half" in c)) total = Math.floor(total / 2);
  for (const c of cards) if (c.kind === "mod" && "minus" in c) total -= c.minus;
  return Math.max(0, total) + (flip7 ? FLIP_BONUS : 0);
}

const note = (state: FlipoutState, event: FlipEvent) => {
  state.log = [...state.log, event].slice(-LOG_SIZE);
};
const inPlay = (state: FlipoutState) => state.players.filter((p) => state.status[p] !== "bust");
const roundEnded = (state: FlipoutState) => state.phase === "roundOver" || state.phase === "gameOver";

function drawCard(state: FlipoutState, ctx: GameContext): FlipCard | null {
  if (state.deck.length === 0) {
    state.deck = shuffle(state.discard, ctx.random);
    state.discard = [];
  }
  return state.deck.shift() ?? null;
}

/** Checks a player after their cards changed: a bust, or seven numbers. */
function settle(state: FlipoutState, p: PlayerId) {
  if (state.status[p] === "bust" || state.flip7) return;
  const cards = state.cards[p] as FlipCard[];
  if (isFlipBust(cards)) {
    state.status[p] = "bust";
    note(state, { kind: "bust", by: p });
  } else if (numbers(cards).length >= FLIP_TARGET) {
    state.flip7 = p;
    note(state, { kind: "flip7", by: p });
  }
}

/** A card arrives in front of a player. The unlucky 7 sweeps away everything else they had. */
function receive(state: FlipoutState, p: PlayerId, card: FlipCard) {
  const mine = state.cards[p] as FlipCard[];
  if (card.kind === "num" && card.special === "unlucky" && mine.length > 0) {
    state.discard.push(...mine);
    state.cards[p] = [card];
    note(state, { kind: "wipe", by: p, card });
    return;
  }
  mine.push(card);
  settle(state, p);
}

function finishRound(state: FlipoutState): GameResult<FlipoutState> {
  // Cards still waiting to be handed out go back with the rest.
  for (const task of state.tasks) {
    if (task.t === "assign") state.discard.push(task.card);
    if (task.t === "flip4") state.discard.push(...task.held);
  }
  state.tasks = [];
  state.pending = null;
  state.step += 1;
  state.deadlineAt = null;
  state.roundScores = Object.fromEntries(
    state.players.map((p) => [p, flipRoundScore(state.cards[p] ?? [], state.status[p] ?? "bust", state.flip7 === p)]),
  );
  for (const p of state.players) state.totals[p] = (state.totals[p] ?? 0) + (state.roundScores[p] ?? 0);
  const best = Math.max(...state.players.map((p) => state.totals[p] ?? 0));
  if (best < state.config.target) {
    state.phase = "roundOver";
    return { ok: true, state };
  }
  state.phase = "gameOver";
  state.winners = state.players.filter((p) => state.totals[p] === best);
  const scores: ScoreAward[] = state.winners.map((p) => ({
    playerId: p,
    points: POINTS_WIN,
    reason: "总分最高",
    key: `win:${p}`,
  }));
  return { ok: true, state, scores };
}

/** Who an "assign" card may go to, and which cards a "use" action may touch. */
export function flipTargetsOf(state: FlipoutState, by: PlayerId, card: FlipCard): PlayerId[] {
  const live = inPlay(state);
  if (card.kind !== "act" || card.act === "onemore" || card.act === "flipfour") return live;
  const holders = live.filter((p) => (state.cards[p] ?? []).length > 0);
  if (card.act === "steal") return holders.filter((p) => p !== by);
  if (card.act === "swap") return holders.length >= 2 ? holders : [];
  return holders;
}
const needsCards = (card: FlipCard) =>
  card.kind === "act" && (card.act === "swap" || card.act === "steal" || card.act === "discard");

/** Runs queued work until a player has to decide something or the round is over. */
function run(state: FlipoutState, ctx: GameContext): GameResult<FlipoutState> {
  state.pending = null;
  while (state.tasks.length > 0 && !state.flip7) {
    const task = state.tasks.shift() as Task;
    if (task.t === "stay") {
      if (state.status[task.p] === "active") {
        state.status[task.p] = "stayed";
        note(state, { kind: "stay", by: task.p });
      }
      continue;
    }
    if (task.t === "assign") {
      if (state.status[task.by] === "bust") {
        state.discard.push(task.card);
        continue;
      }
      const targets = flipTargetsOf(state, task.by, task.card);
      if (targets.length === 0) {
        state.discard.push(task.card);
        note(state, { kind: "fizzle", by: task.by, card: task.card });
        continue;
      }
      if (!needsCards(task.card) && targets.length === 1) {
        give(state, task.by, task.card, targets[0] as PlayerId);
        continue;
      }
      state.pending = { by: task.by, card: task.card };
      state.phase = needsCards(task.card) ? "use" : "assign";
      state.step += 1;
      state.deadlineAt = timer(state.config.turnSeconds, ctx);
      return { ok: true, state };
    }
    if (state.status[task.p] === "bust") continue;
    const card = drawCard(state, ctx);
    if (!card) return finishRound(state);
    note(state, { kind: "draw", by: task.p, card });
    if (task.t === "draw") {
      if (card.kind === "num") receive(state, task.p, card);
      else state.tasks.unshift({ t: "assign", by: task.p, card });
      if (task.thenStay) {
        const at = state.tasks[0]?.t === "assign" ? 1 : 0;
        state.tasks.splice(at, 0, { t: "stay", p: task.p });
      }
      continue;
    }
    // One of four forced flips: numbers land at once, other cards wait until all four are out.
    if (card.kind === "num") receive(state, task.p, card);
    else task.held.push(card);
    if (state.status[task.p] === "bust") {
      state.discard.push(...task.held);
      continue;
    }
    if (task.left > 1) state.tasks.unshift({ ...task, left: task.left - 1 });
    else state.tasks.unshift(...task.held.map((held): Task => ({ t: "assign", by: task.p, card: held })));
  }

  const active = state.players.filter((p) => state.status[p] === "active");
  if (state.flip7 || active.length === 0) return finishRound(state);
  if (state.needAdvance) {
    const from = state.players.indexOf(state.current);
    const order = state.players.map((_, i) => state.players[(from + 1 + i) % state.players.length] as PlayerId);
    state.current = order.find((p) => state.status[p] === "active") as PlayerId;
    state.needAdvance = false;
  } else if (state.status[state.current] !== "active") {
    state.current = active[0] as PlayerId;
  }
  state.phase = "turn";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

function give(state: FlipoutState, by: PlayerId, card: FlipCard, target: PlayerId) {
  note(state, { kind: "give", by, target, card });
  if (card.kind === "mod") {
    receive(state, target, card);
    return;
  }
  state.discard.push(card);
  if (card.kind === "act" && card.act === "onemore") state.tasks.unshift({ t: "draw", p: target, thenStay: true });
  if (card.kind === "act" && card.act === "flipfour") state.tasks.unshift({ t: "flip4", p: target, left: 4, held: [] });
}

function take(state: FlipoutState, from: PlayerId, cardId: string): FlipCard | null {
  const cards = state.cards[from] ?? [];
  const index = cards.findIndex((c) => c.id === cardId);
  return index < 0 ? null : (cards.splice(index, 1)[0] as FlipCard);
}

function use(
  state: FlipoutState,
  picks: { player: PlayerId; cardId: string }[],
): { ok: true } | { ok: false; error: string } {
  const { by, card } = state.pending as { by: PlayerId; card: FlipCard };
  if (card.kind !== "act") return { ok: false, error: "这张牌不是这样用的" };
  const live = inPlay(state);
  const has = (p: PlayerId, id: string) => live.includes(p) && (state.cards[p] ?? []).some((c) => c.id === id);
  if (picks.some((x) => !has(x.player, x.cardId))) return { ok: false, error: "选的牌不在桌上" };
  const [a, b] = picks as [(typeof picks)[number], (typeof picks)[number] | undefined];
  if (card.act === "swap") {
    if (!b || a.player === b.player) return { ok: false, error: "交换要选两位玩家各一张牌" };
    const first = take(state, a.player, a.cardId) as FlipCard;
    const second = take(state, b.player, b.cardId) as FlipCard;
    note(state, { kind: "swap", by, target: a.player, card: first, other: second });
    receive(state, a.player, second);
    receive(state, b.player, first);
  } else {
    if (b) return { ok: false, error: "只能选一张牌" };
    if (card.act === "steal" && a.player === by) return { ok: false, error: "要偷别人的牌" };
    const taken = take(state, a.player, a.cardId) as FlipCard;
    note(state, { kind: card.act === "steal" ? "steal" : "discard", by, target: a.player, card: taken });
    if (card.act === "steal") receive(state, by, taken);
    else state.discard.push(taken);
  }
  state.discard.push(card);
  return { ok: true };
}

function deal(state: FlipoutState, ctx: GameContext): GameResult<FlipoutState> {
  state.players = [...ctx.players];
  for (const p of state.players) state.discard.push(...(state.cards[p] ?? []));
  state.cards = Object.fromEntries(state.players.map((p) => [p, []]));
  state.status = Object.fromEntries(state.players.map((p) => [p, "active" as Status]));
  for (const p of state.players) state.totals[p] ??= 0;
  state.dealer = state.players[(state.round - 1) % state.players.length] as PlayerId;
  state.current = state.dealer;
  state.needAdvance = true;
  state.flip7 = null;
  state.roundScores = null;
  state.winners = [];
  state.log = [];
  const from = state.players.indexOf(state.dealer);
  state.tasks = state.players.map((_, i) => ({
    t: "draw" as const,
    p: state.players[(from + 1 + i) % state.players.length] as PlayerId,
  }));
  return run(state, ctx);
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const flipoutGame = defineGame<FlipoutState, Action, FlipoutView, Config>({
  meta: {
    id: "flipout",
    name: "别翻重",
    description:
      "一张一张翻牌，翻到手里已有的数字就爆掉、这轮零分。减分牌可以塞给别人，行动牌能偷、能换、能逼人连翻四张。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `牌堆里数字几就有几张（1 有一张，13 有十三张，另有一张 0）。每轮先各发一张，然后轮流选「再翻一张」或「停」。翻到自己面前已有的数字就爆掉，这轮 0 分；停下就把面前数字加起来算分。集齐 ${FLIP_TARGET} 张不同的数字，这一轮立刻结束，你额外 +${FLIP_BONUS}。翻到减分牌（−2 到 −10、÷2）可以留着或塞给任何没爆的人；翻到行动牌：「再来一张」和「连翻四张」指定一个人执行，「偷」「换」「弃」由你对桌上的牌使用。三张特殊数字：0 让你这轮只算 0 分且不能停，除非集齐七张；厄运 7 会清掉你面前其它所有牌；幸运 13 允许你再多拿一张 13。`,
    scoringSummary: `有人总分达到目标分的那一轮结束后，总分最高的玩家 +${POINTS_WIN} 分（并列都得）。`,
    options: [
      { key: "target", label: "目标分", min: 50, max: 500, default: 200 },
      secondsOption("turnSeconds", "每步时限", 0),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: FlipoutState = {
      config,
      round: 1,
      step: 0,
      phase: "turn",
      players: [],
      dealer: "",
      current: "",
      status: {},
      cards: {},
      totals: {},
      roundScores: null,
      flip7: null,
      deck: shuffle(buildFlipDeck(), ctx.random),
      discard: [],
      tasks: [],
      pending: null,
      needAdvance: true,
      log: [],
      winners: [],
      deadlineAt: null,
    };
    return deal(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    switch (action.type) {
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
        if (!roundEnded(state)) return { ok: false, error: "这一轮还没结束" };
        if (state.phase === "gameOver" || !countOk(ctx.players.length)) {
          state.phase = "finished";
          state.step += 1;
          return { ok: true, state, finished: true };
        }
        state.round += 1;
        return deal(state, ctx);
      }
      case "hit":
      case "stay": {
        if (state.phase !== "turn") return { ok: false, error: "现在不能这样做" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (action.type === "stay") {
          if (hasZero(state.cards[me] ?? [])) return { ok: false, error: "你面前有 0，不能停，只能继续翻" };
          state.tasks.push({ t: "stay", p: me });
        } else {
          state.tasks.push({ t: "draw", p: me });
        }
        state.needAdvance = true;
        return run(state, ctx);
      }
      case "give": {
        if (state.phase !== "assign" || !state.pending) return { ok: false, error: "现在没有要分配的牌" };
        if (me !== state.pending.by) return { ok: false, error: "这张牌不是你翻到的" };
        if (!flipTargetsOf(state, me, state.pending.card).includes(action.target)) {
          return { ok: false, error: "不能给这位玩家" };
        }
        give(state, me, state.pending.card, action.target);
        return run(state, ctx);
      }
      case "use": {
        if (state.phase !== "use" || !state.pending) return { ok: false, error: "现在没有要使用的行动牌" };
        if (me !== state.pending.by) return { ok: false, error: "这张牌不是你翻到的" };
        const used = use(state, action.cards);
        if (!used.ok) return used;
        return run(state, ctx);
      }
    }
  },

  atSafePoint: (state) => roundEnded(state),
  deadline: (state) => (roundEnded(state) || state.phase === "finished" ? null : state.deadlineAt),
  // An absent player stays (or flips, when holding the 0), keeps a drawn card, and wastes an action.
  onTimeout(state, ctx) {
    if (state.phase === "turn") {
      const me = state.current;
      state.tasks.push(hasZero(state.cards[me] ?? []) ? { t: "draw", p: me } : { t: "stay", p: me });
      state.needAdvance = true;
      return run(state, ctx);
    }
    if ((state.phase === "assign" || state.phase === "use") && state.pending) {
      const { by, card } = state.pending;
      if (state.phase === "assign") give(state, by, card, by);
      else {
        state.discard.push(card);
        note(state, { kind: "fizzle", by, card });
      }
      return run(state, ctx);
    }
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (!roundEnded(state) && state.phase !== "finished") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state) {
    return {
      round: state.round,
      step: state.step,
      phase: state.phase,
      target: state.config.target,
      players: state.players,
      dealer: state.dealer,
      current: state.current,
      status: state.status,
      cards: state.cards,
      totals: state.totals,
      preview: Object.fromEntries(
        state.players.map((p) => [
          p,
          flipRoundScore(state.cards[p] ?? [], state.status[p] ?? "bust", state.flip7 === p),
        ]),
      ),
      roundScores: state.roundScores,
      flip7: state.flip7,
      deckLeft: state.deck.length,
      pending: state.pending,
      log: state.log,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const totals = state.players.map((p) => `${p} ${state.totals[p] ?? 0}`).join("，");
    return `别翻重 第 ${state.round} 轮，阶段：${state.phase}，目标 ${state.config.target} 分；总分：${totals}`;
  },
});
