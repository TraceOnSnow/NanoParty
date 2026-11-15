import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { contentFeedback, partySessions, rooms } from "../src/db/schema.ts";
import { loadRuntime, makeWorld, seedRoom, TestClient, type World } from "./helpers.ts";

let world: World;
afterEach(async () => {
  await world?.handle.close();
});

async function setup(n: number) {
  world = await makeWorld();
  const { roomId, seats } = await seedRoom(world, n);
  const runtime = await loadRuntime(world, roomId);
  return { roomId, seats, runtime, clients: seats.map((s) => new TestClient(runtime, s.playerId)) };
}

describe("vote to skip", () => {
  it("needs a strict majority of the item's players, one vote each, and awards nothing", async () => {
    const { clients } = await setup(4);
    const [host, b, c, d] = clients as [TestClient, TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 0, answerSeconds: 0 } });
    const segmentId = host.view.segment?.id as string;
    const skip = host.view.segment?.skip;
    expect(skip).toMatchObject({ votes: 0, needed: 3, canVote: true, voted: false });
    const key = skip?.key as string;
    const question = host.game.question.text;

    await b.act({ type: "submit", round: 1, value: 1 });
    expect(await b.cmd({ type: "voteSkip", segmentId, key })).toEqual({ ok: true });
    expect(await b.cmd({ type: "voteSkip", segmentId, key })).toEqual({ ok: true }); // voting twice counts once
    expect(await c.cmd({ type: "voteSkip", segmentId, key })).toEqual({ ok: true });
    expect(host.view.segment?.skip).toMatchObject({ votes: 2, needed: 3 });
    expect(b.view.segment?.skip?.voted).toBe(true);
    expect(host.game.question.text).toBe(question);

    expect(await d.cmd({ type: "voteSkip", segmentId, key })).toEqual({ ok: true });
    expect(host.game.round).toBe(2);
    expect(host.game.question.text).not.toBe(question);
    expect(host.view.scoreboard.every((s) => s.points === 0)).toBe(true);
    // Fresh item: the old votes are gone and a vote carrying the old key is refused.
    expect(host.view.segment?.skip).toMatchObject({ votes: 0, voted: false });
    expect(await b.cmd({ type: "voteSkip", segmentId, key })).toMatchObject({ ok: false });
    expect(host.game.round).toBe(2);
  });

  it("is unavailable once the item is settled", async () => {
    const { clients } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 0, answerSeconds: 0 } });
    const segmentId = host.view.segment?.id as string;
    const key = host.view.segment?.skip?.key as string;
    await host.act({ type: "reveal", round: 1 });
    expect(host.view.segment?.skip).toBeNull();
    expect(await b.cmd({ type: "voteSkip", segmentId, key })).toMatchObject({ ok: false });
  });
});

describe("feedback, sessions, invites, members", () => {
  it("records content feedback against the item on screen only", async () => {
    const { clients } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 0, answerSeconds: 0 } });
    const segmentId = host.view.segment?.id as string;
    const contentId = host.view.segment?.contentId as string;
    expect(await b.cmd({ type: "contentFeedback", segmentId, contentId, kind: "unclear" })).toEqual({ ok: true });
    expect(await b.cmd({ type: "contentFeedback", segmentId, contentId: "other", kind: "unclear" })).toMatchObject({
      ok: false,
    });
    const rows = await world.handle.db.select().from(contentFeedback);
    expect(rows).toMatchObject([{ contentId, playerId: b.playerId, kind: "unclear", contentVersion: 1 }]);
  });

  it("ends a party session: scores reset, history kept, content may repeat in the new session", async () => {
    const { clients, roomId } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 1, answerSeconds: 0 } });
    await b.act({ type: "submit", round: 1, value: 1 });
    expect(await host.cmd({ type: "endSession" })).toMatchObject({ ok: false }); // game still running
    await host.act({ type: "reveal", round: 1 });
    await host.act({ type: "next", round: 1 });
    expect(host.view.scoreboard.find((s) => s.playerId === b.playerId)?.points).toBe(2);
    const firstSession = host.view.sessionId;

    expect(await b.cmd({ type: "endSession" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "endSession" })).toEqual({ ok: true });
    expect(host.view.sessionId).not.toBe(firstSession);
    expect(host.view.scoreboard.every((s) => s.points === 0)).toBe(true);
    expect(host.chat.at(-1)?.text).toContain("玩家2 2");
    const sessions = await world.handle.db.select().from(partySessions).where(eq(partySessions.roomId, roomId));
    expect(sessions.map((s) => s.status).sort()).toEqual(["active", "ended"]);
    // A reload sees the new, empty session rather than the old totals.
    const reloaded = new TestClient(await loadRuntime(world, roomId), b.playerId);
    expect(reloaded.view.scoreboard.every((s) => s.points === 0)).toBe(true);
  });

  it("rotates the invite and removes members (host only, lobby only)", async () => {
    const { clients, roomId, seats, runtime } = await setup(3);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    const oldInvite = host.view.inviteToken;
    expect(await b.cmd({ type: "rotateInvite" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "rotateInvite" })).toEqual({ ok: true });
    expect(host.view.inviteToken).not.toBe(oldInvite);
    const [room] = await world.handle.db.select().from(rooms).where(eq(rooms.id, roomId));
    expect(room?.inviteToken).toBe(host.view.inviteToken);

    expect(await b.cmd({ type: "removeMember", playerId: c.playerId })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "removeMember", playerId: host.playerId })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "removeMember", playerId: c.playerId })).toEqual({ ok: true });
    expect(host.view.members.map((m) => m.id)).toEqual([host.playerId, b.playerId]);
    // The removed player's session token no longer works, also after a reload.
    const token = (seats[2] as { token: string }).token;
    expect(await runtime.authenticate(token)).toBeNull();
    expect(await (await loadRuntime(world, roomId)).authenticate(token)).toBeNull();
    expect(await c.cmd({ type: "startGame", gameId: "estimate" })).toMatchObject({ ok: false });
  });
});
