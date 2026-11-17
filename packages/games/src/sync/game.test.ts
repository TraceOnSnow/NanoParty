import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { syncGame as game, type SyncState, syncLevels, syncLives } from "./game.ts";

function table(hands: Record<string, number[]>, patch: Partial<SyncState> = {}) {
  const t = new Table(game, makeCtx(Object.keys(hands), [], Math.random));
  Object.assign(t.state as SyncState, { hands: structuredClone(hands), ...patch });
  return t;
}
const play = (t: ReturnType<typeof table>, p: string, card: number) =>
  t.do(as(p), { type: "play", card, round: t.state.round });

describe("sync", () => {
  it("sets levels and lives by table size and deals one card each at level one", () => {
    expect([2, 3, 4, 5, 8].map(syncLevels)).toEqual([12, 10, 8, 6, 6]);
    expect([2, 4, 8].map(syncLives)).toEqual([2, 4, 5]);
    const t = new Table(game, makeCtx(["a", "b", "c"], [], Math.random));
    expect(Object.values(t.state.hands).map((h) => h.length)).toEqual([1, 1, 1]);
    expect([t.state.lives, t.state.stars, t.state.totalLevels]).toEqual([3, 1, 10]);
  });

  it("shows a player only their own cards", () => {
    const t = table({ a: [11, 57], b: [23, 88], c: [42, 99] });
    expect(t.view("a").myHand).toEqual([11, 57]);
    expect(t.view("a").hands).toBeNull();
    expect(t.view("a").counts).toEqual({ a: 2, b: 2, c: 2 });
    const wire = t.wire("a");
    for (const card of ["23", "88", "42", "99"]) expect(wire).not.toContain(card);
  });

  it("accepts only a player's lowest card, with no turn order", () => {
    const t = table({ a: [11, 57], b: [23, 88] });
    expect(t.rejects(as("a"), { type: "play", card: 57, round: t.state.round })).toBe(true);
    expect(t.rejects(as("a"), { type: "play", card: 11, round: t.state.round + 1 })).toBe(true);
    play(t, "a", 11);
    play(t, "b", 23);
    play(t, "a", 57);
    expect([t.state.pile.map((c) => c.card), t.state.lives, t.state.phase]).toEqual([[11, 23, 57], 2, "play"]);
  });

  it("a card played over lower ones costs a life and throws those cards away", () => {
    const t = table({ a: [11, 57], b: [23, 40, 88], c: [30] });
    play(t, "b", 23);
    expect(t.state.lives).toBe(2);
    expect(t.state.shown).toEqual({ kind: "mistake", card: 23, by: "b", cards: [{ by: "a", card: 11 }] });
    expect(t.state.hands).toEqual({ a: [57], b: [40, 88], c: [30] });
  });

  it("finishes a level when all hands are empty and hands out the reward", () => {
    const t = table({ a: [11], b: [23] }, { level: 2 });
    play(t, "a", 11);
    play(t, "b", 23);
    expect([t.state.phase, t.state.reward, t.state.stars]).toEqual(["levelOver", "star", 2]);
    expect(t.rejects(as("b"), { type: "next" })).toBe(true);
    t.do(host, { type: "next" });
    expect([t.state.level, t.state.phase, Object.values(t.state.hands).map((h) => h.length)]).toEqual([
      3,
      "play",
      [3, 3],
    ]);
  });

  it("uses a star only when everyone holding cards agrees", () => {
    const t = table({ a: [11, 57], b: [23, 88], c: [] });
    t.do(as("a"), { type: "star", on: true, round: t.state.round });
    expect([t.state.stars, t.view("b").starVotes]).toEqual([1, ["a"]]);
    t.do(as("b"), { type: "star", on: true, round: t.state.round });
    expect([t.state.stars, t.state.hands, t.state.shown?.cards]).toEqual([
      0,
      { a: [57], b: [88], c: [] },
      [
        { by: "a", card: 11 },
        { by: "b", card: 23 },
      ],
    ]);
    expect(t.rejects(as("a"), { type: "star", on: true, round: t.state.round })).toBe(true);
  });

  it("is lost at zero lives and won after the last level; the team scores together", () => {
    const lost = table({ a: [11], b: [23] }, { lives: 1, level: 7, totalLevels: 12 });
    play(lost, "b", 23);
    expect([lost.state.phase, lost.view("a").hands]).toEqual(["lost", { a: [], b: [] }]);
    lost.do(host, { type: "next" });
    expect([lost.finished, lost.points("a"), lost.points("b")]).toEqual([true, 1, 1]);

    const won = table({ a: [11], b: [23] }, { level: 12, totalLevels: 12 });
    play(won, "a", 11);
    play(won, "b", 23);
    expect(won.state.phase).toBe("won");
    won.do(host, { type: "next" });
    expect(won.points("a")).toBe(3);
  });
});
