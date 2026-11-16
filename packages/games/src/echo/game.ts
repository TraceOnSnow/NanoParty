/**
 * 「撞答案」— everyone secretly writes six answers to the same category. On your turn you show
 * one: if somebody else wrote it too you take the pot, if nobody did you pay into it. Or spend
 * the turn betting on how many answers will have matched by the end of the round.
 * Topics come from the shared category bank; no AI. Rule spec: docs/games/echo.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import {
  applyPick,
  emptyPick,
  isPickAction,
  offerToPick,
  openPick,
  type PickState,
  type PickView,
  pickActionSchemas,
  pickOnTimeout,
  pickSecondsOption,
  pickView,
  rotatePicker,
} from "../pick.ts";
import { norm, roundsOption, secondsOption, timer } from "../util.ts";

const ANSWERS = 6;
const ANSWER_MAX = 20;
const START_MONEY = 150;
const POT_START = 30;
const COST_MISS = 10;
const COST_INVALID = 20;
const COST_BET = 10;
const BET_MAX_NUMBER = 12;
const BETS_PER_NUMBER = 2;
const BETS_PER_PLAYER = 4;
/** Extra money added to the round's prize, growing by round. */
const bonusOf = (round: number) => 30 + 20 * (round - 1);
const POINTS_WIN = 3;

const payload = z.object({ name: z.string(), hint: z.string().optional() });
const configSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(3),
  pickSeconds: z.number().int().min(0).max(600).default(60),
  writeSeconds: z.number().int().min(0).max(600).default(0),
  turnSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({ type: z.literal("write"), answers: z.array(z.string().max(ANSWER_MAX)), step: z.number().int() }),
  /** Host: stop waiting for the players who have not handed in their answers. */
  z.object({ type: z.literal("begin"), step: z.number().int() }),
  z.object({ type: z.literal("play"), index: z.number().int().min(0), step: z.number().int() }),
  z.object({ type: z.literal("bet"), number: z.number().int().min(0).max(BET_MAX_NUMBER), step: z.number().int() }),
  /** "Mine means the same": show one of your answers as a match for the one just played. */
  z.object({ type: z.literal("join"), index: z.number().int().min(0), step: z.number().int() }),
  /** Host: a joined answer does not really match. */
  z.object({ type: z.literal("reject"), player: z.string(), step: z.number().int() }),
  /** Host: the answer just played does not fit the topic. */
  z.object({ type: z.literal("invalid"), step: z.number().int() }),
  /** Close the round once somebody has shown all their answers. */
  z.object({ type: z.literal("settle"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

interface Answer {
  text: string;
  shown: boolean;
}
interface OpenPlay {
  by: PlayerId;
  text: string;
  /** Players whose answer counts as the same; `exact` ones were matched by the program. */
  joined: { player: PlayerId; text: string; exact: boolean }[];
  invalid: boolean;
}
interface Outcome {
  by: PlayerId;
  text: string;
  kind: "match" | "miss" | "invalid";
  with: PlayerId[];
  amount: number;
}

export interface EchoState {
  config: Config;
  pick: PickState<z.infer<typeof payload>>;
  round: number;
  step: number;
  /** lastCall: someone has shown everything; matches can still be claimed before settling. */
  phase: "pick" | "write" | "play" | "lastCall" | "roundOver" | "finished";
  category: { contentId: string | null; name: string; hint?: string };
  setter: PlayerId;
  /** Everyone at the table this round; `answers` only has those who handed theirs in. */
  players: PlayerId[];
  answers: Record<PlayerId, Answer[]>;
  current: PlayerId;
  money: Record<PlayerId, number>;
  pot: number;
  bonus: number;
  /** How many played answers found a match this round. */
  groups: number;
  bets: { player: PlayerId; number: number }[];
  open: OpenPlay | null;
  last: Outcome | null;
  /** Round result: who bet right and what each of them took. */
  payout: { winners: PlayerId[]; share: number; pool: number } | null;
  winners: PlayerId[];
  deadlineAt: number | null;
  endedBecause: "rounds" | "no-content" | "too-few" | null;
}

export interface EchoView {
  round: number;
  totalRounds: number;
  step: number;
  phase: EchoState["phase"];
  pick: PickView | null;
  category: { name: string; hint?: string };
  setter: PlayerId;
  players: PlayerId[];
  /** Who has handed in their answers. */
  written: PlayerId[];
  myAnswers: Answer[] | null;
  /** Answers shown so far (all of them once the round is over). */
  shown: Record<PlayerId, string[]>;
  hiddenCount: Record<PlayerId, number>;
  current: PlayerId;
  money: Record<PlayerId, number>;
  pot: number;
  bonus: number;
  groups: number;
  bets: { player: PlayerId; number: number }[];
  open: OpenPlay | null;
  last: Outcome | null;
  payout: EchoState["payout"];
  winners: PlayerId[];
  deadlineAt: number | null;
  endedBecause: EchoState["endedBecause"];
}

const writers = (state: EchoState) => state.players.filter((p) => state.answers[p]);
const hidden = (state: EchoState, p: PlayerId) => (state.answers[p] ?? []).filter((a) => !a.shown);
const someoneOut = (state: EchoState) => writers(state).some((p) => hidden(state, p).length === 0);
const pay = (state: EchoState, p: PlayerId, amount: number) => {
  state.money[p] = (state.money[p] ?? 0) - amount;
  state.pot += amount;
};

function finish(state: EchoState, why: EchoState["endedBecause"]): GameResult<EchoState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = why;
  state.deadlineAt = null;
  const best = Math.max(...Object.values(state.money));
  state.winners = why === "rounds" ? Object.keys(state.money).filter((p) => state.money[p] === best) : [];
  const scores: ScoreAward[] = state.winners.map((p) => ({
    playerId: p,
    points: POINTS_WIN,
    reason: "钱最多",
    key: `win:${p}`,
  }));
  return { ok: true, state, finished: true, scores };
}

function openRound(state: EchoState, ctx: GameContext): GameResult<EchoState> {
  state.phase = "pick";
  state.step += 1;
  openPick(state.pick, rotatePicker(state.pick, ctx.players), payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

const PICK = { schema: payload, contentType: "category", allowCustom: true };

function startRound(state: EchoState, category: EchoState["category"], ctx: GameContext) {
  state.round += 1;
  state.category = category;
  state.setter = state.pick.picker;
  state.players = [...ctx.players];
  for (const p of state.players) state.money[p] ??= START_MONEY;
  state.answers = {};
  state.bonus = bonusOf(state.round);
  state.groups = 0;
  state.bets = [];
  state.open = null;
  state.last = null;
  state.payout = null;
  state.phase = "write";
  state.step += 1;
  state.deadlineAt = timer(state.config.writeSeconds, ctx);
}

/** Play starts with the player after the topic setter. */
function beginPlay(state: EchoState, ctx: GameContext): GameResult<EchoState> {
  const order = writers(state);
  if (order.length < 2) return closeRound(state, false);
  const from = state.players.indexOf(state.setter);
  const seats = state.players.map((_, i) => state.players[(from + 1 + i) % state.players.length] as PlayerId);
  state.current = seats.find((p) => state.answers[p]) as PlayerId;
  state.phase = "play";
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

/** Pays out the answer that was just played: the pot for a match, a fine otherwise. */
function settleOpen(state: EchoState) {
  const open = state.open;
  if (!open) return;
  state.open = null;
  if (open.invalid) {
    pay(state, open.by, COST_INVALID);
    state.last = { by: open.by, text: open.text, kind: "invalid", with: [], amount: COST_INVALID };
  } else if (open.joined.length > 0) {
    const amount = state.pot;
    state.money[open.by] = (state.money[open.by] ?? 0) + amount;
    state.pot = POT_START;
    state.groups += 1;
    state.last = { by: open.by, text: open.text, kind: "match", with: open.joined.map((j) => j.player), amount };
  } else {
    pay(state, open.by, COST_MISS);
    state.last = { by: open.by, text: open.text, kind: "miss", with: [], amount: COST_MISS };
  }
}

/** Ends the round: those who bet on the final number of matches share the pot and the bonus. */
function closeRound(state: EchoState, withPayout: boolean): GameResult<EchoState> {
  settleOpen(state);
  if (withPayout) {
    const winners = [...new Set(state.bets.filter((b) => b.number === state.groups).map((b) => b.player))];
    const pool = state.pot + state.bonus;
    if (winners.length > 0) {
      const share = Math.floor(pool / winners.length / 10) * 10;
      for (const p of winners) state.money[p] = (state.money[p] ?? 0) + share;
      // What cannot be split evenly goes to whoever bet right first.
      state.money[winners[0] as PlayerId] = (state.money[winners[0] as PlayerId] ?? 0) + pool - share * winners.length;
      state.pot = POT_START;
      state.payout = { winners, share, pool };
    } else {
      state.pot = pool;
      state.payout = { winners: [], share: 0, pool };
    }
  }
  state.phase = "roundOver";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

function afterReveal(state: EchoState, ctx: GameContext, advance: boolean): GameResult<EchoState> {
  state.step += 1;
  if (someoneOut(state)) {
    state.phase = "lastCall";
    state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return { ok: true, state };
  }
  if (advance) {
    const order = writers(state);
    state.current = order[(order.indexOf(state.current) + 1) % order.length] as PlayerId;
    state.deadlineAt = timer(state.config.turnSeconds, ctx);
  }
  return { ok: true, state };
}

function play(state: EchoState, me: PlayerId, index: number, ctx: GameContext): GameResult<EchoState> {
  const answer = state.answers[me]?.[index];
  if (!answer || answer.shown) return { ok: false, error: "这个答案已经亮过了" };
  settleOpen(state);
  answer.shown = true;
  const open: OpenPlay = { by: me, text: answer.text, joined: [], invalid: false };
  for (const p of writers(state)) {
    if (p === me) continue;
    const same = hidden(state, p).find((a) => norm(a.text) === norm(answer.text));
    if (same) {
      same.shown = true;
      open.joined.push({ player: p, text: same.text, exact: true });
    }
  }
  state.open = open;
  return afterReveal(state, ctx, true);
}

export const echoGame = defineGame<EchoState, Action, EchoView, Config>({
  meta: {
    id: "echo",
    name: "撞答案",
    description: "同一个题目，每人偷偷写六个答案。轮到你亮一个：有人和你写得一样，奖池归你；没人一样，你往奖池里交钱。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary: `每轮先由出题人选一个类别（比如「水果」），所有人各自写 ${ANSWERS} 个不重复的答案，互相看不到。然后从出题人的下家开始轮流行动，二选一：亮出一个自己的答案——别人写了一样的也必须亮出来，你拿走奖池里所有的钱（奖池再补 ${POT_START}）；没人和你一样，你往奖池交 ${COST_MISS}；答案不符合题目，交 ${COST_INVALID}。或者押注——交 ${COST_BET}，押这一轮结束时一共会撞出几组（每个数字最多 ${BETS_PER_NUMBER} 注，每人每轮最多 ${BETS_PER_PLAYER} 注）。意思一样但写法不同的答案，持有者可以自己点「我这个也算」，房主可以否决。有人把 ${ANSWERS} 个答案全部亮完，这一轮结束：押中的人平分奖池加本轮奖金，没人押中就滚到下一轮。每人开局 ${START_MONEY}。`,
    scoringSummary: `打完所有轮后，钱最多的玩家 +${POINTS_WIN} 分（并列都得）。`,
    contentType: "category",
    options: [
      { key: "rounds", label: "轮数", min: 1, max: 10, default: 3 },
      secondsOption("writeSeconds", "写答案限时", 0),
      secondsOption("turnSeconds", "每步时限", 0),
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3 || ctx.players.length > 8) return { ok: false, error: "需要 3–8 名玩家" };
    const state: EchoState = {
      config,
      pick: emptyPick(),
      round: 0,
      step: 0,
      phase: "pick",
      category: { contentId: null, name: "" },
      setter: "",
      players: [...ctx.players],
      answers: {},
      current: "",
      money: Object.fromEntries(ctx.players.map((p) => [p, START_MONEY])),
      pot: POT_START,
      bonus: 0,
      groups: 0,
      bets: [],
      open: null,
      last: null,
      payout: null,
      winners: [],
      deadlineAt: null,
      endedBecause: null,
    };
    return openRound(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的题目已经确定了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startRound(state, { contentId: r.chosen.contentId, ...r.chosen.data }, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (state.phase === "pick") return { ok: false, error: "出题人正在选题，稍等一下" };
    const playing = state.phase === "play" || state.phase === "lastCall";
    switch (action.type) {
      case "write": {
        if (state.phase !== "write") return { ok: false, error: "现在不能改答案了" };
        if (!state.players.includes(me)) return { ok: false, error: "下一轮再加入" };
        const texts = action.answers.map((t) => t.trim());
        if (texts.length !== ANSWERS || texts.some((t) => !norm(t)))
          return { ok: false, error: `要写满 ${ANSWERS} 个答案` };
        if (new Set(texts.map(norm)).size !== ANSWERS) return { ok: false, error: "六个答案不能重复" };
        state.answers[me] = texts.map((text) => ({ text, shown: false }));
        if (writers(state).length === state.players.length) return beginPlay(state, ctx);
        state.step += 1;
        return { ok: true, state };
      }
      case "begin": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以不等了直接开始" };
        if (state.phase !== "write") return { ok: false, error: "已经开始了" };
        if (writers(state).length < 2) return { ok: false, error: "至少要有两个人写完" };
        return beginPlay(state, ctx);
      }
      case "play": {
        if (state.phase !== "play") return { ok: false, error: "现在不能亮答案" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        return play(state, me, action.index, ctx);
      }
      case "bet": {
        if (state.phase !== "play") return { ok: false, error: "现在不能押注" };
        if (me !== state.current) return { ok: false, error: "还没轮到你" };
        if (action.number < 0 || action.number > BET_MAX_NUMBER) return { ok: false, error: "没有这个数字" };
        if (state.bets.filter((b) => b.player === me).length >= BETS_PER_PLAYER) {
          return { ok: false, error: `每轮最多押 ${BETS_PER_PLAYER} 注` };
        }
        if (state.bets.filter((b) => b.number === action.number).length >= BETS_PER_NUMBER) {
          return { ok: false, error: "这个数字已经押满了" };
        }
        settleOpen(state);
        pay(state, me, COST_BET);
        state.bets.push({ player: me, number: action.number });
        return afterReveal(state, ctx, true);
      }
      case "join": {
        if (!playing || !state.open) return { ok: false, error: "现在没有可以认领的答案" };
        if (state.open.by === me) return { ok: false, error: "这是你自己亮的答案" };
        if (state.open.joined.some((j) => j.player === me)) return { ok: false, error: "你已经亮过一个了" };
        const answer = state.answers[me]?.[action.index];
        if (!answer || answer.shown) return { ok: false, error: "这个答案已经亮过了" };
        answer.shown = true;
        state.open.joined.push({ player: me, text: answer.text, exact: false });
        return afterReveal(state, ctx, false);
      }
      case "reject": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以否决" };
        if (!playing || !state.open) return { ok: false, error: "现在没有可以否决的答案" };
        const before = state.open.joined.length;
        state.open.joined = state.open.joined.filter((j) => j.exact || j.player !== action.player);
        if (state.open.joined.length === before) return { ok: false, error: "这个答案不能否决" };
        state.step += 1;
        return { ok: true, state };
      }
      case "invalid": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以判定不符合题目" };
        if (!playing || !state.open) return { ok: false, error: "现在没有可以判定的答案" };
        state.open.invalid = !state.open.invalid;
        state.step += 1;
        return { ok: true, state };
      }
      case "settle": {
        if (state.phase !== "lastCall") return { ok: false, error: "这一轮还没到结算的时候" };
        if (!actor.isHost && me !== state.current) return { ok: false, error: "由房主或刚行动的人来结算" };
        return closeRound(state, true);
      }
      case "next": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以进入下一轮" };
        if (state.phase !== "roundOver") return { ok: false, error: "这一轮还没结束" };
        if (state.round >= state.config.rounds) return finish(state, "rounds");
        if (ctx.players.length < 3) return finish(state, "too-few");
        return openRound(state, ctx);
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "write" || state.phase === "play" ? `r${state.round}` : null),
    voters: (state) => state.players,
    apply: (state) => closeRound(state, false),
  },
  currentContentId: (state) => (state.phase === "pick" || state.phase === "finished" ? null : state.category.contentId),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "撞答案");
    return r.ok ? { ok: true, state, message: r.message } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "roundOver",
  deadline: (state) => (state.phase === "roundOver" || state.phase === "finished" ? null : state.deadlineAt),
  // Picking: first candidate. Writing: start with whoever is done. A turn: show the first hidden answer.
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return finish(state, "no-content");
      startRound(state, { contentId: c.contentId, ...c.data }, ctx);
      return { ok: true, state };
    }
    if (state.phase === "write") return beginPlay(state, ctx);
    if (state.phase === "lastCall") return closeRound(state, true);
    if (state.phase === "play") {
      const index = (state.answers[state.current] ?? []).findIndex((a) => !a.shown);
      return play(state, state.current, index, ctx);
    }
    return { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "write") state.deadlineAt = timer(state.config.writeSeconds, ctx);
    if (state.phase === "play" || state.phase === "lastCall") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const all = state.phase === "roundOver" || state.phase === "finished";
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      pick: state.phase === "pick" ? pickView(state.pick, (d) => d.name, PICK.allowCustom) : null,
      category: { name: state.category.name, hint: state.category.hint },
      setter: state.setter,
      players: state.players,
      written: writers(state),
      myAnswers: state.answers[viewer] ?? null,
      shown: Object.fromEntries(
        writers(state).map((p) => [p, (state.answers[p] ?? []).filter((a) => all || a.shown).map((a) => a.text)]),
      ),
      hiddenCount: Object.fromEntries(writers(state).map((p) => [p, hidden(state, p).length])),
      current: state.current,
      money: state.money,
      pot: state.pot,
      bonus: state.bonus,
      groups: state.groups,
      bets: state.bets,
      open: state.open,
      last: state.last,
      payout: state.payout,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
      endedBecause: state.endedBecause,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `撞答案 第 ${state.round + 1} 轮：出题人正在选题，尚未开始`;
    const money = state.players.map((p) => `${p} ${state.money[p] ?? 0}`).join("，");
    return `撞答案 第 ${state.round} 轮，题目「${state.category.name}」，阶段：${state.phase}，已撞出 ${state.groups} 组，奖池 ${state.pot}；钱：${money}（没亮出的答案不公开）`;
  },
});
