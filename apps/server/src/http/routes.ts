import { existsSync } from "node:fs";
import { commandEnvelope, createRoomRequest, type InviteInfo, type JoinResponse, joinRoomRequest } from "@apr/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import express, { type Request, type Response } from "express";
import type { AgentService } from "../agent/AgentService.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { partySessions, players, rooms } from "../db/schema.ts";
import type { RoomManager } from "../rooms/RoomManager.ts";
import { RateLimiter } from "../util/rateLimit.ts";
import { newId, randomToken, safeEqual, sha256 } from "../util/tokens.ts";

export const MAX_ROOM_MEMBERS = 8;

export interface HttpDeps {
  config: Config;
  db: Db;
  agent: AgentService;
  manager: RoomManager;
}

export function mountRoutes(app: express.Application, { config, db, agent, manager }: HttpDeps) {
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  const api = express.Router();
  api.use(express.json({ limit: "16kb" }));

  // Brute-force protection for the admin password and invite tokens.
  const adminLimiter = new RateLimiter(10, 10 * 60_000);
  const joinLimiter = new RateLimiter(30, 60_000);
  const limited = (limiter: RateLimiter, req: Request, res: Response) => {
    if (limiter.take(req.ip ?? "unknown")) return false;
    res.status(429).json({ error: "请求过于频繁，请稍后再试" });
    return true;
  };

  api.get("/health", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ ok: true, ai: agent.enabled, testMode: config.testMode });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  /** Creates a room. Requires the instance admin password; the creator becomes the host. */
  api.post("/rooms", async (req, res) => {
    if (limited(adminLimiter, req, res)) return;
    const body = createRoomRequest.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "请填写房间名和昵称" });
    if (!safeEqual(body.data.adminPassword, config.adminPassword)) {
      return res.status(403).json({ error: "管理员密码不正确" });
    }
    const roomId = newId("room");
    const playerId = newId("p");
    const sessionToken = randomToken();
    await db.transaction(async (tx) => {
      await tx
        .insert(rooms)
        .values({ id: roomId, name: body.data.roomName, inviteToken: randomToken(), hostPlayerId: playerId });
      await tx
        .insert(players)
        .values({ id: playerId, roomId, nickname: body.data.nickname, sessionTokenHash: sha256(sessionToken) });
      await tx.insert(partySessions).values({ id: newId("ses"), roomId, status: "active" });
    });
    console.log(`[http] room created ${roomId}`);
    res.json({ roomId, playerId, sessionToken } satisfies JoinResponse);
  });

  /** Lets the join page show the room name. Reveals nothing else. */
  api.get("/invites/:token", async (req, res) => {
    if (limited(joinLimiter, req, res)) return;
    const [room] = await db.select({ name: rooms.name }).from(rooms).where(eq(rooms.inviteToken, req.params.token));
    if (!room) return res.status(404).json({ error: "邀请链接无效或已失效" });
    res.json({ roomName: room.name } satisfies InviteInfo);
  });

  /** Joins with an invite token + nickname. Issues an independent player session token. */
  api.post("/join", async (req, res) => {
    if (limited(joinLimiter, req, res)) return;
    const body = joinRoomRequest.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "请填写昵称" });
    const [room] = await db.select().from(rooms).where(eq(rooms.inviteToken, body.data.inviteToken));
    if (!room) return res.status(404).json({ error: "邀请链接无效或已失效" });

    const playerId = newId("p");
    const sessionToken = randomToken();
    const joined = await db.transaction(async (tx) => {
      // Serialises concurrent joins of the same room so the member cap holds.
      await tx.execute(sql`select 1 from ${rooms} where ${rooms.id} = ${room.id} for update`);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(players)
        .where(and(eq(players.roomId, room.id), isNull(players.removedAt)));
      if ((count?.n ?? 0) >= MAX_ROOM_MEMBERS) return false;
      await tx.insert(players).values({
        id: playerId,
        roomId: room.id,
        nickname: body.data.nickname,
        sessionTokenHash: sha256(sessionToken),
      });
      return true;
    });
    if (!joined) return res.status(409).json({ error: `房间已满（最多 ${MAX_ROOM_MEMBERS} 人）` });
    res.json({ roomId: room.id, playerId, sessionToken } satisfies JoinResponse);
  });

  if (config.testMode) mountTestRoutes(api, { db, manager });

  api.use((_req, res) => res.status(404).json({ error: "not found" }));
  app.use("/api", api);

  // Production: serve the built web app from the same origin (no CORS, one container).
  if (existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|matchmake\/).*/, (_req, res) => res.sendFile("index.html", { root: config.webDist }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error("[http] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "服务器内部错误" });
  });
}

/**
 * Test-only endpoints (TEST_MODE=true): build a room full of test players in one call, act as
 * any of them, let them make plain legal moves, and read the full server state for assertions.
 * They are not mounted at all on a normal instance, so there is nothing to probe in production.
 * Acting still goes through RoomRuntime.handleCommand, i.e. the same permission checks as a client.
 */
function mountTestRoutes(api: express.Router, { db, manager }: { db: Db; manager: RoomManager }) {
  const test = express.Router();

  test.post("/rooms", async (req, res) => {
    const count = Math.min(MAX_ROOM_MEMBERS, Math.max(1, Number(req.body?.players) || 4));
    const names: string[] = Array.isArray(req.body?.names) ? req.body.names : [];
    const roomId = newId("room");
    const seats = Array.from({ length: count }, (_, i) => ({
      playerId: newId("p"),
      nickname: String(names[i] ?? `测试${i + 1}`).slice(0, 20),
      sessionToken: randomToken(),
    }));
    await db.transaction(async (tx) => {
      await tx.insert(rooms).values({
        id: roomId,
        name: String(req.body?.roomName ?? "测试房间").slice(0, 40),
        inviteToken: randomToken(),
        hostPlayerId: (seats[0] as (typeof seats)[0]).playerId,
      });
      for (const [i, s] of seats.entries()) {
        await tx.insert(players).values({
          id: s.playerId,
          roomId,
          nickname: s.nickname,
          sessionTokenHash: sha256(s.sessionToken),
          // Distinct timestamps keep the join order stable.
          createdAt: new Date(Date.now() + i),
        });
      }
      await tx.insert(partySessions).values({ id: newId("ses"), roomId, status: "active" });
    });
    res.json({ roomId, seats });
  });

  const withRoom = async (req: Request, res: Response) => {
    const runtime = await manager.get(String(req.params.roomId));
    if (!runtime) res.status(404).json({ error: "room not found" });
    return runtime;
  };

  test.get("/rooms/:roomId/state", async (req, res) => {
    const runtime = await withRoom(req, res);
    if (runtime) res.json(runtime.debugState());
  });

  test.get("/rooms/:roomId/view/:playerId", async (req, res) => {
    const runtime = await withRoom(req, res);
    if (!runtime) return;
    const view = runtime.viewOf(String(req.params.playerId));
    if (!view) return res.status(404).json({ error: "player not found" });
    res.json(view);
  });

  /** Sends a command as the given player. */
  test.post("/rooms/:roomId/act", async (req, res) => {
    const runtime = await withRoom(req, res);
    if (!runtime) return;
    const envelope = commandEnvelope.safeParse({ cmdId: newId("test"), command: req.body?.command });
    if (!envelope.success) return res.status(400).json({ error: "invalid command" });
    res.json(await runtime.handleCommand(String(req.body?.playerId), envelope.data));
  });

  /** One plain legal move for each listed player (default: everyone). */
  test.post("/rooms/:roomId/autoplay", async (req, res) => {
    const runtime = await withRoom(req, res);
    if (!runtime) return;
    const all = runtime.debugState().members.map((m) => m.id);
    const except: string[] = Array.isArray(req.body?.except) ? req.body.except : [];
    const ids: string[] = Array.isArray(req.body?.players) ? req.body.players : all;
    res.json({ moves: await runtime.autoplay(ids.filter((id) => !except.includes(id))) });
  });

  api.use("/test", test);
}
