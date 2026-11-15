/** VNext: anonymous votes on the canvas, and interactions that survive a restart (AC-16). */
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntime, makeWorld, seedRoom, TestClient, type World } from "./helpers.ts";

let world: World | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

describe("canvas interactions", () => {
  it("keeps an anonymous vote anonymous everywhere, and restores an open interaction after a restart", async () => {
    world = await makeWorld();
    const { roomId, seats } = await seedRoom(world, 3, "rank-v1");
    const runtime = await loadRuntime(world, roomId);
    const [host, b, c] = seats.map((s) => new TestClient(runtime, s.playerId)) as [TestClient, TestClient, TestClient];
    const made = await runtime.createInteraction({
      kind: "choose",
      title: "匿名投票选主题",
      audience: "all",
      anonymous: true,
      options: [
        { id: "a", label: "魂系" },
        { id: "b", label: "动漫" },
      ],
    });
    expect(made.ok).toBe(true);
    const id = host.view.canvas.current?.id ?? "";
    expect(await b.cmd({ type: "respond", interactionId: id, value: "a" })).toEqual({ ok: true });

    // Restart with one vote in: the interaction and the vote are still there.
    const reloaded = await loadRuntime(world, roomId);
    const [host2, b2, c2] = seats.map((s) => new TestClient(reloaded, s.playerId)) as [
      TestClient,
      TestClient,
      TestClient,
    ];
    expect(host2.view.canvas.current).toMatchObject({ id, status: "open", responded: [b.playerId] });
    expect(await b2.cmd({ type: "respond", interactionId: id, value: "b" })).toMatchObject({ ok: false }); // already voted
    await host2.cmd({ type: "respond", interactionId: id, value: "a" });
    await c2.cmd({ type: "respond", interactionId: id, value: "b" });

    const result = c2.view.canvas.current?.result;
    expect(result).toMatchObject({ kind: "choose", anonymous: true, winners: ["a"] });
    expect(result?.kind === "choose" && result.tally.map((t) => [t.count, t.voters])).toEqual([
      [2, []],
      [1, []],
    ]);
    // Neither the chat summary nor what the AI host is told names a voter.
    const summary = host2.chat.at(-1)?.text ?? "";
    expect(summary).toContain("魂系 2 票");
    for (const text of [summary, JSON.stringify(reloaded.agentContext().canvas)]) {
      expect(text).not.toContain("玩家1");
      expect(text).not.toContain("玩家2");
    }
    // The host can dismiss it; a cancelled interaction is gone for everyone.
    expect(await c2.cmd({ type: "closeInteraction", interactionId: id })).toMatchObject({ ok: false });
    expect(await host2.cmd({ type: "closeInteraction", interactionId: id })).toEqual({ ok: true });
    expect(b2.view.canvas.current).toBeNull();
    void [host, c];
  });
});
