import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPrivatePacks } from "../src/content/privatePack.ts";
import { loadRuntime, makeWorld, seedRoom, TestClient, type World } from "./helpers.ts";

let world: World | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

const theme = (name: string, weight?: number) => ({
  name,
  ...(weight === undefined ? {} : { weight }),
  kinds: ["一", "二", "三", "四", "五", "六"].map((label) => ({ label })),
});

describe("private content packs", () => {
  it("loads valid items from a directory and rejects the rest without failing", () => {
    const dir = mkdtempSync(join(tmpdir(), "np-pack-"));
    writeFileSync(
      join(dir, "a.json"),
      JSON.stringify([
        { id: "p1", type: "platter-theme", payload: theme("自己人", 10) },
        { id: "p2", type: "platter-theme", payload: { name: "少了材料" } },
        { id: "p3", type: "no-such-type", payload: {} },
      ]),
    );
    writeFileSync(join(dir, "b.json"), "not json");
    const items = loadPrivatePacks(dir);
    expect(items).toMatchObject([{ id: "p1", version: 1, source: "私有内容包", verification: "unverified" }]);
    expect(loadPrivatePacks(join(dir, "missing"))).toEqual([]);
    expect(loadPrivatePacks(undefined)).toEqual([]);
  });
});

describe("platter over the real command path", () => {
  it("uses the private theme every game of a party and plays to the end", async () => {
    const w = await makeWorld();
    world = w;
    await w.deps.content.seed([
      {
        id: "p1",
        version: 1,
        type: "platter-theme",
        theme: "私有",
        source: "私有内容包",
        verification: "unverified",
        payload: theme("自己人", 10),
      },
    ]);
    const { roomId, seats } = await seedRoom(w, 3);
    const runtime = await loadRuntime(w, roomId);
    const clients = seats.map((s) => new TestClient(runtime, s.playerId));
    const [host] = clients as [TestClient];

    for (let game = 0; game < 2; game++) {
      expect(await host.cmd({ type: "startGame", gameId: "platter", config: {} })).toEqual({ ok: true });
      expect(host.game.theme.name).toBe("自己人");
      for (let i = 0; i < 100 && host.view.segment; i++) {
        const turn = clients.find((c) => c.playerId === host.game.current) as TestClient;
        const slots = (host.game.market as (object | null)[][])
          .flatMap((column, col) => column.map((item, row) => (item ? { col, row } : null)))
          .filter((s) => s !== null)
          .slice(0, host.game.mustTake);
        // Someone not on turn is refused; the player on turn alternates rules and ingredients.
        const other = clients.find((c) => c !== turn) as TestClient;
        expect(await other.act({ type: "takeRule", step: host.game.step, pile: 0 })).toMatchObject({ ok: false });
        const pile = (host.game.piles as { top: object | null }[]).findIndex((p) => p.top);
        const ack =
          i % 3 === 0 && pile >= 0
            ? await turn.act({ type: "takeRule", step: host.game.step, pile })
            : slots.length > 0
              ? await turn.act({ type: "takeItems", step: host.game.step, slots })
              : await turn.act({ type: "takeRule", step: host.game.step, pile });
        expect(ack).toEqual({ ok: true });
      }
      expect(host.view.segment).toBeNull();
      // The finished game is recorded; totals that are not positive earn nothing (covered by the rule tests).
      expect(host.view.lastSegment).toMatchObject({ gameId: "platter", endedReason: "finished" });
    }
  });
});

describe("per-server game notes", () => {
  it("reads aliases and remarks from the private directory and shows them in the lobby only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "np-notes-"));
    writeFileSync(
      join(dir, "game-notes.json"),
      JSON.stringify({ platter: { alias: "我们的叫法", note: "类似：某某" } }),
    );
    writeFileSync(join(dir, "pack.json"), "[]");
    const { loadGameNotes } = await import("../src/content/privatePack.ts");
    const notes = loadGameNotes(dir);
    expect(notes).toEqual({ platter: { alias: "我们的叫法", note: "类似：某某" } });
    // The notes file is not mistaken for a content pack, and a broken one changes nothing.
    expect(loadPrivatePacks(dir)).toEqual([]);
    writeFileSync(join(dir, "game-notes.json"), JSON.stringify({ platter: { alias: 5 } }));
    expect(loadGameNotes(dir)).toEqual({});
    expect(loadGameNotes(undefined)).toEqual({});

    const w = await makeWorld();
    world = w;
    w.deps.gameNotes = notes;
    const { roomId, seats } = await seedRoom(w, 2);
    const runtime = await loadRuntime(w, roomId);
    const host = new TestClient(runtime, seats[0]?.playerId as string);
    const shown = host.view.games.find((g) => g.id === "platter");
    expect(shown).toMatchObject({ name: "凑一桌", alias: "我们的叫法", note: "类似：某某" });
    expect(host.view.games.find((g) => g.id === "seven")?.alias).toBeUndefined();
    // Records and system messages keep the game's own name.
    await host.cmd({ type: "startGame", gameId: "platter", config: {} });
    expect(runtime.agentContext().state).toContain("凑一桌");
    expect(runtime.agentContext().state).not.toContain("我们的叫法");
  });
});

describe("player pictures", () => {
  it("gives everyone a default picture and lets a player change only their own, from the fixed list", async () => {
    const w = await makeWorld();
    world = w;
    const { roomId, seats } = await seedRoom(w, 2);
    const runtime = await loadRuntime(w, roomId);
    const [a, b] = seats.map((s) => new TestClient(runtime, s.playerId)) as [TestClient, TestClient];
    const before = a.view.members.map((m) => m.avatar);
    expect(before.every((x) => typeof x === "string" && x.length > 0)).toBe(true);

    expect(await b.cmd({ type: "setAvatar", avatar: "🗿" })).toEqual({ ok: true });
    expect(a.view.members.find((m) => m.id === b.playerId)?.avatar).toBe("🗿");
    expect(a.view.members.find((m) => m.id === a.playerId)?.avatar).toBe(before[0]);
    // Anything outside the list never reaches the room.
    expect(await b.cmd({ type: "setAvatar", avatar: "<img>" } as never)).toMatchObject({ ok: false });

    // The choice survives a restart of the room.
    const again = await loadRuntime(w, roomId);
    expect(new TestClient(again, a.playerId).view.members.find((m) => m.id === b.playerId)?.avatar).toBe("🗿");
  });
});
