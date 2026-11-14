import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { rowCardsGame as game, penaltyOf } from "./game.ts";

/** A table with a hand-built position so placement rules can be checked exactly. */
function rigged() {
  const t = new Table(game, makeCtx(["a", "b", "c"], []), { hands: 1, chooseSeconds: 30 });
  t.state.rows = [[10], [20, 21, 22, 23, 24], [50], [80]];
  t.state.hands = { a: [5, 60], b: [25, 61], c: [51, 62] };
  return t;
}

describe("rowcards", () => {
  it("values cards as specified", () => {
    expect([1, 5, 10, 11, 55, 100, 99].map(penaltyOf)).toEqual([1, 2, 3, 5, 5, 3, 5]);
  });

  it("deals ten distinct cards each and four rows; hands and picks stay private", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], [], Math.random));
    const all = [...Object.values(t.state.hands).flat(), ...t.state.rows.flat()];
    expect(all).toHaveLength(34);
    expect(new Set(all).size).toBe(34);
    expect(t.view("a").myHand).toEqual(t.state.hands.a);
    expect(t.view("z").myHand).toEqual([]);
    const card = t.state.hands.a?.[3] as number;
    t.do(as("a"), { type: "play", card });
    expect(t.view("b").submitted).toEqual(["a"]);
    expect(t.view("b").myCard).toBeNull();
    expect(JSON.stringify(t.view("b"))).not.toContain(JSON.stringify(t.state.hands.a));
    expect(t.rejects(as("a"), { type: "play", card: t.state.hands.a?.[0] })).toBe(true);
    expect(t.rejects(as("b"), { type: "play", card: card })).toBe(true); // not in b's hand
  });

  it("places cards low to high: sixth card takes the row, too-low card takes the cheapest row", () => {
    const t = rigged();
    t.do(as("c"), { type: "play", card: 51 });
    t.do(as("b"), { type: "play", card: 25 });
    t.do(as("a"), { type: "play", card: 5 });
    // 5 is below every row: a takes the cheapest row; [10], [50] and [80] all cost 3, so the first one.
    expect(t.state.lastTrick).toEqual([
      { playerId: "a", card: 5, row: 0, took: [10] },
      { playerId: "b", card: 25, row: 1, took: [20, 21, 22, 23, 24] },
      { playerId: "c", card: 51, row: 2, took: null },
    ]);
    expect(t.state.rows).toEqual([[5], [25], [50, 51], [80]]);
    expect(t.state.penalties).toEqual({ a: 3, b: 3 + 1 + 5 + 1 + 1, c: 0 });
    expect([t.state.trick, t.state.hands.a]).toEqual([2, [60]]);
  });

  it("ends the hand when cards run out: fewest penalty points wins; stale plays are rejected", () => {
    const t = rigged();
    const stale = t.state.step;
    for (const [p, card] of [
      ["a", 5],
      ["b", 25],
      ["c", 51],
    ] as const)
      t.do(as(p), { type: "play", card });
    expect(t.rejects(as("a"), { type: "play", step: stale, card: 60 })).toBe(true);
    t.do(as("a"), { type: "play", card: 60 });
    t.timeout(); // b and c are away: their lowest cards are played for them
    expect(t.state.phase).toBe("handOver");
    expect(t.state.winners).toEqual(["c"]);
    expect(t.scores).toEqual([{ playerId: "c", points: 3, reason: "罚分最少", key: "h1:win:c" }]);
    expect(t.rejects(as("b"), { type: "advance" })).toBe(true);
    t.do(host, { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
