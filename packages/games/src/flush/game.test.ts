import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { type FlushState, flushGame as game, strength } from "./game.ts";

const table = () => new Table(game, makeCtx(["a", "b", "c"], [], Math.random), {});
function rigged(): Table<FlushState> {
  const t = table();
  Object.assign(t.state, {
    current: "a",
    hands: { a: [5, 12], b: [6, 6], c: [10, 3] },
    table: { a: null, b: null, c: null },
    drawPile: [2, 4, 8],
  });
  return t;
}

describe("flush", () => {
  it("deals six private cards each", () => {
    const t = table();
    for (const p of ["a", "b", "c"]) expect(t.state.hands[p]).toHaveLength(6);
    expect(t.view("a").myHand).toEqual(t.state.hands.a);
    expect(JSON.stringify(t.view("a"))).not.toContain(JSON.stringify(t.state.hands.b));
    expect(strength({ a: 6, b: 6, c: 10 }, 6)).toBe(12);
  });

  it("higher cards knock out weaker ones, whose owners draw; equal cards team up", () => {
    const t = rigged();
    expect(t.rejects(as("b"), { type: "play", card: 6 })).toBe(true);
    t.do(as("a"), { type: "play", card: 5 });
    t.do(as("b"), { type: "play", card: 6 }); // 6 > 5: a's card is knocked out, a draws
    expect(t.state.last).toEqual({ playerId: "b", card: 6, knocked: ["a"] });
    expect(t.state.hands.a).toEqual([2, 12]);
    t.do(as("c"), { type: "play", card: 10 }); // 10 > 6: b knocked, draws
    expect(t.state.table).toEqual({ a: null, b: null, c: 10 });
    t.do(as("a"), { type: "play", card: 12 }); // 12 > 10
    expect(t.state.table.c).toBeNull();
    // b now holds 6 and 8 (drew 4? no: b drew the next card, 4)
    expect(t.state.hands.b).toEqual([4, 6]);
  });

  it("a card that survives a round is discarded; an empty hand then wins", () => {
    const t = rigged();
    t.state.hands = { a: [12], b: [3, 4], c: [2, 5] };
    t.do(as("a"), { type: "play", card: 12 });
    t.do(as("b"), { type: "play", card: 3 });
    t.do(as("c"), { type: "play", card: 2 });
    // a's 12 survived the round: discarded at the start of a's turn; a has no cards left.
    expect([t.state.phase, t.state.winner]).toEqual(["gameOver", "a"]);
    expect(t.points("a")).toBe(3);
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
