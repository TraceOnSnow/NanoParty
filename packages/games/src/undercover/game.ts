/**
 * 「谁是卧底」— written-description variant.
 *
 * Everyone secretly gets a word; the undercover players get a similar but different one and
 * nobody is told their role. Each turn all surviving players write a description at the same
 * time (hidden until everyone is in), then discuss by voice and vote someone out on the page.
 * Full rule spec: docs/games/undercover.md
 */
import {
  type ContentItem,
  defineGame,
  type GameContext,
  type GameResult,
  type PlayerId,
  type ScoreAward,
} from "@apr/shared";
import { z } from "zod";

export const UNDERCOVER_CONTENT_TYPE = "word-pair";
export const DESCRIPTION_MAX = 40;
export const POINTS_CIVILIAN_WIN = 2;
export const POINTS_UNDERCOVER_WIN = 4;

const payloadSchema = z.object({ a: z.string(), b: z.string() });

const configSchema = z.object({
  /** Number of games (局) in this segment. 0 = keep going until the host ends it. */
  games: z.number().int().min(0).max(20).default(3),
  describeSeconds: z.number().int().min(0).max(600).default(120),
  /** Discussion happens by voice, so voting is untimed by default; the host can close the vote. */
  voteSeconds: z.number().int().min(0).max(900).default(0),
});
export type UndercoverConfig = z.infer<typeof configSchema>;

/**
 * Every action carries `step`, a counter that grows on each phase change, so a late or
 * retried action can never land in a later phase, turn or game.
 */
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("describe"),
    step: z.number().int(),
    text: z.string().trim().min(1).max(DESCRIPTION_MAX),
  }),
  z.object({ type: z.literal("vote"), step: z.number().int(), target: z.string() }),
  /** Host: close the current phase now / continue after a result. */
  z.object({ type: z.literal("advance"), step: z.number().int() }),
  /** Host: discard the current words before anything is settled and deal a new pair. No scoring. */
  z.object({ type: z.literal("skip"), step: z.number().int() }),
]);
export type UndercoverAction = z.infer<typeof actionSchema>;

export type Role = "civilian" | "undercover";

interface TurnRecord {
  turn: number;
  descriptions: Record<PlayerId, string>;
  votes: Record<PlayerId, PlayerId>;
  eliminated: PlayerId | null;
}

export interface UndercoverState {
  config: UndercoverConfig;
  game: number;
  turn: number;
  step: number;
  phase: "describe" | "vote" | "result" | "gameOver" | "finished";
  players: PlayerId[];
  alive: PlayerId[];
  roles: Record<PlayerId, Role>;
  words: { contentId: string; civilian: string; undercover: string };
  descriptions: Record<PlayerId, string>;
  votes: Record<PlayerId, PlayerId>;
  history: TurnRecord[];
  winner: Role | null;
  deadlineAt: number | null;
  endedBecause: "games" | "no-content" | null;
}

export interface UndercoverView {
  game: number;
  totalGames: number;
  turn: number;
  step: number;
  phase: UndercoverState["phase"];
  players: PlayerId[];
  alive: PlayerId[];
  undercoverCount: number;
  /** The viewer's own word; null for spectators who joined mid-game. */
  myWord: string | null;
  /** Who has acted in the current phase (described / voted). Contents stay hidden. */
  submitted: PlayerId[];
  myDescription: string | null;
  myVote: PlayerId | null;
  /** Descriptions of the current turn; hidden until everyone has submitted. */
  descriptions: Record<PlayerId, string> | null;
  /** Finished turns, including who voted for whom. */
  history: TurnRecord[];
  /** Roles made public so far: eliminated players, and everyone once the game is over. */
  revealedRoles: Record<PlayerId, Role>;
  outcome: { winner: Role; words: { civilian: string; undercover: string } } | null;
  deadlineAt: number | null;
  endedBecause: UndercoverState["endedBecause"];
}

export const undercoverCountFor = (players: number) => (players >= 6 ? 2 : 1);

const timer = (seconds: number, ctx: GameContext) => (seconds > 0 ? ctx.now + seconds * 1000 : null);

function drawPair(ctx: GameContext): { contentId: string; a: string; b: string } | null {
  for (let item: ContentItem | null = ctx.drawContent(); item; item = ctx.drawContent()) {
    const parsed = payloadSchema.safeParse(item.payload);
    if (parsed.success) return { contentId: item.id, ...parsed.data };
  }
  return null;
}

/** Deals words and roles for a new game. Returns false when no content is left. */
function deal(state: UndercoverState, ctx: GameContext): boolean {
  const pair = drawPair(ctx);
  if (!pair) return false;
  const flip = ctx.random() < 0.5;
  state.words = {
    contentId: pair.contentId,
    civilian: flip ? pair.a : pair.b,
    undercover: flip ? pair.b : pair.a,
  };
  state.players = [...ctx.players];
  state.alive = [...state.players];
  // Fisher–Yates with the injected RNG; the result is stored, so it is never re-rolled on recovery.
  const shuffled = [...state.players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as PlayerId, shuffled[i] as PlayerId];
  }
  const undercovers = new Set(shuffled.slice(0, undercoverCountFor(state.players.length)));
  state.roles = Object.fromEntries(state.players.map((p) => [p, undercovers.has(p) ? "undercover" : "civilian"]));
  state.turn = 1;
  state.history = [];
  state.winner = null;
  beginDescribe(state, ctx);
  return true;
}

function beginDescribe(state: UndercoverState, ctx: GameContext) {
  state.phase = "describe";
  state.step += 1;
  state.descriptions = {};
  state.votes = {};
  state.deadlineAt = timer(state.config.describeSeconds, ctx);
}

function beginVote(state: UndercoverState, ctx: GameContext) {
  state.phase = "vote";
  state.step += 1;
  state.deadlineAt = timer(state.config.voteSeconds, ctx);
}

function tally(state: UndercoverState): GameResult<UndercoverState> {
  const counts = new Map<PlayerId, number>();
  for (const target of Object.values(state.votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()].filter(([, n]) => n === top).map(([p]) => p);
  // A tie (or no votes at all) eliminates nobody.
  const eliminated = top > 0 && leaders.length === 1 ? (leaders[0] as PlayerId) : null;
  if (eliminated) state.alive = state.alive.filter((p) => p !== eliminated);
  state.history.push({ turn: state.turn, descriptions: state.descriptions, votes: state.votes, eliminated });
  state.step += 1;
  state.deadlineAt = null;

  const undercovers = state.alive.filter((p) => state.roles[p] === "undercover").length;
  const civilians = state.alive.length - undercovers;
  if (undercovers === 0) state.winner = "civilian";
  else if (undercovers >= civilians) state.winner = "undercover";

  if (!state.winner) {
    state.phase = "result";
    return { ok: true, state };
  }
  state.phase = "gameOver";
  const winner = state.winner;
  const scores: ScoreAward[] = state.players
    .filter((p) => state.roles[p] === winner)
    .map((p) => ({
      playerId: p,
      points: winner === "civilian" ? POINTS_CIVILIAN_WIN : POINTS_UNDERCOVER_WIN,
      reason: winner === "civilian" ? "平民获胜" : "卧底获胜",
      key: `g${state.game}:win:${p}`,
    }));
  return { ok: true, state, scores };
}

function finish(state: UndercoverState, why: UndercoverState["endedBecause"]): GameResult<UndercoverState> {
  state.phase = "finished";
  state.step += 1;
  state.endedBecause = why;
  state.deadlineAt = null;
  return { ok: true, state, finished: true };
}

/** Host "continue" / timeout: closes whatever phase is open. */
function advance(state: UndercoverState, ctx: GameContext): GameResult<UndercoverState> {
  switch (state.phase) {
    case "describe":
      beginVote(state, ctx);
      return { ok: true, state };
    case "vote":
      return tally(state);
    case "result":
      state.turn += 1;
      beginDescribe(state, ctx);
      return { ok: true, state };
    case "gameOver": {
      if (state.config.games > 0 && state.game >= state.config.games) return finish(state, "games");
      if (ctx.players.length < 3) return finish(state, "games");
      state.game += 1;
      return deal(state, ctx) ? { ok: true, state } : finish(state, "no-content");
    }
    default:
      return { ok: false, error: "游戏已结束" };
  }
}

export const undercoverGame = defineGame<UndercoverState, UndercoverAction, UndercoverView, UndercoverConfig>({
  meta: {
    id: "undercover",
    name: "谁是卧底",
    description: "每人拿到一个词，卧底的词略有不同。各自写一句描述，语音讨论后投票找出卧底。",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "系统给每人秘密发一个词：多数人（平民）相同，卧底拿到相近但不同的词，谁也不知道自己的身份（3–5 人 1 个卧底，6–8 人 2 个）。每轮所有存活玩家各写一句描述（不能直接写出自己的词），全部提交后统一公开；语音讨论后在网页上投票，得票最高者出局并公开身份，平票则无人出局。卧底全部出局则平民获胜；卧底人数不少于平民则卧底获胜。中途加入的玩家从下一局开始参与。",
    scoringSummary: `平民获胜：每位平民 +${POINTS_CIVILIAN_WIN} 分（含已出局的）。卧底获胜：每位卧底 +${POINTS_UNDERCOVER_WIN} 分。换词跳过的一局不计分。`,
    contentType: UNDERCOVER_CONTENT_TYPE,
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: UndercoverState = {
      config,
      game: 1,
      turn: 1,
      step: 0,
      phase: "describe",
      players: [],
      alive: [],
      roles: {},
      words: { contentId: "", civilian: "", undercover: "" },
      descriptions: {},
      votes: {},
      history: [],
      winner: null,
      deadlineAt: null,
      endedBecause: null,
    };
    if (!deal(state, ctx)) return { ok: false, error: "题库中没有可用的词语" };
    return { ok: true, state };
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作属于已结束的阶段" };
    const me = actor.playerId;

    switch (action.type) {
      case "describe": {
        if (state.phase !== "describe") return { ok: false, error: "现在不是描述阶段" };
        if (!state.alive.includes(me)) return { ok: false, error: "你不在本轮描述的玩家中" };
        if (me in state.descriptions) return { ok: false, error: "你已经提交过了" };
        const myWord = state.roles[me] === "undercover" ? state.words.undercover : state.words.civilian;
        if (action.text.toLowerCase().includes(myWord.toLowerCase())) {
          return { ok: false, error: "描述里不能直接出现你的词" };
        }
        state.descriptions[me] = action.text;
        if (state.alive.every((p) => p in state.descriptions)) beginVote(state, ctx);
        return { ok: true, state };
      }
      case "vote": {
        if (state.phase !== "vote") return { ok: false, error: "现在不是投票阶段" };
        if (!state.alive.includes(me)) return { ok: false, error: "已出局或未参与本局的玩家不能投票" };
        if (me in state.votes) return { ok: false, error: "你已经投过票了" };
        if (action.target === me) return { ok: false, error: "不能投给自己" };
        if (!state.alive.includes(action.target)) return { ok: false, error: "只能投给仍在场的玩家" };
        state.votes[me] = action.target;
        return state.alive.every((p) => p in state.votes) ? tally(state) : { ok: true, state };
      }
      case "advance": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
        return advance(state, ctx);
      }
      case "skip": {
        if (!actor.isHost) return { ok: false, error: "只有房主可以换词" };
        if (state.phase !== "describe" && state.phase !== "vote")
          return { ok: false, error: "这一局已经结算，不能跳过" };
        return deal(state, ctx) ? { ok: true, state } : finish(state, "no-content");
      }
    }
  },

  deadline: (state) => (state.phase === "describe" || state.phase === "vote" ? state.deadlineAt : null),

  onTimeout(state, ctx) {
    if (state.phase !== "describe" && state.phase !== "vote") return { ok: true, state };
    return advance(state, ctx);
  },

  onResume(state, ctx) {
    if (state.phase === "describe") state.deadlineAt = timer(state.config.describeSeconds, ctx);
    if (state.phase === "vote") state.deadlineAt = timer(state.config.voteSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const over = state.phase === "gameOver" || state.phase === "finished";
    const describing = state.phase === "describe";
    const revealedRoles: Record<PlayerId, Role> = {};
    for (const p of state.players) {
      if (over || !state.alive.includes(p)) revealedRoles[p] = state.roles[p] as Role;
    }
    const role = state.roles[viewer];
    return {
      game: state.game,
      totalGames: state.config.games,
      turn: state.turn,
      step: state.step,
      phase: state.phase,
      players: state.players,
      alive: state.alive,
      undercoverCount: undercoverCountFor(state.players.length),
      myWord: role ? (role === "undercover" ? state.words.undercover : state.words.civilian) : null,
      submitted: Object.keys(describing ? state.descriptions : state.phase === "vote" ? state.votes : {}),
      myDescription: state.descriptions[viewer] ?? null,
      myVote: state.phase === "vote" ? (state.votes[viewer] ?? null) : null,
      descriptions: state.phase === "vote" ? state.descriptions : null,
      history: state.history,
      revealedRoles,
      outcome:
        over && state.winner
          ? { winner: state.winner, words: { civilian: state.words.civilian, undercover: state.words.undercover } }
          : null,
      deadlineAt: state.deadlineAt,
      endedBecause: state.endedBecause,
    };
  },

  publicSummary(state) {
    const base = `谁是卧底 第 ${state.game} 局第 ${state.turn} 轮，阶段：${state.phase}，在场 ${state.alive.length}/${state.players.length} 人`;
    if (state.phase === "gameOver" || state.phase === "finished") {
      return `${base}，${state.winner === "civilian" ? "平民" : "卧底"}获胜，平民词「${state.words.civilian}」，卧底词「${state.words.undercover}」（已揭晓）`;
    }
    return `${base}（词语与身份未公开）`;
  },
});
