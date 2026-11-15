/**
 * Builds a play report for one party: a readable summary, a file index and detail files.
 * Read-only. Players appear as P1, P2, … (stable within a room); nicknames, invite tokens,
 * session token hashes and keys are never written. Chat text and raw game state are included
 * only on request, and the index says so.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCORING_VERSION } from "@apr/shared";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import {
  aiCalls,
  chatMessages,
  contentUsage,
  events,
  feedback,
  partySessions,
  players,
  segments,
} from "./db/schema.ts";
import { buildRecap } from "./rooms/recap.ts";

/** Stable anonymous ids per room: P1 is the first player who joined, and so on. */
async function anonymiser(db: Db, roomId: string) {
  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.roomId, roomId))
    .orderBy(asc(players.createdAt));
  const map = new Map(rows.map((r, i) => [r.id, `P${i + 1}`]));
  const one = (id: string | null | undefined) => (id ? (map.get(id) ?? id) : id);
  /** Replaces every player id inside any JSON-like value. */
  const deep = (v: unknown): unknown => {
    if (typeof v === "string") return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [map.get(k) ?? k, deep(x)]));
    return v;
  };
  return { one, deep };
}

export interface ExportOptions {
  withChat?: boolean;
  /** Raw game state: contains secrets such as puzzle solutions. */
  withState?: boolean;
}

export async function exportParty(db: Db, sessionId: string, outRoot: string, opts: ExportOptions = {}) {
  const [session] = await db.select().from(partySessions).where(eq(partySessions.id, sessionId));
  if (!session) throw new Error(`no party ${sessionId}`);
  const { roomId } = session;
  const anon = await anonymiser(db, roomId);
  const dir = join(outRoot, sessionId);
  mkdirSync(join(dir, "segments"), { recursive: true });
  const files: { file: string; what: string }[] = [];
  const write = (file: string, what: string, data: unknown) => {
    writeFileSync(join(dir, file), typeof data === "string" ? data : JSON.stringify(data, null, 2));
    files.push({ file, what });
  };

  const recap = await buildRecap(db, roomId, sessionId);
  if (!recap) throw new Error("recap unavailable");
  // Nicknames are replaced by the anonymous ids.
  const names = Object.fromEntries(Object.keys(recap.names).map((id) => [id, anon.one(id) as string]));
  write(
    "recap.json",
    "排名、逐场战绩、调分、积分变化（与回顾页同源）",
    anon.deep({ ...recap, names: undefined, summary: recap.summary }),
  );

  const segs = await db
    .select()
    .from(segments)
    .where(eq(segments.sessionId, sessionId))
    .orderBy(asc(segments.createdAt));
  const usage = await db.select().from(contentUsage).where(eq(contentUsage.sessionId, sessionId));
  for (const s of segs) {
    write(
      `segments/${s.id}.json`,
      `游戏 ${s.gameId}：设置、参与者、结算快照、用到的题目版本${opts.withState ? "、完整游戏状态（含秘密）" : ""}`,
      {
        id: s.id,
        gameId: s.gameId,
        status: s.status,
        startedAt: s.createdAt,
        endedAt: s.endedAt,
        config: s.config,
        participants: anon.deep(s.participants),
        settlement: anon.deep(s.settlement),
        content: usage.filter((u) => u.segmentId === s.id).map((u) => ({ id: u.contentId, version: u.contentVersion })),
        ...(opts.withState ? { state: anon.deep(s.state) } : {}),
      },
    );
  }

  const log = await db.select().from(events).where(eq(events.sessionId, sessionId)).orderBy(asc(events.createdAt));
  write(
    "events.jsonl",
    "按时间排列的事件：操作类型与结果（不含操作内容和游戏秘密）",
    log
      .map((e) =>
        JSON.stringify({
          at: e.createdAt,
          segmentId: e.segmentId,
          type: e.type,
          actor: anon.one(e.actor),
          data: anon.deep(e.data),
        }),
      )
      .join("\n"),
  );
  const rejected = log.filter((e) => (e.data as { rejected?: string }).rejected);
  write(
    "rejected.json",
    "被服务端拒绝的操作及原因（越权、过期、重复等）",
    rejected.map((e) => ({
      at: e.createdAt,
      segmentId: e.segmentId,
      actor: anon.one(e.actor),
      action: (e.data as { type?: string }).type,
      reason: (e.data as { rejected?: string }).rejected,
    })),
  );

  const fb = await db.select().from(feedback).where(eq(feedback.sessionId, sessionId)).orderBy(asc(feedback.createdAt));
  write(
    "feedback.json",
    "玩家在局内提交的反馈，带当时的游戏、阶段和题目",
    fb.map((f) => ({
      at: f.createdAt,
      segmentId: f.segmentId,
      gameId: f.gameId,
      player: anon.one(f.playerId),
      kind: f.kind,
      note: f.note,
      context: f.context,
    })),
  );

  const calls = await db.select().from(aiCalls).where(eq(aiCalls.sessionId, sessionId)).orderBy(asc(aiCalls.createdAt));
  const roomCalls = await db
    .select()
    .from(aiCalls)
    .where(and(eq(aiCalls.roomId, roomId), gte(aiCalls.createdAt, session.createdAt), eq(aiCalls.purpose, "room")))
    .orderBy(asc(aiCalls.createdAt));
  const allCalls = [
    ...calls,
    ...roomCalls.filter(
      (c) => !calls.some((x) => x.id === c.id) && (!session.endedAt || c.createdAt <= session.endedAt),
    ),
  ];
  write(
    "ai-calls.json",
    "每次模型调用：用途、模型、状态、耗时、token 数（不含提示词和回复）",
    allCalls.map((c) => ({
      at: c.createdAt,
      purpose: c.purpose,
      model: c.model,
      status: c.status,
      error: c.error,
      ms: c.durationMs,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
    })),
  );

  if (opts.withChat) {
    const chat = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.roomId, roomId), eq(chatMessages.sessionId, sessionId)))
      .orderBy(asc(chatMessages.createdAt));
    write(
      "chat.json",
      "本场派对的聊天原文（受控调试包才包含）",
      chat.map((m) => ({
        at: m.createdAt,
        sender: m.senderKind === "player" ? anon.one(m.playerId) : m.senderKind,
        text: m.text,
      })),
    );
  }

  const aiFailed = allCalls.filter((c) => c.status === "error");
  const durations = allCalls.map((c) => c.durationMs ?? 0).filter((n) => n > 0);
  const summary = [
    `# 试玩报告 · 第 ${recap.number} 场派对`,
    "",
    `- 派对：\`${sessionId}\`（房间 \`${roomId}\`），${session.status === "ended" ? "已结束" : "进行中"}`,
    `- 时间：${session.createdAt.toISOString()} – ${session.endedAt?.toISOString() ?? "…"}`,
    `- 构建：\`${process.env.BUILD_VERSION ?? "unknown"}\`；计分口径：\`${session.scoring}\`（当前规则版本 \`${SCORING_VERSION}\`）`,
    `- 参与者：${Object.values(names).join("、")}（匿名编号，房间内稳定）`,
    `- 本报告${opts.withChat ? "**包含聊天原文**" : "不含聊天原文"}，${opts.withState ? "**包含完整游戏状态（有谜底等秘密）**" : "不含游戏秘密"}；不含任何凭据。`,
    "",
    "## 概览",
    "",
    `- 游戏：${recap.games.map((g) => `${g.gameName}${g.status === "aborted" ? "（放弃）" : ""}`).join("、") || "无"}`,
    `- 最终排名：${recap.ranking.map((r) => `${names[r.playerId]} ${r.tenths / 10}`).join("，") || "无"}`,
    `- 反馈 ${fb.length} 条${fb.length ? `：${fb.map((f) => `${f.kind}${f.note ? `「${f.note}」` : ""}@${f.gameId ?? "大厅"}`).join("；")}` : ""}`,
    `- 被拒绝的操作 ${rejected.length} 次${rejected.length ? `（最多的原因：${mostCommon(rejected.map((e) => String((e.data as { rejected?: string }).rejected)))}）` : ""}`,
    `- 模型调用 ${allCalls.length} 次，失败 ${aiFailed.length} 次${aiFailed.length ? `（${mostCommon(aiFailed.map((c) => `${c.purpose}:${c.error ?? "?"}`))}）` : ""}；` +
      `平均 ${durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0} ms，` +
      `合计 ${allCalls.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0)} tokens`,
    `- 调分：批准 ${recap.adjustments.length} 次`,
    "",
    "## 文件",
    "",
    ...files.map((f) => `- \`${f.file}\` — ${f.what}`),
    "",
    "## 复现说明",
    "",
    "事件日志记录了操作的顺序、类型和结果，以及每场游戏的设置和题目版本；**不记录**操作内容、随机数和模型原始回复。",
    "所以可以据此搭一个最小的近似场景（同一游戏、同样的设置和题目、同样的操作顺序），但不能声称逐字重放。需要逐步重放时，用 `--with-state` 导出受控调试包。",
    "",
  ].join("\n");
  writeFileSync(join(dir, "summary.md"), summary);
  writeFileSync(
    join(dir, "index.json"),
    JSON.stringify(
      {
        sessionId,
        roomId,
        build: process.env.BUILD_VERSION ?? "unknown",
        scoring: session.scoring,
        exportedAt: new Date().toISOString(),
        contains: { chat: opts.withChat === true, gameState: opts.withState === true, credentials: false },
        files: [{ file: "summary.md", what: "摘要（先读这个）" }, ...files],
      },
      null,
      2,
    ),
  );
  return { dir, feedback: fb.length, rejected: rejected.length };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
