/**
 * End-to-end over real HTTP + WebSocket (Colyseus transport), without AI.
 * A second file-backed run exercises a real process-level restart.
 * Set TEST_DATABASE_URL to run the same scenarios against a real PostgreSQL (as CI does).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ack, ChatMessageView, Command, JoinResponse, RoomView } from "@apr/shared";
import { MSG } from "@apr/shared";
import { Client, type Room } from "@colyseus/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { type App, startApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { waitFor } from "./helpers.ts";

const ADMIN = "test-admin-password";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

function config(port: number, pgliteDir?: string): Config {
  return {
    port,
    adminPassword: ADMIN,
    databaseUrl: process.env.TEST_DATABASE_URL,
    pgliteDir,
    webDist: "/nonexistent",
    trustProxy: false,
    testMode: false,
    ai: {
      provider: "anthropic",
      mock: false,
      model: "none",
      effort: "low",
      refusalFallback: false,
      timeoutMs: 1000,
      maxConcurrency: 1,
      roomCallsPerMinute: 5,
      dailyCallLimit: 5,
    },
  };
}

class Player {
  view!: RoomView;
  chat: ChatMessageView[] = [];
  room!: Room;
  private n = 0;

  constructor(
    private readonly base: string,
    readonly seat: JoinResponse,
  ) {}

  async connect(): Promise<this> {
    this.room = await new Client(this.base).joinOrCreate("party", {
      partyId: this.seat.roomId,
      token: this.seat.sessionToken,
    });
    this.room.onMessage(MSG.view, (v: RoomView) => {
      this.view = v;
    });
    this.room.onMessage(MSG.chatHistory, (h: ChatMessageView[]) => {
      this.chat = [...h];
    });
    this.room.onMessage(MSG.chatMessage, (m: ChatMessageView) => {
      this.chat.push(m);
    });
    await waitFor(() => this.view !== undefined);
    return this;
  }

  private request(type: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve, reject) =>
      this.room.send(type, payload, (res: Ack, err?: Error) => (err ? reject(err) : resolve(res))),
    );
  }

  cmd(command: Command): Promise<Ack> {
    return this.request(MSG.command, { cmdId: `${this.seat.playerId}-${Date.now()}-${this.n++}`, command });
  }

  act(action: unknown): Promise<Ack> {
    return this.cmd({ type: "gameAction", segmentId: this.view.segment?.id ?? "none", action });
  }

  say(text: string): Promise<Ack> {
    return this.request(MSG.chat, { text });
  }

  // biome-ignore lint/suspicious/noExplicitAny: game views are game-specific
  get game(): any {
    return this.view.segment?.view;
  }
}

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("end to end (HTTP + WebSocket, no AI)", () => {
  it("create → invite → join → play → reconnect → finish → lobby", async () => {
    const port = await freePort();
    const base = `http://localhost:${port}`;
    app = await startApp(config(port));
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, ai: false, testMode: false });

    // Access control on the REST surface.
    expect((await post(base, "/rooms", { adminPassword: "nope-nope", roomName: "x", nickname: "x" })).status).toBe(403);
    expect((await post(base, "/join", { inviteToken: "not-a-real-invite", nickname: "x" })).status).toBe(404);
    expect((await fetch(`${base}/api/invites/not-a-real-invite`)).status).toBe(404);

    const created = await post(base, "/rooms", { adminPassword: ADMIN, roomName: "周五局", nickname: "阿房" });
    expect(created.status).toBe(200);
    const host = await new Player(base, created.body as JoinResponse).connect();
    expect(host.view.me.isHost).toBe(true);
    const invite = host.view.inviteToken as string;
    expect(invite.length).toBeGreaterThanOrEqual(32);
    expect(await (await fetch(`${base}/api/invites/${invite}`)).json()).toEqual({ roomName: "周五局" });

    // Same nickname as the host grants nothing: nicknames are display only.
    const j1 = await post(base, "/join", { inviteToken: invite, nickname: "阿房" });
    const j2 = await post(base, "/join", { inviteToken: invite, nickname: "小丙" });
    const b = await new Player(base, j1.body as JoinResponse).connect();
    const c = await new Player(base, j2.body as JoinResponse).connect();
    expect(b.view.me.isHost).toBe(false);
    expect(b.view.inviteToken).toBeUndefined();
    await waitFor(() => host.view.members.length === 3 && host.view.members.every((m) => m.connected));

    // A made-up session token cannot connect.
    await expect(
      new Client(base).joinOrCreate("party", { partyId: host.seat.roomId, token: "x".repeat(32) }),
    ).rejects.toThrow();

    // Chat reaches everyone; with AI off an @AI mention only yields a system notice.
    expect(await c.say("@AI 来个推荐")).toEqual({ ok: true });
    await waitFor(() => host.chat.some((m) => m.sender.kind === "system"));

    // Manual start without talking to any AI.
    expect(await b.cmd({ type: "startGame", gameId: "estimate" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 1, answerSeconds: 0 } })).toEqual({
      ok: true,
    });
    await waitFor(() => c.view.segment !== null);

    expect(await b.act({ type: "submit", round: 1, value: 55 })).toEqual({ ok: true });
    await waitFor(() => c.game.submitted.length === 1);
    expect(c.game.myGuess).toBeNull();

    // b's connection drops and comes back with the same token: same player, submission intact.
    await b.room.leave(false);
    await waitFor(() => host.view.members.find((m) => m.id === b.seat.playerId)?.connected === false);
    const b2 = await new Player(base, b.seat).connect();
    expect(b2.view.me.playerId).toBe(b.seat.playerId);
    expect(b2.view.members).toHaveLength(3);
    expect(b2.game.myGuess).toBe(55);

    expect(await host.act({ type: "submit", round: 1, value: 60 })).toEqual({ ok: true });
    expect(await c.act({ type: "submit", round: 1, value: 65 })).toEqual({ ok: true });
    await waitFor(() => b2.game.phase === "reveal");
    expect(b2.game.reveal.results).toHaveLength(3);
    // Raw game points are shown with the game; the party scoreboard only moves at settlement.
    expect(b2.view.segment?.rawScores.reduce((sum, s) => sum + s.points, 0)).toBeGreaterThanOrEqual(2);
    expect(b2.view.scoreboard.every((s) => s.points === 0)).toBe(true);

    expect(await host.act({ type: "next", round: 1 })).toEqual({ ok: true });
    await waitFor(() => c.view.segment === null && c.view.settlement !== null);
    const segmentId = c.view.settlement?.segmentId ?? "";
    expect(await b2.cmd({ type: "confirmSettlement", segmentId, adjustmentId: null })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "confirmSettlement", segmentId, adjustmentId: null })).toEqual({ ok: true });
    await waitFor(() => c.view.settlement === null);
    expect(c.view.lastSegment?.endedReason).toBe("finished");
    expect(c.view.scoreboard).toEqual(host.view.scoreboard);
    expect(c.view.scoreboard.reduce((sum, s) => sum + s.points, 0)).toBe(15); // 10 + 5 + 0 for three players
  });

  it("caps a room at 8 members", async () => {
    const port = await freePort();
    const base = `http://localhost:${port}`;
    app = await startApp(config(port));
    const created = await post(base, "/rooms", { adminPassword: ADMIN, roomName: "满员", nickname: "h" });
    const host = await new Player(base, created.body as JoinResponse).connect();
    const invite = host.view.inviteToken as string;
    const joins = await Promise.all(
      Array.from({ length: 9 }, (_, i) => post(base, "/join", { inviteToken: invite, nickname: `g${i}` })),
    );
    expect(joins.filter((j) => j.status === 200)).toHaveLength(7);
    expect(joins.filter((j) => j.status === 409)).toHaveLength(2);
  });

  it("survives a full server restart on a persistent database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apr-e2e-"));
    try {
      const port = await freePort();
      const base = `http://localhost:${port}`;
      app = await startApp(config(port, dir));
      const created = await post(base, "/rooms", { adminPassword: ADMIN, roomName: "重启", nickname: "h" });
      const host = await new Player(base, created.body as JoinResponse).connect();
      const joined = await post(base, "/join", { inviteToken: host.view.inviteToken, nickname: "g" });
      const guest = await new Player(base, joined.body as JoinResponse).connect();
      await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 2, answerSeconds: 0 } });
      await waitFor(() => guest.view.segment !== null);
      await guest.act({ type: "submit", round: 1, value: 9 });
      await host.say("重启前的消息");
      const question = guest.game.question.text;

      await app.close();
      app = await startApp(config(port, dir));

      const guest2 = await new Player(base, guest.seat).connect();
      const host2 = await new Player(base, host.seat).connect();
      expect(guest2.view.segment?.status).toBe("paused");
      expect(guest2.game.question.text).toBe(question);
      expect(guest2.game.myGuess).toBe(9);
      expect(guest2.chat.map((m) => m.text)).toContain("重启前的消息");
      expect(await host2.cmd({ type: "resumeSegment", segmentId: host2.view.segment?.id as string })).toEqual({
        ok: true,
      });
      expect(await host2.act({ type: "submit", round: 1, value: 10 })).toEqual({ ok: true });
      await waitFor(() => guest2.game.phase === "reveal");
    } finally {
      await app?.close();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
