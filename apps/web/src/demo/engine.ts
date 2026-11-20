/**
 * A table that runs entirely in the browser, for the static build (no server, no model).
 *
 * It drives the same rule modules as the server and hands the same per-player views to the same
 * game components. Two kinds of seat exist: a person using this device, and a scripted player.
 * - "demo": one person plus scripted players and a host that reads prepared lines.
 * - "manual": every seat is moved by the caller, no timers and no talk (used by the tests).
 * The room code seeds the content order and the shuffles, so the same code gives the same topics.
 *
 * This is not the real product's trust model: the whole state lives in this browser. Only
 * `module.view(state, seat)` is ever rendered, but there is no server keeping secrets.
 */
import { bundledContent, games } from "@apr/games";
import {
  type Ack,
  type ChatMessageView,
  type ContentItem,
  DEFAULT_PREFS,
  type GameContext,
  type GameMeta,
  type GameModule,
  type GameResult,
  type RoomView,
  type ScoreAward,
  type SettlementRow,
  settle,
} from "@apr/shared";
import { scriptedMove } from "./bots.ts";
import { seeded, shuffled } from "./rng.ts";
import { hostIntro, hostOutro, hostReact, playerBanter, playerReply } from "./script.ts";

export interface Seat {
  id: string;
  nickname: string;
  avatar: string;
  kind: "human" | "script";
}

export interface TableOptions {
  mode: "demo" | "manual";
  /** Room code: the seed of everything random at this table. */
  code: string;
  seats: Seat[];
  /** Games on offer, in lobby order. */
  gameIds: string[];
}

export interface TableResult {
  gameId: string;
  gameName: string;
  rows: SettlementRow[];
  note: string | null;
}

// biome-ignore lint/suspicious/noExplicitAny: the registry erases per-game generics
type AnyModule = GameModule<any, any, any, any>;

interface Segment {
  id: string;
  gameId: string;
  module: AnyModule;
  state: unknown;
  awards: Map<string, ScoreAward>;
  finished: boolean;
}

const between = (min: number, max: number) => min + Math.random() * (max - min);

export class Table {
  readonly mode: TableOptions["mode"];
  readonly code: string;
  readonly seats: Seat[];
  readonly metas: GameMeta[];
  /** Whose view is on screen. */
  viewer: string;
  result: TableResult | null = null;
  chat: ChatMessageView[] = [];

  private seg: Segment | null = null;
  private played = 0;
  private party: Record<string, number> = {};
  private pools = new Map<string, ContentItem[]>();
  private random: () => number = Math.random;
  private aiBusy = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private talkTimers = new Set<ReturnType<typeof setTimeout>>();
  private msgSeq = 0;

  constructor(options: TableOptions) {
    this.mode = options.mode;
    this.code = options.code;
    this.seats = options.seats;
    this.viewer = (options.seats.find((s) => s.kind === "human") ?? options.seats[0])?.id ?? "";
    this.metas = options.gameIds.flatMap((id) => (games[id] ? [games[id].meta] : []));
    for (const s of this.seats) this.party[s.id] = 0;
    if (this.mode === "demo") {
      this.hostSay(
        "欢迎来到演示房间。右边三位是脚本玩家，我念的也是提前写好的台词——真实版本里是你的朋友和一个真的 AI 主持。左边挑个游戏开始吧。",
      );
    }
  }

  // ------------------------------------------------------------ subscription

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  /** Stops every timer; the table must not be used afterwards. */
  dispose() {
    clearTimeout(this.deadlineTimer);
    for (const t of this.pending.values()) clearTimeout(t);
    for (const t of this.talkTimers) clearTimeout(t);
    this.listeners.clear();
  }

  // ------------------------------------------------------------ views

  private name = (id: string) => this.seats.find((s) => s.id === id)?.nickname ?? "?";
  private isHost = (id: string) => this.mode === "manual" || id === this.seats[0]?.id;

  get segmentLive(): boolean {
    return this.seg !== null && !this.seg.finished;
  }
  get gameId(): string | null {
    return this.seg?.gameId ?? null;
  }

  private rawTotals(seg: Segment): Record<string, number> {
    const raw: Record<string, number> = {};
    for (const a of seg.awards.values()) raw[a.playerId] = (raw[a.playerId] ?? 0) + a.points;
    return raw;
  }

  /** The snapshot the given seat would receive from a real server. */
  roomView(viewer = this.viewer): RoomView {
    const seg = this.seg;
    const raw = seg ? this.rawTotals(seg) : {};
    return {
      room: { id: "static", name: "演示房间" },
      me: { playerId: viewer, isHost: this.isHost(viewer) },
      members: this.seats.map((s, i) => ({
        id: s.id,
        nickname: s.nickname,
        avatar: s.avatar,
        isHost: this.mode === "demo" && i === 0,
        connected: true,
      })),
      sessionId: "static",
      scoreboard: this.seats.map((s) => ({ playerId: s.id, points: (this.party[s.id] ?? 0) / 10 })),
      games: this.metas,
      segment: seg
        ? {
            id: seg.id,
            gameId: seg.gameId,
            status: "active",
            view: seg.module.view(seg.state, viewer),
            skip: null,
            rawScores: Object.entries(raw).map(([playerId, points]) => ({ playerId, points })),
            contentId: null,
            notice: null,
          }
        : null,
      lastSegment: null,
      party: {
        sessionId: "static",
        number: 1,
        scoring: "rank-v1",
        gamesPlayed: this.played,
        lastEndedSessionId: null,
      },
      prefs: DEFAULT_PREFS,
      settlement: null,
      adjustments: [],
      suggestion: null,
      ai: {
        enabled: this.mode === "demo",
        state: this.aiBusy > 0 ? "thinking" : "idle",
        note: this.aiBusy > 0 ? "主持正在组织语言…" : "演示主持 · 固定台词，不是真的模型",
      },
      canvas: { current: null, queued: 0 },
    };
  }

  // ------------------------------------------------------------ content

  private pool(type: string | undefined): ContentItem[] {
    if (!type) return [];
    let pool = this.pools.get(type);
    if (!pool) {
      const items = bundledContent.filter((c) => c.type === type);
      pool = shuffled(items, seeded(`${this.code}:${type}`));
      this.pools.set(type, pool);
    }
    return pool;
  }

  private ctx(module: AnyModule): GameContext {
    const pool = this.pool(module.meta.contentType);
    return {
      now: Date.now(),
      random: this.random,
      players: this.seats.map((s) => s.id),
      history: [],
      drawContent: () => pool.shift() ?? null,
      peekContent: (count) => {
        const items = pool.splice(0, count);
        pool.push(...items);
        return items;
      },
      consumeContent: (id) => {
        const index = pool.findIndex((item) => item.id === id);
        if (index >= 0) pool.splice(index, 1);
      },
    };
  }

  // ------------------------------------------------------------ playing

  setViewer(id: string) {
    this.viewer = id;
    this.emit();
  }

  start(gameId: string): Ack {
    const module = games[gameId];
    if (!module) return { ok: false, error: "没有这个游戏" };
    const n = this.seats.length;
    if (n < module.meta.minPlayers || n > module.meta.maxPlayers) {
      return { ok: false, error: `这个游戏需要 ${module.meta.minPlayers}–${module.meta.maxPlayers} 人` };
    }
    this.clearTimers();
    this.random = seeded(`${this.code}:game:${this.played}:${gameId}`);
    // Tests move every seat themselves and want no countdowns; the demo plays shorter games.
    const defaults = module.configSchema.safeParse({});
    const config: Record<string, unknown> = {};
    if (defaults.success && defaults.data && typeof defaults.data === "object") {
      for (const [key, value] of Object.entries(defaults.data as Record<string, unknown>)) {
        if (this.mode === "manual" && key.endsWith("Seconds")) config[key] = 0;
        if (this.mode === "demo" && key === "rounds" && typeof value === "number") config[key] = Math.min(value, 3);
        // Point targets are cut down too, so a demo game ends in a few minutes.
        if (this.mode === "demo" && key === "target" && typeof value === "number") config[key] = Math.ceil(value / 3);
      }
    }
    const parsed = module.configSchema.safeParse(config);
    const r = module.setup(parsed.success ? parsed.data : {}, this.ctx(module)) as GameResult<unknown>;
    if (!r.ok) return { ok: false, error: r.error };
    this.result = null;
    this.seg = {
      id: `seg-${this.played + 1}`,
      gameId,
      module,
      state: r.state,
      awards: new Map(),
      finished: false,
    };
    if (this.mode === "demo") this.hostSay(hostIntro(gameId, module.meta));
    this.after(r, null);
    return { ok: true };
  }

  /** A formal game action by one seat, checked by the rules exactly as on the server. */
  act(playerId: string, action: unknown): Ack {
    const seg = this.seg;
    if (!seg || seg.finished) return { ok: false, error: "这一局已经结束" };
    const parsed = seg.module.actionSchema.safeParse(action);
    if (!parsed.success) return { ok: false, error: "无效的操作" };
    const before = this.mode === "demo" ? seg.module.view(seg.state, this.viewer) : null;
    const r = seg.module.apply(
      structuredClone(seg.state),
      parsed.data,
      { kind: "player", playerId, isHost: this.isHost(playerId) },
      this.ctx(seg.module),
    ) as GameResult<unknown>;
    if (!r.ok) return { ok: false, error: r.error };
    this.after(r, before);
    return { ok: true };
  }

  /** Leaves the current game; a game with results is settled, an untouched one is dropped. */
  leaveGame() {
    const seg = this.seg;
    if (seg && !seg.finished && seg.awards.size > 0) this.finish(seg);
    else {
      this.clearTimers();
      this.seg = null;
      this.result = null;
    }
    this.emit();
  }

  /** Back to the game list after looking at a result. */
  toLobby() {
    this.clearTimers();
    this.seg = null;
    this.result = null;
    this.emit();
  }

  private after(r: Extract<GameResult<unknown>, { ok: true }>, before: unknown) {
    const seg = this.seg;
    if (!seg) return;
    seg.state = r.state;
    // Same rule as the ledger: a second award with the same key is ignored.
    for (const a of r.scores ?? []) if (!seg.awards.has(a.key)) seg.awards.set(a.key, a);
    if (this.mode === "demo" && before) {
      const now = seg.module.view(seg.state, this.viewer);
      for (const line of hostReact(seg.gameId, before, now, this.name)) this.hostSay(line);
      const banter = playerBanter(seg.gameId, before, now);
      if (banter) this.scriptSay(banter);
    }
    if (r.finished) this.finish(seg);
    else {
      this.armDeadline();
      this.wakeScripts();
    }
    this.emit();
  }

  private finish(seg: Segment) {
    this.clearTimers();
    seg.finished = true;
    this.played += 1;
    const raw = this.rawTotals(seg);
    const excluded = seg.module.settlement?.(seg.state).exclude ?? [];
    const ranked = this.seats.map((s) => s.id).filter((id) => !excluded.includes(id));
    const settled = settle(ranked, raw, seg.awards.size > 0);
    for (const row of settled.rows) this.party[row.playerId] = (this.party[row.playerId] ?? 0) + row.tenths;
    this.result = { gameId: seg.gameId, gameName: seg.module.meta.name, rows: settled.rows, note: settled.note };
    if (this.mode === "demo") this.hostSay(hostOutro(settled.rows, this.name));
  }

  private clearTimers() {
    clearTimeout(this.deadlineTimer);
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  private armDeadline() {
    clearTimeout(this.deadlineTimer);
    const seg = this.seg;
    if (!seg || seg.finished) return;
    const at = seg.module.deadline?.(seg.state) ?? null;
    if (at === null) return;
    this.deadlineTimer = setTimeout(
      () => {
        if (this.seg !== seg || seg.finished || !seg.module.onTimeout) return;
        const before = this.mode === "demo" ? seg.module.view(seg.state, this.viewer) : null;
        const r = seg.module.onTimeout(structuredClone(seg.state), this.ctx(seg.module)) as GameResult<unknown>;
        if (r.ok) this.after(r, before);
      },
      Math.max(0, at - Date.now()) + 50,
    );
  }

  /** Gives every scripted seat a chance to move, each after its own human-looking pause. */
  private wakeScripts() {
    const seg = this.seg;
    if (!seg || seg.finished) return;
    for (const seat of this.seats) {
      if (seat.kind !== "script" || this.pending.has(seat.id)) continue;
      const timer = setTimeout(
        () => {
          this.pending.delete(seat.id);
          if (this.seg !== seg || seg.finished) return;
          const action = scriptedMove(seg.gameId, seg.module.view(seg.state, seat.id), seat.id, seg.state);
          if (action) this.act(seat.id, action);
        },
        between(900, 2600),
      );
      this.pending.set(seat.id, timer);
    }
  }

  // ------------------------------------------------------------ chat (demo only)

  private push(sender: ChatMessageView["sender"], text: string) {
    this.msgSeq += 1;
    this.chat = [...this.chat, { id: `m${this.msgSeq}`, sender, text, createdAt: Date.now(), sessionId: "static" }];
    this.emit();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.talkTimers.delete(t);
      fn();
    }, ms);
    this.talkTimers.add(t);
  }

  private hostSay(text: string) {
    this.aiBusy += 1;
    this.later(between(500, 1100), () => {
      this.aiBusy -= 1;
      this.push({ kind: "agent" }, text);
    });
  }

  private scriptSay(text: string) {
    const scripts = this.seats.filter((s) => s.kind === "script");
    const who = scripts[Math.floor(Math.random() * scripts.length)];
    if (!who) return;
    this.later(between(1200, 2400), () =>
      this.push({ kind: "player", playerId: who.id, nickname: who.nickname }, text),
    );
  }

  /** The person's own chat message; scripted players answer with stock lines. */
  say(text: string, askAi: boolean): Ack {
    this.push({ kind: "player", playerId: this.viewer, nickname: this.name(this.viewer) }, text);
    if (this.mode !== "demo") return { ok: true };
    if (askAi) {
      this.hostSay(
        "这是演示版，我只会念提前写好的台词，没法真的回答你。真实版本里，主持会看着场上情况接话、出题、提议加分。",
      );
    } else this.scriptSay(playerReply());
    return { ok: true };
  }
}
