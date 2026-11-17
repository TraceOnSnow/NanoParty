/**
 * 「探洞寻宝」— everyone walks into the cave together. Each new card is either gems to share or
 * a hazard; after each card all players secretly choose to go on or to walk out with what they
 * carry. The second hazard of a kind sends everyone still inside home empty-handed.
 * Pure rules; no content, no AI. Rule spec: docs/games/delve.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const DELVE_GEMS = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17];
export const DELVE_HAZARDS = ["落石", "毒蛇", "蜘蛛", "毒气", "塌方"];
const HAZARD_COPIES = 3;
/** A relic is worth more the later it is carried out. */
export const relicValue = (found: number) => (found < 3 ? 5 : 10);
const POINTS_WIN = 3;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;

export type DelveCard =
  | { kind: "gems"; value: number; left: number }
  | { kind: "hazard"; hazard: string }
  | { kind: "relic"; taken: boolean };

const configSchema = z.object({
  rounds: z.number().int().min(1).max(8).default(5),
  chooseSeconds: z.number().int().min(0).max(600).default(0),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choose"), stay: z.boolean(), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface DelveState {
  config: Config;
  round: number;
  step: number;
  phase: "choose" | "roundOver" | "finished";
  players: PlayerId[];
  /** Cards not yet turned over this round. */
  deck: DelveCard[];
  path: DelveCard[];
  inside: PlayerId[];
  /** Gems picked up this round, lost if the cave collapses. */
  carried: Record<PlayerId, number>;
  /** Gems safely out. Kept from the other players until the end. */
  banked: Record<PlayerId, number>;
  choices: Record<PlayerId, boolean>;
  /** Who walked out after the last card, and what each of them took from the path. */
  lastLeft: { players: PlayerId[]; each: number; relics: number } | null;
  /** The hazard that closed the round, if one did. */
  collapsed: string | null;
  /** Hazard cards taken out of the game after they closed a round. */
  removed: string[];
  relicsFound: number;
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface DelveView {
  round: number;
  totalRounds: number;
  step: number;
  phase: DelveState["phase"];
  players: PlayerId[];
  path: DelveCard[];
  deckLeft: number;
  inside: PlayerId[];
  carried: Record<PlayerId, number>;
  myBanked: number | null;
  /** Everyone's total, only when the game is over. */
  banked: Record<PlayerId, number> | null;
  /** Who has decided (not what). */
  chosen: PlayerId[];
  myChoice: boolean | null;
  lastLeft: DelveState["lastLeft"];
  collapsed: string | null;
  removed: string[];
  winners: PlayerId[];
  deadlineAt: number | null;
}

function buildDeck(state: DelveState): DelveCard[] {
  const hazards = DELVE_HAZARDS.flatMap((hazard) => Array<string>(HAZARD_COPIES).fill(hazard));
  for (const gone of state.removed) hazards.splice(hazards.indexOf(gone), 1);
  return [
    ...DELVE_GEMS.map((value): DelveCard => ({ kind: "gems", value, left: 0 })),
    ...hazards.map((hazard): DelveCard => ({ kind: "hazard", hazard })),
    { kind: "relic", taken: false },
  ];
}

/** Turns over the next card. Returns false when it closed the round. */
function reveal(state: DelveState): boolean {
  const card = state.deck.shift();
  if (!card) return false;
  state.path.push(card);
  if (card.kind === "gems") {
    const each = Math.floor(card.value / state.inside.length);
    for (const p of state.inside) state.carried[p] = (state.carried[p] ?? 0) + each;
    card.left = card.value - each * state.inside.length;
  }
  if (card.kind === "hazard" && state.path.filter((c) => c.kind === "hazard" && c.hazard === card.hazard).length >= 2) {
    for (const p of state.inside) state.carried[p] = 0;
    state.inside = [];
    state.collapsed = card.hazard;
    state.removed.push(card.hazard);
    return false;
  }
  return true;
}

function closeRound(state: DelveState): GameResult<DelveState> {
  state.phase = "roundOver";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

function openRound(state: DelveState, ctx: GameContext): GameResult<DelveState> {
  state.round += 1;
  state.players = [...ctx.players];
  for (const p of state.players) state.banked[p] ??= 0;
  state.deck = shuffle(buildDeck(state), ctx.random);
  state.path = [];
  state.inside = [...state.players];
  state.carried = Object.fromEntries(state.players.map((p) => [p, 0]));
  state.choices = {};
  state.lastLeft = null;
  state.collapsed = null;
  reveal(state);
  state.phase = "choose";
  state.step += 1;
  state.deadlineAt = timer(state.config.chooseSeconds, ctx);
  return { ok: true, state };
}

/** Everyone inside has decided: leavers share what lies on the path, the rest see the next card. */
function resolve(state: DelveState, ctx: GameContext): GameResult<DelveState> {
  const leaving = state.inside.filter((p) => state.choices[p] === false);
  state.choices = {};
  state.lastLeft = null;
  if (leaving.length > 0) {
    let each = 0;
    for (const card of state.path) {
      if (card.kind !== "gems") continue;
      const share = Math.floor(card.left / leaving.length);
      each += share;
      card.left -= share * leaving.length;
    }
    let relics = 0;
    // A relic only fits in one backpack: it goes home with a player who leaves alone.
    if (leaving.length === 1) {
      for (const card of state.path) {
        if (card.kind === "relic" && !card.taken) {
          card.taken = true;
          relics += relicValue(state.relicsFound);
          state.relicsFound += 1;
        }
      }
    }
    for (const p of leaving) {
      state.banked[p] = (state.banked[p] ?? 0) + (state.carried[p] ?? 0) + each + relics;
      state.carried[p] = 0;
    }
    state.inside = state.inside.filter((p) => !leaving.includes(p));
    state.lastLeft = { players: leaving, each, relics };
  }
  if (state.inside.length === 0 || !reveal(state)) return closeRound(state);
  state.step += 1;
  state.deadlineAt = timer(state.config.chooseSeconds, ctx);
  return { ok: true, state };
}

function finish(state: DelveState): GameResult<DelveState> {
  state.phase = "finished";
  state.step += 1;
  const best = Math.max(...state.players.map((p) => state.banked[p] ?? 0));
  state.winners = state.players.filter((p) => (state.banked[p] ?? 0) === best);
  const scores: ScoreAward[] = state.winners.map((p) => ({
    playerId: p,
    points: POINTS_WIN,
    reason: "带出的宝石最多",
    key: `win:${p}`,
  }));
  return { ok: true, state, finished: true, scores };
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const delveGame = defineGame<DelveState, Action, DelveView, Config>({
  meta: {
    id: "delve",
    name: "探洞寻宝",
    description:
      "所有人一起进洞，每翻一张牌就同时暗中决定：继续走，还是带着手里的宝石回营地。同一种危险出现第二次，还在洞里的人全部空手而归。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `一共探 5 次洞。每次洞里依次翻牌：宝石牌——洞里的人平分，分不完的留在路上；危险牌（${DELVE_HAZARDS.join("、")}，各 ${HAZARD_COPIES} 张）——第一次出现没事，同一种出现第二次，洞里所有人这一趟拿到的宝石全丢，这次探洞结束，并且这张危险牌以后不再出现；遗物牌——只有独自一人离开时才能带走，前三件每件值 5，之后每件值 10。每翻一张牌，洞里的人同时暗中选择「继续」或「回营地」。回营地的人平分路上剩下的宝石，连同自己手里的一起存进帐篷，这一趟不再参与。帐篷里有多少宝石只有自己知道。`,
    scoringSummary: `探完所有洞后，帐篷里宝石最多的玩家 +${POINTS_WIN} 分（并列都得）。`,
    options: [
      { key: "rounds", label: "探洞次数", min: 1, max: 8, default: 5 },
      secondsOption("chooseSeconds", "每次决定限时", 0),
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    const state: DelveState = {
      config,
      round: 0,
      step: 0,
      phase: "choose",
      players: [],
      deck: [],
      path: [],
      inside: [],
      carried: {},
      banked: {},
      choices: {},
      lastLeft: null,
      collapsed: null,
      removed: [],
      relicsFound: 0,
      winners: [],
      deadlineAt: null,
    };
    return openRound(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以继续" };
      if (state.phase !== "roundOver") return { ok: false, error: "这一趟还没结束" };
      if (state.round >= state.config.rounds || !countOk(ctx.players.length)) return finish(state);
      return openRound(state, ctx);
    }
    if (state.phase !== "choose") return { ok: false, error: "这一趟已经结束" };
    if (!state.inside.includes(me)) return { ok: false, error: "你已经回营地了" };
    if (state.choices[me] !== undefined) return { ok: false, error: "你已经决定了" };
    state.choices[me] = action.stay;
    // Nothing is revealed (and the step does not move) until everyone inside has chosen.
    if (state.inside.every((p) => state.choices[p] !== undefined)) return resolve(state, ctx);
    return { ok: true, state };
  },

  atSafePoint: (state) => state.phase === "roundOver",
  deadline: (state) => (state.phase === "choose" ? state.deadlineAt : null),
  // Whoever has not decided in time walks out.
  onTimeout(state, ctx) {
    if (state.phase !== "choose") return { ok: true, state };
    for (const p of state.inside) state.choices[p] ??= false;
    return resolve(state, ctx);
  },
  onResume(state, ctx) {
    if (state.phase === "choose") state.deadlineAt = timer(state.config.chooseSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    return {
      round: state.round,
      totalRounds: state.config.rounds,
      step: state.step,
      phase: state.phase,
      players: state.players,
      path: state.path,
      deckLeft: state.deck.length,
      inside: state.inside,
      carried: state.carried,
      myBanked: state.banked[viewer] ?? null,
      banked: state.phase === "finished" ? state.banked : null,
      chosen: Object.keys(state.choices),
      myChoice: state.choices[viewer] ?? null,
      lastLeft: state.lastLeft,
      collapsed: state.collapsed,
      removed: state.removed,
      winners: state.winners,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    return `探洞寻宝 第 ${state.round} 趟，阶段：${state.phase}，已翻 ${state.path.length} 张，洞里还有 ${state.inside.length} 人（各人的选择和帐篷里的宝石未公开）`;
  },
});
