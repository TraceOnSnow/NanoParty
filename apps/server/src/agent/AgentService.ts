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
import { buildPrompt, systemPrompt } from "./prompt.ts";

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
  /** This party's chat, already shaped by `shapeChat` (players whole, the host's own lines cut short). */
  recentChat: { speaker: string; text: string }[];
  /** Players' lines from earlier parties of this room: a sample of how this group talks. */
  earlierChat?: { speaker: string; text: string }[];
  /** How bold the host's proposals may be. Never changes what it is allowed to do. */
  mode: "normal" | "quirky";
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
  /**
   * Proposes a change to party points. Shown on the main panel; only the host's approval
   * credits it. Points may be negative.
   */
  proposeAdjustment(
    items: { playerId: string; points: number }[],
    reason: string,
    requester?: string | null,
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
  /** When the host proposed adjustments, by requester ("" = a flow of its own). */
  adjustAsks: { requester: string; at: number }[];
}

/** The host may put forward one adjustment per requester in this window, and a few per room. */
const ADJUST_PER_REQUESTER_MS = 3 * 60_000;
const ADJUST_ROOM_WINDOW_MS = 10 * 60_000;
const ADJUST_ROOM_MAX = 3;

/** A reply longer than this is a runaway, not a chat line. */
const MAX_REPLY_CHARS = 400;
const MAX_SPLIT_LINES = 3;
const SPLIT_LINE_CHARS = 30;

/**
 * What of the model's text actually reaches the chat: nothing when it chose to stay silent or
 * leaked tool-call markup; otherwise the text without emphasis marks, as one message or, when
 * it wrote a few short lines, as separate messages the way people send them.
 */
export function cleanReply(raw: string): string[] {
  const text = raw.replace(/\*\*/g, "").trim();
  if (!text) return [];
  if (/^[（(]\s*不回\s*[）)]$/.test(text)) return [];
  if (/DSML|<\s*[｜|]|invoke name=|<\/?(tool_call|function_calls?)>/i.test(text)) return [];
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[（(]\s*不回\s*[）)]$/.test(l));
  if (lines.length === 0) return [];
  if (lines.length <= MAX_SPLIT_LINES && lines.every((l) => l.length <= SPLIT_LINE_CHARS)) return lines;
  if (text.length <= MAX_REPLY_CHARS) return [text];
  const cut = text.slice(0, MAX_REPLY_CHARS);
  const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("\n"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
  return [end > MAX_REPLY_CHARS / 2 ? cut.slice(0, end + 1) : cut];
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

  /** Marks every status as coming from the development stand-in, so it is never taken for a real model. */
  private get mockFlag(): { mock?: true } {
    return this.label === "模拟" ? { mock: true } : {};
  }

  /** Recorded as the origin of content the agent writes. */
  get modelLabel(): string {
    return this.label;
  }

  initialStatus(): AiStatus {
    return this.enabled
      ? { enabled: true, state: "idle", ...this.mockFlag }
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
      st = { pending: [], running: false, lastNoticeAt: 0, autoSteps: 0, requester: null, adjustAsks: [] };
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
    room.setAiStatus({ enabled: true, state: "thinking", ...this.mockFlag });
    const context = room.agentContext();
    try {
      const result = await model.run({
        system: systemPrompt(context.mode),
        prompt: buildPrompt(context, batch),
        tools: this.toolsFor(room, st),
        signal: AbortSignal.timeout(this.limits.timeoutMs),
      });
      await this.record(room.roomId, "ok", result.inputTokens, result.outputTokens);
      for (const line of cleanReply(result.text)) await room.postChat("agent", line);
      room.setAiStatus({ enabled: true, state: "idle", ...this.mockFlag });
    } catch (err) {
      console.warn(`[agent] room=${room.roomId} call failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.record(room.roomId, "error", 0, 0).catch(() => {});
      room.setAiStatus({ enabled: true, state: "unavailable", note: "AI 暂时不可用" });
      this.notice(room, st, "AI 主持暂时不可用，游戏不受影响。稍后可以再试。");
    } finally {
      this.release();
    }
  }

  /** Names and descriptions of the host's tools, for tooling that rebuilds a request offline. */
  static toolSummary(): { name: string; description: string }[] {
    const service = new AgentService(null, null as never, {
      timeoutMs: 0,
      maxConcurrency: 1,
      roomCallsPerMinute: 1,
      dailyCallLimit: 1,
    });
    const st: RoomAgentState = {
      pending: [],
      running: false,
      lastNoticeAt: 0,
      autoSteps: 0,
      requester: null,
      adjustAsks: [],
    };
    return service.toolsFor(null as never, st).map((t) => ({ name: t.name, description: t.description }));
  }

  /** The complete set of things the model can do. Each tool re-checks state and permissions itself. */
  private toolsFor(room: AgentRoomPort, st: RoomAgentState): AgentTool[] {
    const requester = st.requester;
    return [
      defineTool({
        name: "create_interaction",
        description:
          "在主面板创建一个多人互动，用来向玩家收集信息或展示内容。三种：collect（每人提交一句短文字）、choose（从选项里选一个；多人回应就是投票，只让一个人回应就是让 TA 挑选；anonymous=true 是匿名投票，只公布票数）、show（只展示标题/说明/若干条目，不需要回应）。互动会在回合之间的间隙显示。调用后不要等待：玩家回应完后你会被再次唤醒并拿到结果。一次只创建一个互动。",
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
        name: "propose_adjustment",
        description:
          "提出一个派对积分调整方案（可以是负数），显示在左侧主面板，由房主点确认后才入账。不是有人要就给：只有你自己觉得该动分的时候才用。playerId 用成员列表里的 id。提了只能说「提了」，不能说已经加了或扣了。新方案会替换之前没确认的方案。同一个人短时间内反复要分，工具会拒绝，你照实拒绝他就行。",
        inputSchema: z.object({
          items: z
            .array(z.object({ playerId: z.string(), points: z.number().describe("加减的分数，可为负，最多一位小数") }))
            .min(1)
            .max(8),
          reason: z.string().max(200).describe("给大家看的理由，可以玩梗，但不要编造没发生的事"),
        }),
        run: async ({ items, reason }) => {
          const now = Date.now();
          st.adjustAsks = st.adjustAsks.filter((a) => now - a.at < ADJUST_ROOM_WINDOW_MS);
          const who = requester ?? "";
          if (st.adjustAsks.some((a) => a.requester === who && now - a.at < ADJUST_PER_REQUESTER_MS)) {
            return "没提：这个人刚让你提过一次方案，几分钟内不再替他提。照实拒绝或者不理他，不要说已经提了。";
          }
          if (st.adjustAsks.length >= ADJUST_ROOM_MAX) {
            return "没提：这十分钟里你已经提了好几个调分方案了，先停一停。照实拒绝，不要说已经提了。";
          }
          const made = await room.proposeAdjustment(items, reason, requester);
          if (made.ok) st.adjustAsks.push({ requester: who, at: now });
          return made.message;
        },
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
