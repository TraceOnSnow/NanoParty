import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { scoreEvents } from "../src/db/schema.ts";
import { loadRuntime, makeWorld, seedRoom, segmentState, sleep, TestClient, type World, waitFor } from "./helpers.ts";

let world: World;
afterEach(async () => {
  await world?.handle.close();
});

async function setup(n = 3) {
  world = await makeWorld();
  const { roomId, seats } = await seedRoom(world, n);
  const runtime = await loadRuntime(world, roomId);
  const clients = seats.map((s) => new TestClient(runtime, s.playerId));
  return { roomId, seats, runtime, clients };
}

const total = (c: TestClient, playerId: string) => c.view.scoreboard.find((s) => s.playerId === playerId)?.points;

describe("RoomRuntime: game flow", () => {
  it("plays rounds, keeps secrets off the wire, settles once and returns to the lobby", async () => {
    const { clients } = await setup(3);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    expect(host.view.me.isHost).toBe(true);
    expect(host.view.inviteToken).toBeTruthy();
    expect(b.view.inviteToken).toBeUndefined();

    expect(await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 2, answerSeconds: 0 } })).toEqual({
      ok: true,
    });
    const segId = host.view.segment?.id as string;
    const answer: number = (await segmentState(world, segId)).question.answer;

    // Guesses are chosen so that they are recognisable on the wire.
    expect(await host.act({ type: "submit", round: 1, value: answer })).toEqual({ ok: true });
    expect(await b.act({ type: "submit", round: 1, value: 123456.5 })).toEqual({ ok: true });
    expect(b.game.submitted).toHaveLength(2);
    expect(c.game.myGuess).toBeNull();
    expect(c.game.reveal).toBeNull();
    // Nothing sent to c so far may contain b's guess.
    expect(c.raw.join("\n")).not.toContain("123456.5");
    expect(JSON.stringify(c.view)).not.toContain('"answer"');

    expect(await c.act({ type: "submit", round: 1, value: -98765.5 })).toEqual({ ok: true });
    expect(c.game.phase).toBe("reveal");
    expect(c.game.reveal.answer).toBe(answer);
    expect(total(c, host.playerId)).toBe(3);
    expect(total(c, b.playerId)).toBe(0);

    expect(await b.act({ type: "next", round: 1 })).toMatchObject({ ok: false });
    expect(await host.act({ type: "next", round: 1 })).toEqual({ ok: true });
    expect(host.game.round).toBe(2);
    expect(await host.act({ type: "reveal", round: 2 })).toEqual({ ok: true });
    expect(await host.act({ type: "next", round: 2 })).toEqual({ ok: true });

    // Finished: back in the lobby, scores kept, summary available.
    expect(host.view.segment).toBeNull();
    expect(host.view.lastSegment).toMatchObject({ gameId: "estimate", endedReason: "finished" });
    expect(total(b, host.playerId)).toBe(3);
    // And a new game can be started in the same room / session.
    expect(await host.cmd({ type: "startGame", gameId: "estimate" })).toEqual({ ok: true });
  });

  it("enforces host-only operations and player limits", async () => {
    const { clients, runtime } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    expect(await b.cmd({ type: "startGame", gameId: "estimate" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "startGame", gameId: "nope" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "startGame", gameId: "estimate" })).toEqual({ ok: true });
    expect(await host.cmd({ type: "startGame", gameId: "estimate" })).toMatchObject({ ok: false });
    const segmentId = host.view.segment?.id as string;
    expect(await b.cmd({ type: "endSegment", segmentId })).toMatchObject({ ok: false });
    expect(
      await runtime.handleCommand("p_stranger", { cmdId: "x1234567", command: { type: "endSegment", segmentId } }),
    ).toMatchObject({
      ok: false,
    });
    expect(await host.cmd({ type: "endSegment", segmentId })).toEqual({ ok: true });
    expect(host.view.lastSegment?.endedReason).toBe("aborted");

    world.handle.close();
    world = await makeWorld();
    const solo = await seedRoom(world, 1);
    const lone = new TestClient(
      await loadRuntime(world, solo.roomId),
      (solo.seats[0] as { playerId: string }).playerId,
    );
    expect(await lone.cmd({ type: "startGame", gameId: "estimate" })).toMatchObject({ ok: false });
  });

  it("is idempotent: a retried command id runs once; actions for an old segment are rejected", async () => {
    const { clients } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 0, answerSeconds: 0 } });
    const firstSegment = host.view.segment?.id as string;
    await host.act({ type: "reveal", round: 1 });

    const next = { type: "gameAction", segmentId: firstSegment, action: { type: "next", round: 1 } } as const;
    const [r1, r2] = await Promise.all([host.cmd(next, "retry-0001"), host.cmd(next, "retry-0001")]);
    expect([r1, r2]).toEqual([{ ok: true }, { ok: true }]);
    expect(host.game.round).toBe(2);
    // Same action under a NEW id is a stale-round action and is refused by the game.
    expect(await host.cmd(next, "retry-0002")).toMatchObject({ ok: false });
    expect(host.game.round).toBe(2);

    await host.cmd({ type: "endSegment", segmentId: firstSegment });
    await host.cmd({ type: "startGame", gameId: "estimate" });
    expect(
      await b.cmd({ type: "gameAction", segmentId: firstSegment, action: { type: "submit", round: 1, value: 1 } }),
    ).toMatchObject({ ok: false });
    expect(b.game.submitted).toEqual([]);
  });

  it("advances on the server when the answer timer runs out", async () => {
    const { clients } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 1, answerSeconds: 1 } });
    await b.act({ type: "submit", round: 1, value: 1 });
    expect(b.game.phase).toBe("answering");
    await waitFor(() => b.game.phase === "reveal", 3000);
    expect(total(host, b.playerId)).toBeGreaterThan(0);
  });

  it("does not repeat content within a party session", async () => {
    const { clients } = await setup(2);
    const [host] = clients as [TestClient];
    const seen: string[] = [];
    for (let i = 0; i < 2; i++) {
      await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 0, answerSeconds: 0 } });
      for (let r = 1; r <= 4; r++) {
        seen.push(host.game.question.text);
        await host.act({ type: "reveal", round: r });
        await host.act({ type: "next", round: r });
      }
      await host.cmd({ type: "endSegment", segmentId: host.view.segment?.id as string });
    }
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("RoomRuntime: identity, isolation, recovery", () => {
  it("authenticates by session token only, and never across rooms", async () => {
    world = await makeWorld();
    const r1 = await seedRoom(world, 2);
    const r2 = await seedRoom(world, 2);
    const rt1 = await loadRuntime(world, r1.roomId);
    const rt2 = await loadRuntime(world, r2.roomId);
    const seat = r1.seats[1] as { playerId: string; token: string };
    expect(await rt1.authenticate(seat.token)).toBe(seat.playerId);
    expect(await rt2.authenticate(seat.token)).toBeNull();
    expect(await rt1.authenticate("玩家1")).toBeNull();
    expect(await rt1.authenticate(undefined)).toBeNull();

    // Chat and state of one room never reach the other.
    const a = new TestClient(rt1, seat.playerId);
    const other = new TestClient(rt2, (r2.seats[0] as { playerId: string }).playerId);
    await rt1.handleChat(seat.playerId, "只在一号房");
    expect(a.chat.map((m) => m.text)).toContain("只在一号房");
    expect(other.raw.join("\n")).not.toContain("只在一号房");
  });

  it("keeps identity and submissions across disconnects, and shows connection status", async () => {
    const { clients, runtime } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 1, answerSeconds: 0 } });
    await b.act({ type: "submit", round: 1, value: 4242 });
    b.disconnect();
    expect(host.view.members.find((m) => m.id === b.playerId)?.connected).toBe(false);

    const b2 = new TestClient(runtime, b.playerId);
    expect(b2.view.members).toHaveLength(2);
    expect(b2.game.myGuess).toBe(4242);
    expect(host.view.members.find((m) => m.id === b.playerId)?.connected).toBe(true);
    expect(await b2.act({ type: "submit", round: 1, value: 1 })).toMatchObject({ ok: false });
  });

  it("recovers after a restart: paused until the host resumes, same secrets, no double scoring", async () => {
    const { roomId, seats, clients } = await setup(3);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 3, answerSeconds: 30 } });
    const segId = host.view.segment?.id as string;
    const answer1 = (await segmentState(world, segId)).question.answer;
    await host.act({ type: "submit", round: 1, value: answer1 });
    await host.act({ type: "reveal", round: 1 });
    await host.act({ type: "next", round: 1 });
    await b.act({ type: "submit", round: 2, value: 777 });
    const before = await segmentState(world, segId);

    // "Restart": a brand-new runtime built only from the database.
    const rt2 = await loadRuntime(world, roomId);
    const [h2, b2] = seats.map((s) => new TestClient(rt2, s.playerId)) as [TestClient, TestClient];
    expect(h2.view.segment).toMatchObject({ id: segId, status: "paused" });
    expect(b2.game.myGuess).toBe(777);
    expect(b2.game.question.text).toBe(before.question.text);
    expect((await segmentState(world, segId)).question).toEqual(before.question);
    expect(h2.view.scoreboard.find((s) => s.playerId === host.playerId)?.points).toBe(3);

    // While paused nothing moves; only the host can resume.
    expect(await b2.act({ type: "submit", round: 2, value: 1 })).toMatchObject({ ok: false });
    expect(await b2.cmd({ type: "resumeSegment", segmentId: segId })).toMatchObject({ ok: false });
    expect(await h2.cmd({ type: "resumeSegment", segmentId: segId })).toEqual({ ok: true });
    expect(h2.view.segment?.status).toBe("active");
    // Downtime is not charged: the answer timer restarts.
    expect(h2.game.deadlineAt).toBeGreaterThan(Date.now() + 25_000);

    await h2.act({ type: "reveal", round: 2 });
    const rows = await world.handle.db.select().from(scoreEvents).where(eq(scoreEvents.segmentId, segId));
    expect(new Set(rows.map((r) => r.awardKey)).size).toBe(rows.length);
    expect(rows.filter((r) => r.awardKey.startsWith("r1:"))).toHaveLength(1);
  });

  it("stores plain chat without any model call and rate-limits spam", async () => {
    const { clients, runtime } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    expect(await runtime.handleChat(b.playerId, "大家好")).toEqual({ ok: true });
    expect(host.chat.at(-1)).toMatchObject({ text: "大家好", sender: { kind: "player", nickname: "玩家2" } });
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await runtime.handleChat(b.playerId, `spam ${i}`));
    expect(results.some((r) => !r.ok)).toBe(true);
    await sleep(10);
    expect(host.chat.every((m) => m.sender.kind === "player")).toBe(true);
  });
});
