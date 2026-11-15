/**
 * VNext batch 1: candidate history, picker rights, host override, AI offers, the two chat
 * entries, in-place feedback and the test-only endpoints.
 */
import { createServer } from "node:net";
import { desc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel } from "../src/agent/model.ts";
import { type App, startApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { events, feedback } from "../src/db/schema.ts";
import { loadRuntime, makeWorld, seedRoom, sleep, TestClient, type World, waitFor } from "./helpers.ts";

let world: World | undefined;
let app: App | undefined;
afterEach(async () => {
  await app?.close();
  await world?.handle.close();
  app = undefined;
  world = undefined;
});

const noTimers = { rounds: 0, pickSeconds: 0, voteSeconds: 0 };

async function setup(n: number, model: AgentModel | null = null) {
  world = await makeWorld(model);
  const { roomId, seats } = await seedRoom(world, n);
  const runtime = await loadRuntime(world, roomId);
  const clients = seats.map((s) => new TestClient(runtime, s.playerId));
  return { world, roomId, seats, runtime, clients };
}

const picker = (c: TestClient, all: TestClient[]) => all.find((x) => x.playerId === c.game.pick.picker) as TestClient;

/** Plays one round of 谁最可能 after the topic is chosen. */
async function playRound(all: TestClient[]) {
  for (const c of all) await c.act({ type: "vote", step: c.game.step, target: (all[0] as TestClient).playerId });
  await (all[0] as TestClient).act({ type: "next", step: (all[0] as TestClient).game.step });
}

describe("candidate history and picker rights (AC-07, AC-08)", () => {
  it("lets a non-host picker choose, refresh and find earlier candidates, across rounds and a restart", async () => {
    const { world, roomId, seats, clients } = await setup(3);
    const [host] = clients as [TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "mostlikely", config: noTimers });

    // Round 1: the first picker's three candidates; they take the first.
    const first = picker(host, clients);
    const shown: string[] = [...first.game.pick.candidates];
    expect(shown).toHaveLength(3);
    expect(first.game.pick.history).toEqual([]);
    await first.act({ type: "choose", step: first.game.step, index: 0 });
    await playRound(clients);

    // Round 2: someone else picks and finds the two unchosen cards plus the played one, marked.
    const second = picker(host, clients);
    expect(second.playerId).not.toBe(first.playerId);
    const history = second.game.pick.history as { contentId: string; label: string; status: string }[];
    expect(
      history
        .filter((h) => h.status === "shown")
        .map((h) => h.label)
        .sort(),
    ).toEqual(shown.slice(1).sort());
    expect(history.filter((h) => h.status === "used").map((h) => h.label)).toEqual([shown[0]]);

    // Refreshing is free: no round passes, the picker stays, earlier cards remain in the history.
    const round = second.game.round;
    await second.act({ type: "refresh", step: second.game.step });
    expect([second.game.round, second.game.pick.picker]).toEqual([round, second.playerId]);
    expect(second.game.pick.history.length).toBeGreaterThanOrEqual(history.length);

    // Nobody but the picker can confirm.
    const outsider = clients.find((c) => c !== second && c !== host) ?? first;
    const wanted = history.find((h) => h.status === "shown") as { contentId: string; label: string };
    if (outsider !== second) {
      expect(
        await outsider.act({ type: "chooseHistory", step: outsider.game.step, contentId: wanted.contentId }),
      ).toMatchObject({
        ok: false,
      });
    }

    // Restart: the history is in the database, not in memory.
    const reloaded = await loadRuntime(world, roomId);
    const again = seats.map((s) => new TestClient(reloaded, s.playerId));
    const hostAgain = again[0] as TestClient;
    await hostAgain.cmd({ type: "resumeSegment", segmentId: hostAgain.view.segment?.id ?? "" });
    const secondAgain = again.find((c) => c.playerId === second.playerId) as TestClient;
    expect(
      await secondAgain.act({ type: "chooseHistory", step: secondAgain.game.step, contentId: wanted.contentId }),
    ).toEqual({
      ok: true,
    });
    expect([secondAgain.game.phase, secondAgain.game.prompt]).toEqual(["vote", wanted.label]);
    expect(reloaded.debugState().history.find((h) => h.id === wanted.contentId)?.status).toBe("used");
  });

  it("gives the host an explicit override and nobody else", async () => {
    const { clients } = await setup(3);
    const [host] = clients as [TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "mostlikely", config: noTimers });
    // Make sure the picker is not the host.
    if (picker(host, clients) === host) {
      await host.act({ type: "choose", step: host.game.step, index: 0 });
      await playRound(clients);
    }
    const current = picker(host, clients);
    const guest = clients.find((c) => c !== host && c !== current) as TestClient;
    const step = host.game.step;
    expect(await guest.act({ type: "choose", step, index: 0, asPicker: true })).toMatchObject({ ok: false });
    expect(await host.act({ type: "choose", step, index: 0 })).toMatchObject({ ok: false });
    expect(await host.act({ type: "choose", step, index: 0, asPicker: true })).toEqual({ ok: true });
    expect(host.game.phase).toBe("vote");
  });
});

describe("AI-written candidates (AC-09)", () => {
  it("applies them only for the picker while picking and never replaces a confirmed topic", async () => {
    const { runtime, clients } = await setup(3);
    const [host] = clients as [TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "mostlikely", config: noTimers });
    if (picker(host, clients) === host) {
      await host.act({ type: "choose", step: host.game.step, index: 0 });
      await playRound(clients);
    }
    const current = picker(host, clients);
    const guest = clients.find((c) => c !== host && c !== current) as TestClient;
    const save = async (texts: string[]) => {
      const out = await runtime.saveContent(
        "who-prompt",
        "魂系",
        texts.map((text) => ({ text })),
      );
      return /id：([^。]+)/.exec(out.message)?.[1]?.split(", ") ?? [];
    };
    const before = [...current.game.pick.candidates];

    // Asked for by someone who is not the picker: kept as a suggestion in the history.
    const suggested = await save(["谁最可能在魂系游戏里迷路？"]);
    const asGuest = await runtime.offerContent(suggested, guest.playerId);
    expect(asGuest.message).toContain("历史候选");
    expect(current.game.pick.candidates).toEqual(before);
    await current.act({ type: "history", step: current.game.step });
    expect(current.game.pick.history.map((h: { label: string }) => h.label)).toContain("谁最可能在魂系游戏里迷路？");

    // Asked for by the picker: becomes the current candidates; the old ones stay in the history.
    const mine = await save(["谁最可能一周目就通关？", "谁最可能被小怪打死？"]);
    expect((await runtime.offerContent(mine, current.playerId)).ok).toBe(true);
    expect(current.game.pick.candidates).toEqual(["谁最可能一周目就通关？", "谁最可能被小怪打死？"]);
    await current.act({ type: "history", step: current.game.step });
    for (const old of before) expect(current.game.pick.history.map((h: { label: string }) => h.label)).toContain(old);

    // The picker confirms an old card; a late AI result must not replace it.
    await current.act({ type: "choose", step: current.game.step, index: 0 });
    const confirmed = current.game.prompt;
    const late = await runtime.offerContent(await save(["谁最可能迟到？"]), current.playerId);
    expect(late.message).toContain("未应用");
    expect([current.game.phase, current.game.prompt]).toEqual(["vote", confirmed]);
    expect(runtime.debugState().history.filter((h) => h.origin === "ai" && h.status === "shown")).toHaveLength(3);
  });
});

describe("chat entries and feedback (AC-04, DATA-03)", () => {
  it("calls the model for 'send and ask AI' and a typed @AI, never for plain chat", async () => {
    let calls = 0;
    const model: AgentModel = {
      run: async () => {
        calls++;
        return { text: "收到", inputTokens: 1, outputTokens: 1 };
      },
    };
    const { runtime, clients } = await setup(2, model);
    const [host, guest] = clients as [TestClient, TestClient];
    await runtime.handleChat(guest.playerId, "今天玩什么好呢");
    await sleep(50);
    expect(calls).toBe(0);
    await runtime.handleChat(guest.playerId, "来个推荐", true);
    await waitFor(() => host.chat.at(-1)?.sender.kind === "agent");
    expect(calls).toBe(1);
    expect(host.chat.filter((m) => m.text === "来个推荐")).toHaveLength(1);
    await runtime.handleChat(host.playerId, "@AI 再来一个");
    await waitFor(() => calls === 2);
  });

  it("stores feedback with what was on screen, taken from the server state", async () => {
    const { world, clients } = await setup(3);
    const [host, guest] = clients as [TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "mostlikely", config: noTimers });
    const current = picker(host, clients);
    await current.act({ type: "choose", step: current.game.step, index: 0 });
    expect(await guest.cmd({ type: "feedback", kind: "unclear", note: "看不懂这题在问什么" })).toEqual({ ok: true });
    const [row] = await world.handle.db.select().from(feedback).orderBy(desc(feedback.createdAt));
    expect(row).toMatchObject({
      kind: "unclear",
      note: "看不懂这题在问什么",
      gameId: "mostlikely",
      playerId: guest.playerId,
    });
    expect(row?.context).toMatchObject({ contentId: host.view.segment?.contentId, phase: "vote" });
    await waitFor(() => true);
    const logged = await world.handle.db.select().from(events).where(eq(events.type, "feedback"));
    expect(logged).toHaveLength(1);
  });
});

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

const config = (port: number, testMode: boolean): Config => ({
  port,
  adminPassword: "test-admin-password",
  databaseUrl: process.env.TEST_DATABASE_URL,
  webDist: "/nonexistent",
  trustProxy: false,
  testMode,
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
});

async function call(base: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // biome-ignore lint/suspicious/noExplicitAny: loosely typed JSON in tests
  return { status: res.status, body: (await res.json()) as any };
}

describe("test-only endpoints (AC-23, TEST-07)", () => {
  it("do not exist on a normal instance", async () => {
    const port = await freePort();
    app = await startApp(config(port, false));
    const base = `http://localhost:${port}`;
    expect((await call(base, "/health")).body.testMode).toBe(false);
    for (const [path, body] of [
      ["/test/rooms", { players: 4 }],
      ["/test/rooms/x/act", { playerId: "p", command: { type: "endSession" } }],
      ["/test/rooms/x/autoplay", {}],
    ] as const) {
      expect((await call(base, path, body)).status).toBe(404);
    }
    expect((await call(base, "/test/rooms/x/state")).status).toBe(404);
  });

  it("build a multi-player room, act through the normal checks and autoplay legal moves", async () => {
    const port = await freePort();
    app = await startApp(config(port, true));
    const base = `http://localhost:${port}`;
    const { body: room } = await call(base, "/test/rooms", { players: 4 });
    expect(room.seats).toHaveLength(4);
    const [host, guest] = room.seats as { playerId: string }[];
    const act = (playerId: string, command: unknown) =>
      call(base, `/test/rooms/${room.roomId}/act`, { playerId, command });

    // Permission checks still apply to test players.
    const denied = await act((guest as { playerId: string }).playerId, { type: "startGame", gameId: "mostlikely" });
    expect(denied.body).toMatchObject({ ok: false });
    expect(
      (
        await act((host as { playerId: string }).playerId, {
          type: "startGame",
          gameId: "mostlikely",
          config: noTimers,
        })
      ).body,
    ).toEqual({
      ok: true,
    });

    // Bots: the picker chooses and everyone votes; each move is computed from that player's own view.
    const moves: { action: string; ok: boolean }[] = [];
    for (let i = 0; i < 3; i++) moves.push(...(await call(base, `/test/rooms/${room.roomId}/autoplay`, {})).body.moves);
    expect(moves.map((m) => m.action).sort()).toEqual(["choose", "vote", "vote", "vote", "vote"]);
    expect(moves.every((m) => m.ok)).toBe(true);
    const state = (await call(base, `/test/rooms/${room.roomId}/state`)).body;
    expect(state.segment.state.phase).toBe("reveal");
    // A player's view never carries the raw state.
    const view = (await call(base, `/test/rooms/${room.roomId}/view/${(guest as { playerId: string }).playerId}`)).body;
    expect(view.segment.view.config).toBeUndefined();
    expect(state.segment.state.config).toBeDefined();
  });
});
