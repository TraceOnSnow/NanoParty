/**
 * Authoritative runtime of one room. Transport-agnostic: Colyseus (or a test) feeds it
 * authenticated connections and messages; it owns members, chat, the party session,
 * the current game segment, timers and the scoreboard.
 *
 * Invariants:
 * - All mutations run one at a time through `exclusive()`.
 * - State is persisted in one transaction BEFORE memory is updated and views are sent,
 *   so anything a client has seen survives a restart.
 * - Clients only ever receive `view(state, player)`; raw game state never leaves this class.
 */
import { games } from "@apr/games";
import {
  type Ack,
  type AiStatus,
  type ChatMessageView,
  type Command,
  type CommandEnvelope,
  type ContentItem,
  type GameContext,
  type GameModule,
  type GameResult,
  type LastSegmentView,
  MSG,
  type PlayerId,
  type RoomView,
  type ScoreEntry,
} from "@apr/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AgentRoomContext, AgentRoomPort, AgentService } from "../agent/AgentService.ts";
import type { ContentService } from "../content/ContentService.ts";
import type { Db } from "../db/client.ts";
import { chatMessages, partySessions, players, rooms, scoreEvents, segments } from "../db/schema.ts";
import { RateLimiter } from "../util/rateLimit.ts";
import { newId, sha256 } from "../util/tokens.ts";

export interface RuntimeDeps {
  db: Db;
  content: ContentService;
  agent: AgentService;
  now?: () => number;
  random?: () => number;
}

export type Send = (type: string, payload: unknown) => void;

// biome-ignore lint/suspicious/noExplicitAny: per-game generics are erased at the runtime boundary
type AnyGame = GameModule<any, any, any, any>;

interface LiveSegment {
  id: string;
  gameId: string;
  module: AnyGame;
  status: "active" | "paused";
  state: unknown;
  /** Unused content for this segment; `drawContent` pops from here. */
  pool: ContentItem[];
}

const CHAT_HISTORY = 100;
const AGENT_CHAT_CONTEXT = 20;
const AI_MENTION = /@(ai|主持)/i;
const MAX_CACHED_COMMANDS = 500;

export class RoomRuntime implements AgentRoomPort {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly connections = new Map<number, { playerId: PlayerId; send: Send }>();
  private nextConnId = 1;
  private readonly members = new Map<PlayerId, { id: PlayerId; nickname: string }>();
  private readonly scores = new Map<PlayerId, number>();
  private chat: ChatMessageView[] = [];
  private segment: LiveSegment | null = null;
  private lastSegment: LastSegmentView | null = null;
  private suggestion: { gameId: string; reason: string } | null = null;
  private aiStatus: AiStatus;
  private timer: NodeJS.Timeout | null = null;
  private readonly commandResults = new Map<string, Promise<Ack>>();
  private readonly chatLimiter = new RateLimiter(8, 10_000);
  private disposed = false;

  private constructor(
    private readonly deps: RuntimeDeps,
    readonly roomId: string,
    private readonly roomName: string,
    private readonly inviteToken: string,
    private readonly hostPlayerId: PlayerId,
    private sessionId: string,
  ) {
    this.aiStatus = deps.agent.initialStatus();
  }

  // ---------------------------------------------------------------- loading

  /** Rebuilds the runtime from the database. Returns null if the room does not exist. */
  static async load(deps: RuntimeDeps, roomId: string): Promise<RoomRuntime | null> {
    const { db } = deps;
    const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId));
    if (!room) return null;

    let [session] = await db
      .select()
      .from(partySessions)
      .where(and(eq(partySessions.roomId, roomId), eq(partySessions.status, "active")));
    if (!session) {
      [session] = await db
        .insert(partySessions)
        .values({ id: newId("ses"), roomId, status: "active" })
        .returning();
    }
    if (!session) throw new Error("failed to open party session");

    const rt = new RoomRuntime(deps, room.id, room.name, room.inviteToken, room.hostPlayerId, session.id);

    for (const p of await db.select().from(players).where(eq(players.roomId, roomId)).orderBy(asc(players.createdAt))) {
      rt.members.set(p.id, { id: p.id, nickname: p.nickname });
    }

    const totals = await db
      .select({ playerId: scoreEvents.playerId, points: sql<number>`sum(${scoreEvents.points})::int` })
      .from(scoreEvents)
      .where(eq(scoreEvents.sessionId, session.id))
      .groupBy(scoreEvents.playerId);
    for (const t of totals) rt.scores.set(t.playerId, t.points);

    const history = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(CHAT_HISTORY);
    rt.chat = history.reverse().map((m) => rt.toChatView(m));

    const [seg] = await db
      .select()
      .from(segments)
      .where(and(eq(segments.sessionId, session.id), inArray(segments.status, ["active", "paused"])));
    if (seg) {
      const module = games[seg.gameId];
      if (module) {
        // A segment found on load was interrupted by a restart: it waits for the host to resume,
        // so downtime never counts as a player timeout and no timer fires unattended.
        if (seg.status === "active") {
          await db.update(segments).set({ status: "paused" }).where(eq(segments.id, seg.id));
        }
        const pool = module.meta.contentType ? await deps.content.pool(module.meta.contentType, session.id) : [];
        rt.segment = { id: seg.id, gameId: seg.gameId, module, status: "paused", state: seg.state, pool };
      } else {
        // The game module no longer exists in this build; close the segment, keep its scores.
        await db.update(segments).set({ status: "aborted", endedAt: new Date() }).where(eq(segments.id, seg.id));
      }
    }
    return rt;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  // ------------------------------------------------------------ connections

  /** Resolves a session token to a player of this room. Nicknames play no part in identity. */
  async authenticate(sessionToken: unknown): Promise<PlayerId | null> {
    if (typeof sessionToken !== "string" || sessionToken.length < 16) return null;
    const [player] = await this.deps.db
      .select()
      .from(players)
      .where(and(eq(players.sessionTokenHash, sha256(sessionToken)), eq(players.roomId, this.roomId)));
    if (!player) return null;
    if (!this.members.has(player.id)) {
      this.members.set(player.id, { id: player.id, nickname: player.nickname });
    }
    return player.id;
  }

  /** Registers a live connection and sends it the full snapshot. Returns the disconnect function. */
  connect(playerId: PlayerId, send: Send): () => void {
    const connId = this.nextConnId++;
    this.connections.set(connId, { playerId, send });
    send(MSG.chatHistory, this.chat);
    this.broadcast();
    return () => {
      if (this.connections.delete(connId)) this.broadcast();
    };
  }

  private isConnected(playerId: PlayerId): boolean {
    for (const c of this.connections.values()) if (c.playerId === playerId) return true;
    return false;
  }

  // ------------------------------------------------------------------- chat

  async handleChat(playerId: PlayerId, text: string): Promise<Ack> {
    const member = this.members.get(playerId);
    if (!member) return { ok: false, error: "未加入房间" };
    if (!this.chatLimiter.take(playerId)) return { ok: false, error: "发送太快了，请稍等" };
    await this.appendChat({ kind: "player", playerId }, text);
    // Plain chat is stored but never calls the model; only an explicit mention does.
    if (AI_MENTION.test(text)) {
      this.deps.agent.trigger(this, { kind: "mention", nickname: member.nickname, text });
    }
    return { ok: true };
  }

  private async appendChat(
    sender: { kind: "player"; playerId: PlayerId } | { kind: "agent" } | { kind: "system" },
    text: string,
  ): Promise<void> {
    const [row] = await this.deps.db
      .insert(chatMessages)
      .values({
        id: newId("msg"),
        roomId: this.roomId,
        senderKind: sender.kind,
        playerId: sender.kind === "player" ? sender.playerId : null,
        text,
      })
      .returning();
    if (!row) return;
    const view = this.toChatView(row);
    this.chat.push(view);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    for (const c of this.connections.values()) c.send(MSG.chatMessage, view);
  }

  private toChatView(row: typeof chatMessages.$inferSelect): ChatMessageView {
    const sender: ChatMessageView["sender"] =
      row.senderKind === "player" && row.playerId
        ? { kind: "player", playerId: row.playerId, nickname: this.members.get(row.playerId)?.nickname ?? "?" }
        : row.senderKind === "agent"
          ? { kind: "agent" }
          : { kind: "system" };
    return { id: row.id, sender, text: row.text, createdAt: row.createdAt.getTime() };
  }

  // --------------------------------------------------------------- commands

  /** Entry point for every formal operation. Re-sending the same cmdId never executes twice. */
  handleCommand(playerId: PlayerId, envelope: CommandEnvelope): Promise<Ack> {
    const key = `${playerId}:${envelope.cmdId}`;
    const cached = this.commandResults.get(key);
    if (cached) return cached;
    const result = this.exclusive(() => this.execute(playerId, envelope.command)).catch((err): Ack => {
      console.error(`[room ${this.roomId}] command ${envelope.command.type} failed:`, err);
      return { ok: false, error: "服务器内部错误，操作未生效" };
    });
    this.commandResults.set(key, result);
    if (this.commandResults.size > MAX_CACHED_COMMANDS) {
      const oldest = this.commandResults.keys().next().value;
      if (oldest) this.commandResults.delete(oldest);
    }
    return result;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async execute(playerId: PlayerId, command: Command): Promise<Ack> {
    const member = this.members.get(playerId);
    if (!member) return { ok: false, error: "未加入房间" };
    const isHost = playerId === this.hostPlayerId;

    switch (command.type) {
      case "startGame": {
        if (!isHost) return { ok: false, error: "只有房主可以开始游戏" };
        return this.startGame(command.gameId, command.config);
      }
      case "gameAction": {
        const seg = this.segment;
        if (!seg || seg.id !== command.segmentId) return { ok: false, error: "这局游戏已经结束" };
        if (seg.status === "paused") return { ok: false, error: "游戏已暂停，等待房主恢复" };
        const action = seg.module.actionSchema.safeParse(command.action);
        if (!action.success) return { ok: false, error: "无效的操作" };
        const { ctx, drawn } = this.makeContext(seg.pool);
        const result = seg.module.apply(
          structuredClone(seg.state),
          action.data,
          { kind: "player", playerId, isHost },
          ctx,
        );
        return this.commit(seg, result, drawn);
      }
      case "endSegment": {
        if (!isHost) return { ok: false, error: "只有房主可以结束当前游戏" };
        const seg = this.segment;
        if (!seg || seg.id !== command.segmentId) return { ok: false, error: "这局游戏已经结束" };
        await this.deps.db
          .update(segments)
          .set({ status: "aborted", endedAt: new Date() })
          .where(eq(segments.id, seg.id));
        await this.closeSegment(seg, "aborted");
        return { ok: true };
      }
      case "resumeSegment": {
        if (!isHost) return { ok: false, error: "只有房主可以恢复游戏" };
        const seg = this.segment;
        if (!seg || seg.id !== command.segmentId) return { ok: false, error: "这局游戏已经结束" };
        if (seg.status !== "paused") return { ok: true };
        const { ctx } = this.makeContext(seg.pool);
        const state = seg.module.onResume?.(structuredClone(seg.state), ctx) ?? seg.state;
        await this.deps.db.update(segments).set({ status: "active", state }).where(eq(segments.id, seg.id));
        seg.state = state;
        seg.status = "active";
        this.scheduleDeadline();
        this.broadcast();
        return { ok: true };
      }
      case "askAgent": {
        const queued = this.deps.agent.trigger(this, { kind: "recommend", nickname: member.nickname });
        return queued ? { ok: true } : { ok: false, error: "AI 主持未启用，请直接选择游戏" };
      }
      case "dismissSuggestion": {
        if (!isHost) return { ok: false, error: "只有房主可以处理建议" };
        this.suggestion = null;
        this.broadcast();
        return { ok: true };
      }
    }
  }

  private async startGame(gameId: string, rawConfig: unknown): Promise<Ack> {
    if (this.segment) return { ok: false, error: "已有游戏在进行中" };
    const module = games[gameId];
    if (!module) return { ok: false, error: "未知的游戏" };
    const count = this.members.size;
    if (count < module.meta.minPlayers || count > module.meta.maxPlayers) {
      return { ok: false, error: `「${module.meta.name}」需要 ${module.meta.minPlayers}–${module.meta.maxPlayers} 人` };
    }
    const config = module.configSchema.safeParse(rawConfig ?? {});
    if (!config.success) return { ok: false, error: "游戏设置无效" };

    const pool = module.meta.contentType ? await this.deps.content.pool(module.meta.contentType, this.sessionId) : [];
    const { ctx, drawn } = this.makeContext(pool);
    const result = module.setup(config.data, ctx);
    if (!result.ok) return { ok: false, error: result.error };

    const seg: LiveSegment = { id: newId("seg"), gameId, module, status: "active", state: result.state, pool };
    await this.deps.db.transaction(async (tx) => {
      await tx.insert(segments).values({
        id: seg.id,
        sessionId: this.sessionId,
        gameId,
        status: "active",
        config: config.data,
        state: result.state,
      });
      await this.deps.content.recordUsage(tx, this.sessionId, seg.id, drawn);
    });
    this.segment = seg;
    this.suggestion = null;
    this.lastSegment = null;
    this.scheduleDeadline();
    this.broadcast();
    return { ok: true };
  }

  private makeContext(pool: ContentItem[]): { ctx: GameContext; drawn: ContentItem[] } {
    const drawn: ContentItem[] = [];
    const ctx: GameContext = {
      now: this.now(),
      random: this.deps.random ?? Math.random,
      players: [...this.members.keys()],
      drawContent: () => {
        const item = pool.shift();
        if (item) drawn.push(item);
        return item ?? null;
      },
    };
    return { ctx, drawn };
  }

  /** Persists a game result atomically (state + scores + content usage), then updates memory. */
  private async commit(seg: LiveSegment, result: GameResult<unknown>, drawn: ContentItem[]): Promise<Ack> {
    if (!result.ok) {
      seg.pool.unshift(...drawn);
      return { ok: false, error: result.error };
    }
    let awarded: { playerId: string; points: number }[] = [];
    try {
      awarded = await this.deps.db.transaction(async (tx) => {
        await tx
          .update(segments)
          .set({
            state: result.state,
            ...(result.finished ? { status: "finished" as const, endedAt: new Date() } : {}),
          })
          .where(eq(segments.id, seg.id));
        await this.deps.content.recordUsage(tx, this.sessionId, seg.id, drawn);
        if (!result.scores?.length) return [];
        // The unique (segment, award key) index makes re-settlement a no-op.
        return tx
          .insert(scoreEvents)
          .values(
            result.scores.map((s) => ({
              id: newId("sc"),
              sessionId: this.sessionId,
              segmentId: seg.id,
              playerId: s.playerId,
              points: s.points,
              reason: s.reason,
              awardKey: s.key,
            })),
          )
          .onConflictDoNothing()
          .returning({ playerId: scoreEvents.playerId, points: scoreEvents.points });
      });
    } catch (err) {
      seg.pool.unshift(...drawn);
      throw err;
    }
    seg.state = result.state;
    for (const a of awarded) this.scores.set(a.playerId, (this.scores.get(a.playerId) ?? 0) + a.points);
    if (result.finished) {
      await this.closeSegment(seg, "finished");
    } else {
      this.scheduleDeadline();
      this.broadcast();
    }
    return { ok: true };
  }

  /** Back to the lobby. Confirmed scores stay on the session scoreboard. */
  private async closeSegment(seg: LiveSegment, endedReason: "finished" | "aborted") {
    const rows = await this.deps.db
      .select({ playerId: scoreEvents.playerId, points: sql<number>`sum(${scoreEvents.points})::int` })
      .from(scoreEvents)
      .where(eq(scoreEvents.segmentId, seg.id))
      .groupBy(scoreEvents.playerId);
    this.lastSegment = {
      gameId: seg.gameId,
      gameName: seg.module.meta.name,
      endedReason,
      scores: rows.sort((a, b) => b.points - a.points),
    };
    this.segment = null;
    this.scheduleDeadline();
    this.broadcast();
  }

  // ----------------------------------------------------------------- timers

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private scheduleDeadline() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const seg = this.segment;
    if (this.disposed || !seg || seg.status !== "active") return;
    const deadline = seg.module.deadline?.(seg.state);
    if (deadline == null) return;
    this.timer = setTimeout(
      () => {
        this.exclusive(() => this.onDeadline(seg.id)).catch((err) =>
          console.error(`[room ${this.roomId}] timeout handling failed:`, err),
        );
      },
      Math.max(0, deadline - this.now()),
    );
    this.timer.unref();
  }

  private async onDeadline(segmentId: string) {
    const seg = this.segment;
    if (!seg || seg.id !== segmentId || seg.status !== "active" || !seg.module.onTimeout) return;
    const deadline = seg.module.deadline?.(seg.state);
    // The state may have moved on since the timer was armed.
    if (deadline == null || deadline > this.now()) return this.scheduleDeadline();
    const { ctx, drawn } = this.makeContext(seg.pool);
    await this.commit(seg, seg.module.onTimeout(structuredClone(seg.state), ctx), drawn);
  }

  // ------------------------------------------------------------------ views

  private scoreboard(): ScoreEntry[] {
    return [...this.members.keys()]
      .map((playerId) => ({ playerId, points: this.scores.get(playerId) ?? 0 }))
      .sort((a, b) => b.points - a.points);
  }

  private viewFor(playerId: PlayerId): RoomView {
    const isHost = playerId === this.hostPlayerId;
    const seg = this.segment;
    return {
      room: { id: this.roomId, name: this.roomName },
      me: { playerId, isHost },
      ...(isHost ? { inviteToken: this.inviteToken } : {}),
      members: [...this.members.values()].map((m) => ({
        id: m.id,
        nickname: m.nickname,
        isHost: m.id === this.hostPlayerId,
        connected: this.isConnected(m.id),
      })),
      sessionId: this.sessionId,
      scoreboard: this.scoreboard(),
      games: Object.values(games).map((g) => g.meta),
      segment: seg
        ? { id: seg.id, gameId: seg.gameId, status: seg.status, view: seg.module.view(seg.state, playerId) }
        : null,
      lastSegment: this.lastSegment,
      suggestion: this.suggestion,
      ai: this.aiStatus,
    };
  }

  private broadcast() {
    for (const c of this.connections.values()) c.send(MSG.view, this.viewFor(c.playerId));
  }

  // ------------------------------------------------------- AgentRoomPort

  agentContext(): AgentRoomContext {
    const name = (id: PlayerId) => this.members.get(id)?.nickname ?? "?";
    const lines = [
      `房间「${this.roomName}」，成员：${[...this.members.values()]
        .map(
          (m) =>
            `${m.nickname}${m.id === this.hostPlayerId ? "（房主）" : ""}${this.isConnected(m.id) ? "" : "（离线）"}`,
        )
        .join("、")}`,
      `本场累计积分：${
        this.scoreboard()
          .map((s) => `${name(s.playerId)} ${s.points}`)
          .join("，") || "暂无"
      }`,
      this.segment
        ? `当前游戏${this.segment.status === "paused" ? "（已暂停，等待房主恢复）" : ""}：${this.segment.module.publicSummary(this.segment.state)}`
        : "当前在大厅，没有进行中的游戏。",
    ];
    return {
      state: lines.join("\n"),
      recentChat: this.chat.slice(-AGENT_CHAT_CONTEXT).map((m) => ({
        speaker: m.sender.kind === "player" ? m.sender.nickname : m.sender.kind === "agent" ? "AI 主持" : "系统",
        text: m.text,
      })),
      games: Object.values(games).map((g) => g.meta),
    };
  }

  suggestGame(gameId: string, reason: string): Promise<{ ok: boolean; message: string }> {
    return this.exclusive(async () => {
      const module = games[gameId];
      if (!module) return { ok: false, message: `失败：没有 id 为 ${gameId} 的已实现游戏。` };
      // Checked against the latest state at execution time, not when the model was called.
      if (this.segment) return { ok: false, message: "失败：有游戏正在进行，现在不能发起推荐。" };
      this.suggestion = { gameId, reason };
      this.broadcast();
      return { ok: true, message: `已在主面板展示「${module.meta.name}」的推荐，等待房主决定是否开始（尚未开始）。` };
    });
  }

  postChat(kind: "agent" | "system", text: string): Promise<void> {
    return this.appendChat({ kind }, text);
  }

  setAiStatus(status: AiStatus) {
    this.aiStatus = status;
    this.broadcast();
  }
}
