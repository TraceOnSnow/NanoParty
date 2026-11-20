/**
 * 「数牌拆拼」— number tiles in four colours. Lay down runs (same colour, consecutive) and groups
 * (same number, different colours); on your turn you may take the whole table apart and put it
 * back together, as long as every set is valid again and you added at least one tile of your own.
 * First to empty their rack wins.
 * Pure rules; no content, no AI. Rule spec: docs/games/meld.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId, type ScoreAward } from "@apr/shared";
import { z } from "zod";
import { secondsOption, shuffle, timer } from "../util.ts";

export const MELD_COLORS = ["红", "蓝", "黄", "黑"];
export const MELD_MAX = 13;
export const MELD_HAND = 14;
/** What a first play must add up to. */
export const MELD_OPENING = 30;
/** What a wild tile left in a rack costs at the end. */
export const MELD_WILD_PENALTY = 30;
const WILDS = 2;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

/** A wild tile has `n` 0 and no colour. */
export interface MeldTile {
  id: string;
  color: string;
  n: number;
}
export const meldIsWild = (tile: MeldTile) => tile.n === 0;

export interface MeldShape {
  kind: "run" | "group";
  /** The tiles in display order, wild tiles sitting where they stand in. */
  tiles: MeldTile[];
  /** Sum of the numbers, a wild tile counting as the number it stands for. */
  value: number;
}

function asGroup(tiles: MeldTile[]): MeldShape | null {
  if (tiles.length > MELD_COLORS.length) return null;
  const real = tiles.filter((t) => !meldIsWild(t));
  const n = real[0]?.n;
  if (n === undefined || real.some((t) => t.n !== n)) return null;
  if (new Set(real.map((t) => t.color)).size !== real.length) return null;
  const ordered = [...real].sort((a, b) => MELD_COLORS.indexOf(a.color) - MELD_COLORS.indexOf(b.color));
  return { kind: "group", tiles: [...ordered, ...tiles.filter(meldIsWild)], value: n * tiles.length };
}

function asRun(tiles: MeldTile[]): MeldShape | null {
  if (tiles.length > MELD_MAX) return null;
  const real = tiles.filter((t) => !meldIsWild(t)).sort((a, b) => a.n - b.n);
  const wilds = tiles.filter(meldIsWild);
  const first = real[0];
  const last = real.at(-1);
  if (!first || !last || real.some((t) => t.color !== first.color)) return null;
  if (new Set(real.map((t) => t.n)).size !== real.length) return null;
  const spare = wilds.length - (last.n - first.n + 1 - real.length);
  if (spare < 0) return null;
  // Wild tiles left over after filling the gaps go on the high end, then on the low end.
  const above = Math.min(spare, MELD_MAX - last.n);
  const start = first.n - (spare - above);
  if (start < 1) return null;
  const ordered: MeldTile[] = [];
  let value = 0;
  for (let n = start; n < start + tiles.length; n++) {
    ordered.push(real.find((t) => t.n === n) ?? (wilds.pop() as MeldTile));
    value += n;
  }
  return { kind: "run", tiles: ordered, value };
}

/** Reads tiles as a run or a group, or null when they are neither. Order does not matter. */
export function meldShape(tiles: MeldTile[]): MeldShape | null {
  if (tiles.length < 3) return null;
  const run = asRun(tiles);
  const group = asGroup(tiles);
  // One number with two wild tiles reads both ways; count it as whichever is worth more.
  if (run && group) return group.value > run.value ? group : run;
  return run ?? group;
}

export const meldHandValue = (tiles: MeldTile[]) =>
  tiles.reduce((sum, t) => sum + (meldIsWild(t) ? MELD_WILD_PENALTY : t.n), 0);

/**
 * Sets that can be laid straight from these tiles without wild tiles: the longest runs first,
 * then groups from what is left. Greedy, not exhaustive; used by the test players and the hint.
 */
export function meldFindSets(tiles: MeldTile[]): MeldTile[][] {
  const left = tiles.filter((t) => !meldIsWild(t));
  const take = (set: MeldTile[]) => {
    for (const t of set) left.splice(left.indexOf(t), 1);
    return set;
  };
  const out: MeldTile[][] = [];
  for (const color of MELD_COLORS) {
    let run: MeldTile[] = [];
    for (let n = 1; n <= MELD_MAX + 1; n++) {
      const tile = left.find((t) => t.color === color && t.n === n);
      if (tile) run.push(tile);
      else {
        if (run.length >= 3) out.push(take(run));
        run = [];
      }
    }
  }
  for (let n = 1; n <= MELD_MAX; n++) {
    const group = MELD_COLORS.flatMap((color) => left.find((t) => t.color === color && t.n === n) ?? []);
    if (group.length >= 3) out.push(take(group));
  }
  return out;
}

const configSchema = z.object({ turnSeconds: z.number().int().min(0).max(600).default(0) });
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("meld"),
    /** The whole table as it should stand after this turn: every set as a list of tile ids. */
    sets: z
      .array(z.array(z.string().max(8)).min(1).max(MELD_MAX))
      .min(1)
      .max(40),
    step: z.number().int(),
  }),
  z.object({ type: z.literal("draw"), step: z.number().int() }),
  z.object({ type: z.literal("next"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export type MeldEvent =
  | { kind: "meld"; by: PlayerId; count: number; opening: boolean }
  | { kind: "draw"; by: PlayerId }
  | { kind: "pass"; by: PlayerId };

export interface MeldState {
  config: Config;
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: PlayerId[];
  current: PlayerId;
  hands: Record<PlayerId, MeldTile[]>;
  pool: MeldTile[];
  table: MeldTile[][];
  /** Who has made their opening play. */
  opened: Record<PlayerId, boolean>;
  /** Tiles added in the latest play, for highlighting. */
  lastPlayed: string[];
  /** Turns in a row that ended without a tile played or drawn (only once the pool is empty). */
  passes: number;
  log: MeldEvent[];
  ended: "out" | "stuck" | null;
  winners: PlayerId[];
  deadlineAt: number | null;
}

export interface MeldView {
  step: number;
  phase: MeldState["phase"];
  players: PlayerId[];
  current: PlayerId;
  table: MeldTile[][];
  myHand: MeldTile[] | null;
  counts: Record<PlayerId, number>;
  poolLeft: number;
  opened: Record<PlayerId, boolean>;
  lastPlayed: string[];
  log: MeldEvent[];
  ended: MeldState["ended"];
  winners: PlayerId[];
  /** Everyone's rack, shown only once the game is over. */
  hands: Record<PlayerId, MeldTile[]> | null;
  deadlineAt: number | null;
}

function buildTiles(): MeldTile[] {
  const tiles: MeldTile[] = [];
  for (const color of MELD_COLORS) {
    for (let n = 1; n <= MELD_MAX; n++) tiles.push({ id: "", color, n }, { id: "", color, n });
  }
  for (let i = 0; i < WILDS; i++) tiles.push({ id: "", color: "", n: 0 });
  return tiles;
}

function end(state: MeldState, why: NonNullable<MeldState["ended"]>, winners: PlayerId[]): GameResult<MeldState> {
  state.ended = why;
  state.winners = winners;
  state.phase = "gameOver";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

function endTurn(state: MeldState, me: PlayerId, ctx: GameContext): GameResult<MeldState> {
  state.log = state.log.slice(-8);
  if ((state.hands[me] as MeldTile[]).length === 0) return end(state, "out", [me]);
  if (state.passes >= state.players.length) {
    // Nobody can move and there is nothing to draw: the lightest rack wins.
    const value = (p: PlayerId) => meldHandValue(state.hands[p] as MeldTile[]);
    const low = Math.min(...state.players.map(value));
    return end(
      state,
      "stuck",
      state.players.filter((p) => value(p) === low),
    );
  }
  state.current = state.players[(state.players.indexOf(me) + 1) % state.players.length] as PlayerId;
  state.step += 1;
  state.deadlineAt = timer(state.config.turnSeconds, ctx);
  return { ok: true, state };
}

/** Takes a tile from the pool, or passes when the pool is empty. */
function draw(state: MeldState, me: PlayerId, ctx: GameContext): GameResult<MeldState> {
  const tile = state.pool.shift();
  if (tile) {
    (state.hands[me] as MeldTile[]).push(tile);
    state.passes = 0;
    state.log.push({ kind: "draw", by: me });
  } else {
    state.passes += 1;
    state.log.push({ kind: "pass", by: me });
  }
  return endTurn(state, me, ctx);
}

const setKey = (ids: string[]) => [...ids].sort().join(",");

function meld(state: MeldState, me: PlayerId, sets: string[][], ctx: GameContext): GameResult<MeldState> {
  const hand = state.hands[me] as MeldTile[];
  const onTable = new Set(state.table.flat().map((t) => t.id));
  const known = new Map([...state.table.flat(), ...hand].map((t) => [t.id, t]));
  const ids = sets.flat();
  if (new Set(ids).size !== ids.length) return { ok: false, error: "同一张牌不能用两次" };
  if (ids.some((id) => !known.has(id))) return { ok: false, error: "用了不在桌上、也不在你手里的牌" };
  const used = new Set(ids);
  if ([...onTable].some((id) => !used.has(id))) return { ok: false, error: "桌上的牌不能收回手里" };
  const played = ids.filter((id) => !onTable.has(id));
  if (played.length === 0) return { ok: false, error: "至少要出一张自己的牌；出不了就摸一张" };

  const shapes: MeldShape[] = [];
  for (const [i, set] of sets.entries()) {
    const shape = meldShape(set.map((id) => known.get(id) as MeldTile));
    if (!shape) return { ok: false, error: `第 ${i + 1} 组不成立：要么同色连号，要么同数不同色，至少三张` };
    shapes.push(shape);
  }

  const opening = !state.opened[me];
  if (opening) {
    // Before opening, the table is off limits: its sets stay as they are and yours stand alone.
    const before = new Set(state.table.map((set) => setKey(set.map((t) => t.id))));
    let value = 0;
    for (const [i, set] of sets.entries()) {
      const fromTable = set.filter((id) => onTable.has(id)).length;
      if (fromTable === 0) value += (shapes[i] as MeldShape).value;
      else if (fromTable !== set.length || !before.has(setKey(set)))
        return { ok: false, error: "第一次出牌之前不能动桌上的牌，只能用自己的牌另起几组" };
    }
    if (value < MELD_OPENING)
      return { ok: false, error: `第一次出牌要合计至少 ${MELD_OPENING} 点，现在只有 ${value} 点` };
    state.opened[me] = true;
  }

  state.hands[me] = hand.filter((t) => !used.has(t.id));
  state.table = shapes.map((s) => s.tiles);
  state.lastPlayed = played;
  state.passes = 0;
  state.log.push({ kind: "meld", by: me, count: played.length, opening });
  return endTurn(state, me, ctx);
}

const countOk = (n: number) => n >= MIN_PLAYERS && n <= MAX_PLAYERS;

export const meldGame = defineGame<MeldState, Action, MeldView, Config>({
  meta: {
    id: "meld",
    name: "数牌拆拼",
    description:
      "四种颜色的数字牌，凑成「同色连号」或「同数不同色」摆上桌。轮到你时可以把桌上所有的牌拆开重拼，只要最后每一组都成立。先出完手牌的人赢。",
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    rulesSummary: `四种颜色的 1–${MELD_MAX} 各两张，加两张百搭，共 106 张；每人 ${MELD_HAND} 张，其余是牌堆。桌上的牌只有两种摆法，每组至少三张：顺子（同一种颜色、数字相连，1 不能接在 13 后面）和刻子（同一个数字、颜色各不相同，最多四张）。百搭可以当任何一张。轮到你时二选一：出牌，或者摸一张牌结束回合。每个人第一次出牌只能用自己手里的牌另起几组，合计至少 ${MELD_OPENING} 点（百搭按它顶替的数字算），在这之前不能动桌上的牌。之后出牌时可以随意拆开、重组桌上所有的牌，只要回合结束时桌上每一组都成立、原来在桌上的牌一张都没少、并且你至少出了一张自己的牌。先出完手牌的人获胜。牌堆摸完后出不了牌只能过；所有人接连都过，则手牌点数最少的人获胜（百搭算 ${MELD_WILD_PENALTY} 点）。`,
    scoringSummary: "获胜 +3；三人以上时，其余人里手牌点数最少的 +1。",
    options: [secondsOption("turnSeconds", "每回合时限", 0)],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (!countOk(ctx.players.length)) return { ok: false, error: `需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 名玩家` };
    // Ids are handed out after shuffling, so an id says nothing about the tile's face.
    const pool = shuffle(buildTiles(), ctx.random).map((t, i) => ({ ...t, id: `m${i}` }));
    const state: MeldState = {
      config,
      step: 1,
      phase: "play",
      players: [...ctx.players],
      current: ctx.players[0] as PlayerId,
      hands: Object.fromEntries(ctx.players.map((p) => [p, pool.splice(0, MELD_HAND)])),
      pool,
      table: [],
      opened: Object.fromEntries(ctx.players.map((p) => [p, false])),
      lastPlayed: [],
      passes: 0,
      log: [],
      ended: null,
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
    if (action.type === "next") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以结束" };
      if (state.phase !== "gameOver") return { ok: false, error: "还没结束" };
      state.phase = "finished";
      state.step += 1;
      const scores: ScoreAward[] = state.winners.map((p) => ({
        playerId: p,
        points: 3,
        reason: state.ended === "out" ? "出完了手牌" : "手牌点数最少",
        key: `win:${p}`,
      }));
      const rest = state.players.filter((p) => !state.winners.includes(p));
      if (state.players.length >= 3 && rest.length > 0) {
        const value = (p: PlayerId) => meldHandValue(state.hands[p] as MeldTile[]);
        const low = Math.min(...rest.map(value));
        for (const p of rest.filter((q) => value(q) === low)) {
          scores.push({ playerId: p, points: 1, reason: "剩下的牌点数最少", key: `second:${p}` });
        }
      }
      return { ok: true, state, finished: true, scores };
    }
    if (state.phase !== "play") return { ok: false, error: "这一局已经结束" };
    if (me !== state.current) return { ok: false, error: "还没轮到你" };
    return action.type === "draw" ? draw(state, me, ctx) : meld(state, me, action.sets, ctx);
  },

  atSafePoint: (state) => state.phase === "gameOver",
  deadline: (state) => (state.phase === "play" ? state.deadlineAt : null),
  // Out of time: whatever was being arranged is dropped and the player draws.
  onTimeout(state, ctx) {
    if (state.phase !== "play") return { ok: true, state };
    return draw(state, state.current, ctx);
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
      table: state.table,
      myHand: state.hands[viewer] ?? null,
      counts: Object.fromEntries(state.players.map((p) => [p, (state.hands[p] as MeldTile[]).length])),
      poolLeft: state.pool.length,
      opened: state.opened,
      lastPlayed: state.lastPlayed,
      log: state.log,
      ended: state.ended,
      winners: state.winners,
      hands: state.phase === "play" ? null : state.hands,
      deadlineAt: state.deadlineAt,
    };
  },

  publicSummary(state) {
    const racks = state.players.map((p) => (state.hands[p] as MeldTile[]).length).join("、");
    return `数牌拆拼，阶段：${state.phase}，桌上 ${state.table.length} 组共 ${state.table.flat().length} 张，各人手牌张数 ${racks}，牌堆 ${state.pool.length}（手牌不公开）`;
  },
});
