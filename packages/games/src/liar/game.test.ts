import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { liarGame as game, type LiarState, liarCount, liarRaises } from "./game.ts";

function table(dice: Record<string, number[]>, config: Record<string, number> = {}) {
  const t = new Table(game, makeCtx(Object.keys(dice), [], Math.random), config);
  (t.state as LiarState).dice = structuredClone(dice);
  return t;
}
const three = () => table({ a: [1, 2, 3, 4, 5], b: [2, 2, 6, 6, 6], c: [1, 1, 3, 3, 5] });

describe("liar", () => {
  it("orders bids by quantity, then by face with 1 on top, and needs one die per player to open", () => {
    expect(liarRaises(null, 2, 6, 3)).toBe(false);
    expect(liarRaises(null, 3, 2, 3)).toBe(true);
    const prev = { by: "a", quantity: 4, face: 5 };
    expect([
      liarRaises(prev, 4, 4, 3),
      liarRaises(prev, 4, 6, 3),
      liarRaises(prev, 4, 1, 3),
      liarRaises(prev, 5, 2, 3),
    ]).toEqual([false, true, true, true]);
    expect(liarRaises({ by: "a", quantity: 4, face: 1 }, 4, 6, 3)).toBe(false);
  });

  it("counts 1s as anything unless they have been bid on", () => {
    const dice = { a: [1, 2, 3, 4, 5], b: [2, 2, 6, 6, 6], c: [1, 1, 3, 3, 5] };
    expect([liarCount(dice, 2, true), liarCount(dice, 2, false), liarCount(dice, 1, true)]).toEqual([6, 3, 3]);
  });

  it("shows a player only their own dice until the cups are lifted", () => {
    const t = three();
    expect(t.view("a").myDice).toEqual([1, 2, 3, 4, 5]);
    expect(t.view("a").dice).toBeNull();
    expect(t.wire("a")).not.toContain("[2,2,6,6,6]");
    expect(t.wire("a")).not.toContain("[1,1,3,3,5]");
  });

  it("passes the bid round the table and rejects a bid that does not raise", () => {
    const t = three();
    expect(t.rejects(as("a"), { type: "open" })).toBe(true);
    expect(t.rejects(as("b"), { type: "bid", quantity: 3, face: 2 })).toBe(true);
    t.do(as("a"), { type: "bid", quantity: 3, face: 6 });
    expect(t.state.current).toBe("b");
    expect(t.rejects(as("b"), { type: "bid", quantity: 3, face: 4 })).toBe(true);
    expect(t.rejects(as("b"), { type: "bid", quantity: 16, face: 4 })).toBe(true);
    t.do(as("b"), { type: "bid", quantity: 5, face: 6 });
    expect([t.state.bid, t.state.onesWild]).toEqual([{ by: "b", quantity: 5, face: 6 }, true]);
  });

  it("opening a true bid costs the opener the round; a false one costs the bidder", () => {
    const honest = three();
    honest.do(as("a"), { type: "bid", quantity: 6, face: 6 });
    honest.do(as("b"), { type: "open" });
    // Three 6s plus three wild 1s.
    expect(honest.state.result).toMatchObject({ count: 6, loser: "b" });
    expect(honest.view("a").dice?.c).toEqual([1, 1, 3, 3, 5]);

    const lie = three();
    lie.do(as("a"), { type: "bid", quantity: 3, face: 1 });
    lie.do(as("b"), { type: "bid", quantity: 4, face: 6 });
    lie.do(as("c"), { type: "open" });
    // 1s stopped being wild when a bid on them: only three 6s.
    expect(lie.state.result).toMatchObject({ count: 3, loser: "b" });
    lie.do(host, { type: "next" });
    expect([lie.state.round, lie.state.current, lie.state.bid, lie.state.onesWild]).toEqual([2, "b", null, true]);
  });

  it("the fewest losses win after the last round", () => {
    const t = table({ a: [2, 2, 2, 2, 2], b: [3, 3, 3, 3, 3] }, { rounds: 1 });
    t.do(as("a"), { type: "bid", quantity: 9, face: 2 });
    t.do(as("b"), { type: "open" });
    expect(t.state.result?.loser).toBe("a");
    t.do(host, { type: "next" });
    expect([t.finished, t.state.winners]).toEqual([true, ["b"]]);
    expect(t.points("b")).toBe(3);
  });
});
