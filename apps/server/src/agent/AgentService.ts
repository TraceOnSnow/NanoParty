/**
 * Shared host agent: one logical agent per room.
 *
 * Guarantees enforced here (not left to the model):
 * - Only explicit triggers call the model (@AI mention, "ask AI" button). Plain chat never does.
 * - One run per room at a time; triggers arriving meanwhile are queued and merged into the next run.
 * - Per-room rate limit, global concurrency limit, daily call budget, hard timeout.
 * - The model only sees public state and can only act through the room's controlled tools.
 * - Any failure degrades to a system notice; the game never waits for the agent.
 */
import type { AiStatus, GameMeta } from "@apr/shared";
import { gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { aiCalls } from "../db/schema.ts";
import { RateLimiter } from "../util/rateLimit.ts";
import { newId } from "../util/tokens.ts";
import { type AgentModel, type AgentTool, defineTool } from "./model.ts";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.ts";

export type AgentTrigger =
  | { kind: "mention"; nickname: string; text: string }
  | { kind: "recommend"; nickname: string };

export interface AgentRoomContext {
  /** Secret-free description of the authoritative room/game state. */
  state: string;
  recentChat: { speaker: string; text: string }[];
  games: GameMeta[];
}

/** What the agent is allowed to see and do in a room. Implemented by RoomRuntime. */
export interface AgentRoomPort {
  readonly roomId: string;
  agentContext(): AgentRoomContext;
  /** Shows a game suggestion to the room; the host decides. Returns a truthful outcome. */
  suggestGame(gameId: string, reason: string): Promise<{ ok: boolean; message: string }>;
  postChat(kind: "agent" | "system", text: string): Promise<void>;
  setAiStatus(status: AiStatus): void;
}

export interface AgentLimits {
  timeoutMs: number;
  maxConcurrency: number;
  roomCallsPerMinute: number;
  dailyCallLimit: number;
}

interface RoomAgentState {
  pending: AgentTrigger[];
  running: boolean;
  lastNoticeAt: number;
}

const MAX_PENDING = 10;
const NOTICE_INTERVAL_MS = 60_000;

export class AgentService {
  private readonly rooms = new Map<string, RoomAgentState>();
  private readonly roomLimiter: RateLimiter;
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly model: AgentModel | null,
    private readonly db: Db,
    private readonly limits: AgentLimits,
  ) {
    this.roomLimiter = new RateLimiter(limits.roomCallsPerMinute, 60_000);
  }

  get enabled(): boolean {
    return this.model !== null;
  }

  initialStatus(): AiStatus {
    return this.enabled
      ? { enabled: true, state: "idle" }
      : { enabled: false, state: "unavailable", note: "未配置 AI" };
  }

  /** Never throws and never blocks on the model. Returns whether the trigger was queued. */
  trigger(room: AgentRoomPort, trigger: AgentTrigger): boolean {
    const st = this.stateFor(room.roomId);
    if (!this.model) {
      this.notice(room, st, "AI 主持未启用。游戏、计分和房主操作不受影响，可以直接在左侧选择游戏。");
      return false;
    }
    if (st.pending.length >= MAX_PENDING) st.pending.shift();
    st.pending.push(trigger);
    if (!st.running) void this.drain(room, st, this.model);
    return true;
  }

  private stateFor(roomId: string): RoomAgentState {
    let st = this.rooms.get(roomId);
    if (!st) {
      st = { pending: [], running: false, lastNoticeAt: 0 };
      this.rooms.set(roomId, st);
    }
    return st;
  }

  /** System notices are throttled so repeated clicks cannot flood the chat. */
  private notice(room: AgentRoomPort, st: RoomAgentState, text: string) {
    const now = Date.now();
    if (now - st.lastNoticeAt < NOTICE_INTERVAL_MS) return;
    st.lastNoticeAt = now;
    room.postChat("system", text).catch(() => {});
  }

  private async drain(room: AgentRoomPort, st: RoomAgentState, model: AgentModel): Promise<void> {
    st.running = true;
    try {
      while (st.pending.length > 0) {
        // Everything that arrived so far is answered by one model call.
        const batch = st.pending.splice(0);
        if (!this.roomLimiter.take(room.roomId)) {
          this.notice(room, st, "AI 请求太频繁了，请稍后再 @AI。");
          continue;
        }
        if (await this.overDailyBudget()) {
          room.setAiStatus({ enabled: true, state: "unavailable", note: "今日 AI 额度已用完" });
          this.notice(room, st, "今日 AI 额度已用完，游戏功能不受影响。");
          continue;
        }
        await this.runOnce(room, st, model, batch);
      }
    } finally {
      st.running = false;
    }
  }

  private async runOnce(room: AgentRoomPort, st: RoomAgentState, model: AgentModel, batch: AgentTrigger[]) {
    await this.acquire();
    room.setAiStatus({ enabled: true, state: "thinking" });
    try {
      const result = await model.run({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(room.agentContext(), batch),
        tools: this.toolsFor(room),
        signal: AbortSignal.timeout(this.limits.timeoutMs),
      });
      await this.record(room.roomId, "ok", result.inputTokens, result.outputTokens);
      if (result.text) await room.postChat("agent", result.text);
      room.setAiStatus({ enabled: true, state: "idle" });
    } catch (err) {
      console.warn(`[agent] room=${room.roomId} call failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.record(room.roomId, "error", 0, 0).catch(() => {});
      room.setAiStatus({ enabled: true, state: "unavailable", note: "AI 暂时不可用" });
      this.notice(room, st, "AI 主持暂时不可用，游戏不受影响。稍后可以再试。");
    } finally {
      this.release();
    }
  }

  /** The complete set of things the model can do. Each tool re-checks state and permissions itself. */
  private toolsFor(room: AgentRoomPort): AgentTool[] {
    return [
      defineTool({
        name: "suggest_game",
        description:
          "向房间展示一条「推荐玩这个游戏」的建议卡片，由房主决定是否开始。只能推荐已实现游戏列表中的 gameId。只有在大厅（没有进行中的游戏）时可用。",
        inputSchema: z.object({
          gameId: z.string().describe("已实现游戏的 id"),
          reason: z.string().max(120).describe("给玩家看的一句推荐理由"),
        }),
        run: async ({ gameId, reason }) => (await room.suggestGame(gameId, reason)).message,
      }),
    ];
  }

  private async overDailyBudget(): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiCalls)
      .where(gte(aiCalls.createdAt, since));
    return (row?.n ?? 0) >= this.limits.dailyCallLimit;
  }

  private async record(roomId: string, status: "ok" | "error", inputTokens: number, outputTokens: number) {
    await this.db.insert(aiCalls).values({ id: newId("ai"), roomId, status, inputTokens, outputTokens });
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.limits.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
  }

  private release() {
    this.active--;
    this.waiters.shift()?.();
  }
}
