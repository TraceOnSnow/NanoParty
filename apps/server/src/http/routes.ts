import { existsSync } from "node:fs";
import { createRoomRequest, type InviteInfo, type JoinResponse, joinRoomRequest } from "@apr/shared";
import { eq, sql } from "drizzle-orm";
import express, { type Request, type Response } from "express";
import type { AgentService } from "../agent/AgentService.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { partySessions, players, rooms } from "../db/schema.ts";
import { RateLimiter } from "../util/rateLimit.ts";
import { newId, randomToken, safeEqual, sha256 } from "../util/tokens.ts";

export const MAX_ROOM_MEMBERS = 8;

export interface HttpDeps {
  config: Config;
  db: Db;
  agent: AgentService;
}

export function mountRoutes(app: express.Application, { config, db, agent }: HttpDeps) {
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
      res.json({ ok: true, ai: agent.enabled });
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
        .where(eq(players.roomId, room.id));
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
