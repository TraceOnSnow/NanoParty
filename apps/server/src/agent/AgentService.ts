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
import { type AgentInteractionSpec, type AiStatus, agentInteractionSpec, type GameMeta } from "@apr/shared";
import { gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { aiCalls } from "../db/schema.ts";
import { RateLimiter } from "../util/rateLimit.ts";
import { newId } from "../util/tokens.ts";
import { type AgentModel, type AgentTool, defineTool } from "./model.ts";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.ts";

export type AgentTrigger =
  | { kind: "mention"; playerId: string; nickname: string; text: string }
  | { kind: "recommend"; playerId: string; nickname: string }
  /** An interaction the agent created has finished; `result` is its structured outcome as text. */
  | { kind: "interaction"; title: string; result: string };

export interface AgentRoomContext {
  /** Secret-free description of the authoritative room/game state. */
  state: string;
  members: { id: string; nickname: string; isHost: boolean }[];
  /** What is on the main-panel canvas right now and what is queued. */
  canvas: string;
  /** The agent's own note from earlier steps of the flow it is organising. */
  note: string | null;
  /** Whether the running game takes candidate content from outside, and in which format. */
  content: { gameAcceptsOffers: true; type: string; guide: string } | { gameAcceptsOffers: false } | null;
  recentChat: { speaker: string; text: string }[];
  games: GameMeta[];
}

/** What the agent is allowed to see and do in a room. Implemented by RoomRuntime. */
export interface AgentRoomPort {
  readonly roomId: string;
  agentContext(): AgentRoomContext;
  /** Shows a game suggestion to the room; the host decides. Returns a truthful outcome. */
  suggestGame(gameId: string, reason: string): Promise<{ ok: boolean; message: string }>;
  /** Puts an interaction on the main panel (queued until a safe point). Does not wait for players. */
  createInteraction(spec: AgentInteractionSpec): Promise<{ ok: boolean; message: string }>;
  /** Validates and stores new content in the library, labelled as AI-generated. */
  saveContent(type: string, theme: string, payloads: unknown[]): Promise<{ ok: boolean; message: string }>;
  /** Hands stored content to the running game as candidates; the game decides how to use it. */
  /** `requester` = the player whose request this serves (null = a flow the room is running). */
  offerContent(ids: string[], requester?: string | null): Promise<{ ok: boolean; message: string }>;
  /** Asks the host to approve starting a game with given settings. Executed by the program on approval. */
  proposeStartGame(
    gameId: string,
    config: Record<string, number>,
    reason: string,
  ): Promise<{ ok: boolean; message: string }>;
  setNote(text: string): Promise<void>;
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
  /** Consecutive runs started only by the agent's own interactions finishing. */
  autoSteps: number;
  /** The player whose request the current flow serves; kept across the agent's own steps. */
  requester: string | null;
}

/**
 * How many steps the agent may take in a row without a person asking for something.
 * Keeps a flow from running away (and from spending without limit).
 */
export const MAX_AUTO_STEPS = 6;

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
    private readonly label = "模型",
  ) {
    this.roomLimiter = new RateLimiter(limits.roomCallsPerMinute, 60_000);
  }

  get enabled(): boolean {
    return this.model !== null;
  }

  /** Recorded as the origin of content the agent writes. */
  get modelLabel(): string {
    return this.label;
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
      // A finished interaction needs no notice: its result is already on screen and in the chat.
      if (trigger.kind !== "interaction") {
        this.notice(room, st, "AI 主持未启用。游戏、计分和房主操作不受影响，可以直接在左侧选择游戏。");
      }
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
      st = { pending: [], running: false, lastNoticeAt: 0, autoSteps: 0, requester: null };
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
        const asker = batch.findLast(
          (t): t is Exclude<AgentTrigger, { kind: "interaction" }> => t.kind !== "interaction",
        );
        if (asker) {
          st.autoSteps = 0;
          st.requester = asker.playerId;
        } else if (++st.autoSteps > MAX_AUTO_STEPS) {
          st.lastNoticeAt = 0;
          this.notice(room, st, `AI 主持已经连续自动进行了 ${MAX_AUTO_STEPS} 步，先停一下。需要继续的话请 @AI。`);
          continue;
        }
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
        tools: this.toolsFor(room, st.requester),
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
  private toolsFor(room: AgentRoomPort, requester: string | null): AgentTool[] {
    return [
      defineTool({
        name: "create_interaction",
        description:
          "在主面板创建一个多人互动，用来向玩家收集信息或展示内容。三种：collect（每人提交一句短文字）、choose（从选项里选一个；多人回应就是投票，只让一个人回应就是让 TA 挑选）、show（只展示标题/说明/若干条目，不需要回应）。互动会在回合之间的间隙显示。调用后不要等待：玩家回应完后你会被再次唤醒并拿到结果。一次只创建一个互动。",
        // Tool inputs must be a plain object at the top level, so the spec is nested.
        inputSchema: z.object({ interaction: agentInteractionSpec }),
        run: async ({ interaction }) => (await room.createInteraction(interaction)).message,
      }),
      defineTool({
        name: "save_content",
        description:
          "把你写的游戏内容（题目）存入题库，返回它们的 id。payload 必须符合该内容类型的格式（见「可生成的内容」）。保存后要用 offer_content 交给游戏，玩家才会看到。",
        inputSchema: z.object({
          contentType: z.string().describe("内容类型，例如 spectrum"),
          theme: z.string().max(40).describe("主题标签，例如「英雄联盟」"),
          items: z.array(z.record(z.string(), z.unknown())).min(1).max(8).describe("每条内容的 payload"),
        }),
        run: async ({ contentType, theme, items }) => (await room.saveContent(contentType, theme, items)).message,
      }),
      defineTool({
        name: "offer_content",
        description:
          "把题库里的内容（用 id）作为候选交给正在进行的游戏。只有在选题阶段、且请求来自本轮题主（或房主）时，它们才会成为当前候选；否则会进入左侧的「历史候选」，由题主自己决定要不要用；已经确定的题目不会被替换。以工具返回的结果为准告诉玩家，最终用哪条由玩家决定，不是你。",
        inputSchema: z.object({ contentIds: z.array(z.string()).min(1).max(8) }),
        run: async ({ contentIds }) => (await room.offerContent(contentIds, requester)).message,
      }),
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
      defineTool({
        name: "propose_start_game",
        description:
          "请求房主批准「以指定设置开始某个游戏」。会在主面板给房主显示确认面板；房主批准后由系统执行，你会收到结果。玩家明确想要特定设置（轮数、时限）时用它，否则用 suggest_game。",
        inputSchema: z.object({
          gameId: z.string(),
          config: z.record(z.string(), z.number()).describe("设置键值，只能用该游戏列出的设置键").default({}),
          reason: z.string().max(200).describe("给房主看的说明"),
        }),
        run: async ({ gameId, config, reason }) => (await room.proposeStartGame(gameId, config, reason)).message,
      }),
      defineTool({
        name: "note_plan",
        description:
          "给未来的自己留一条简短备忘（会覆盖上一条）。当你在组织一个需要好几步的流程时，记下玩家想要什么、已经做到哪一步、接下来要做什么；流程结束后写入空字符串清除。",
        inputSchema: z.object({ text: z.string().max(600) }),
        run: async ({ text }) => {
          await room.setNote(text);
          return text ? "已记下" : "已清除备忘";
        },
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
