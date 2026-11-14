/**
 * 「禁词描述」— describe the word out loud without saying any of the forbidden words while the
 * others type guesses. One player watches the card as referee. Rule spec: docs/games/taboo.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { drawPayload, norm, timer } from "../util.ts";

const payload = z.object({
  word: z.string().trim().min(1).max(12),
  taboo: z.array(z.string().trim().min(1).max(12)).min(2).max(5),
});
/** Payload shape of this game's content type. */
export const tabooContentSchema = payload;
type Card = z.infer<typeof payload>;

const configSchema = z.object({
  /** How many times each player describes. */
  laps: z.number().int().min(1).max(5).default(1),
  turnSeconds: z.number().int().min(20).max(300).default(75),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("guess"), step: z.number().int(), text: z.string().trim().min(1).max(20) }),
  /** Describer gives up on this card. */
  z.object({ type: z.literal("pass"), step: z.number().int() }),
  /** Referee: a forbidden word was said. */
  z.object({ type: z.literal("foul"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

interface Played {
  word: string;
  outcome: "guessed" | "passed" | "foul" | "timeout";
  by: PlayerId | null;
}

export interface TabooState {
  config: Config;
  turn: number;
  totalTurns: number;
  step: number;
  phase: "describe" | "turnOver" | "finished";
  order: PlayerId[];
  describer: PlayerId;
  referee: PlayerId;
  card: { contentId: string; data: Card } | null;
  /** Number of the card within this turn, for unique score keys. */
  cardNo: number;
  guesses: { by: PlayerId; text: string }[];
  played: Played[];
  deadlineAt: number | null;
  endedBecause: "turns" | "no-content" | null;
}

export interface TabooView {
  turn: number;
  totalTurns: number;
  step: number;
  phase: TabooState["phase"];
  describer: PlayerId;
  referee: PlayerId;
  /** Only the describer and the referee see the card. */
  card: Card | null;
  guesses: TabooState["guesses"];
  played: Played[];
  deadlineAt: number | null;
  endedBecause: TabooState["endedBecause"];
}

function endTurn(state: TabooState, outcome?: Played["outcome"]): GameResult<TabooState> {
  if (state.card && outcome) state.played.push({ word: state.card.data.word, outcome, by: null });
  state.card = null;
  state.phase = "turnOver";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

/** Puts the next card in front of the describer; ends the turn if the library is empty. */
function nextCard(state: TabooState, ctx: GameContext, scores?: ScoreAward[]): GameResult<TabooState> {
  state.card = drawPayload(ctx, payload);
  state.cardNo += 1;
  state.guesses = [];
  state.step += 1;
  if (!state.card) {
    state.endedBecause = "no-content";
    const r = endTurn(state);
    return r.ok ? { ...r, scores } : r;
  }
  return { ok: true, state, scores };
}

function startTurn(state: TabooState, ctx: GameContext): GameResult<TabooState> {
  // Players who joined since the last turn are added to the end of the order.
  for (const p of ctx.players) if (!state.order.includes(p)) state.order.push(p);
  const present = state.order.filter((p) => ctx.players.includes(p));
  state.describer = present[(state.turn - 1) % present.length] as PlayerId;
  state.referee = present[state.turn % present.length] as PlayerId;
  state.played = [];
  state.cardNo = 0;
  state.phase = "describe";
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return nextCard(state, ctx);
}

export const tabooGame = defineGame<TabooState, Action, TabooView, Config>({
  meta: {
    id: "taboo",
    name: "禁词描述",
    description: "在语音里描述一个词，但有几个最顺口的词不许说。其他人在网页上抢答，裁判盯着你有没有犯规。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每回合一名描述者（轮流）和一名裁判（下一位玩家）能看到词卡：目标词和几个禁词。描述者在语音里描述目标词，不能说出目标词、禁词或它们的一部分，也不能用谐音和外语；其他人在网页上输入猜测，猜中自动换下一张。描述者可以跳过当前词；裁判听到禁词就按「犯规」，这张作废换下一张。限时结束后轮到下一位。裁判不能猜。",
    scoringSummary: "每猜中一个词：猜中的人 +1，描述者 +1。跳过和犯规不扣分。",
    contentType: "taboo-card",
    options: [
      { key: "laps", label: "每人描述次数", min: 1, max: 5, default: 1 },
      { key: "turnSeconds", label: "每回合时限（秒）", min: 20, max: 300, default: 75 },
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: TabooState = {
      config,
      turn: 1,
      totalTurns: config.laps * ctx.players.length,
      step: 0,
      phase: "describe",
      order: [...ctx.players],
      describer: "",
      referee: "",
      card: null,
      cardNo: 0,
      guesses: [],
      played: [],
      deadlineAt: null,
      endedBecause: null,
    };
    const r = startTurn(state, ctx);
    if (r.ok && state.endedBecause === "no-content") return { ok: false, error: "题库中没有可用的词卡" };
    return r;
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
      if (state.phase !== "turnOver") return { ok: false, error: "这一回合还没结束" };
      if (state.turn >= state.totalTurns || state.endedBecause === "no-content" || ctx.players.length < 3) {
        state.endedBecause ??= "turns";
        state.phase = "finished";
        state.step += 1;
        return { ok: true, state, finished: true };
      }
      state.turn += 1;
      return startTurn(state, ctx);
    }
    if (state.phase !== "describe" || !state.card) return { ok: false, error: "这一回合已经结束" };
    const card = state.card;
    switch (action.type) {
      case "guess": {
        if (me === state.describer || me === state.referee) return { ok: false, error: "你看得到词卡，不能猜" };
        if (norm(action.text) !== norm(card.data.word)) {
          state.guesses.push({ by: me, text: action.text });
          if (state.guesses.length > 30) state.guesses.shift();
          return { ok: true, state };
        }
        state.played.push({ word: card.data.word, outcome: "guessed", by: me });
        const key = `t${state.turn}:c${state.cardNo}`;
        return nextCard(state, ctx, [
          { playerId: me, points: 1, reason: "猜中", key: `${key}:guess` },
          { playerId: state.describer, points: 1, reason: "描述被猜中", key: `${key}:describe` },
        ]);
      }
      case "pass": {
        if (me !== state.describer) return { ok: false, error: "只有描述者可以跳过" };
        state.played.push({ word: card.data.word, outcome: "passed", by: null });
        return nextCard(state, ctx);
      }
      case "foul": {
        if (me !== state.referee) return { ok: false, error: "只有裁判可以判犯规" };
        state.played.push({ word: card.data.word, outcome: "foul", by: null });
        return nextCard(state, ctx);
      }
    }
  },

  currentContentId: (state) => (state.phase === "turnOver" ? null : (state.card?.contentId ?? null)),
  atSafePoint: (state) => state.phase === "turnOver",
  deadline: (state) => (state.phase === "describe" ? state.deadlineAt : null),
  onTimeout: (state) => (state.phase === "describe" ? endTurn(state, "timeout") : { ok: true, state }),
  onResume(state, ctx) {
    if (state.phase === "describe") state.deadlineAt = timer(state.config.turnSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const sees = viewer === state.describer || viewer === state.referee;
    return {
      turn: state.turn,
      totalTurns: state.totalTurns,
      step: state.step,
      phase: state.phase,
      describer: state.describer,
      referee: state.referee,
      card: sees && state.card ? state.card.data : null,
      guesses: state.guesses,
      played: state.played,
      deadlineAt: state.deadlineAt,
      endedBecause: state.endedBecause,
    };
  },

  publicSummary(state) {
    const done = state.played.map((p) => `${p.word}(${p.outcome})`).join("、") || "无";
    return `禁词描述 第 ${state.turn}/${state.totalTurns} 回合，阶段：${state.phase}。本回合已结束的词：${done}（当前词卡未公开）`;
  },
});
