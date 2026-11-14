import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { CLOVER_PERFECT, cloverGame } from "./game.ts";

const players = ["a", "b", "c"];
const clues = { type: "clues", clues: ["一", "二", "三", "四"] };
function table() {
  let n = 0;
  const t = new Table(
    cloverGame,
    makeCtx(players, [], () => ((n++ * 7) % 10) / 10),
  );
  return t;
}
/** Places every card where it belongs, except that `wrong` slots get swapped orientation. */
function solve(t: ReturnType<typeof table>, by: string, wrong: number[] = []) {
  const s = t.state.solve;
  if (!s) throw new Error("not solving");
  s.truth.forEach((truth, card) => {
    if (truth.slot < 0 || s.locked[truth.slot]) return;
    t.do(as(by), { type: "place", slot: truth.slot, card, flipped: wrong.includes(truth.slot) !== truth.turned });
  });
}

describe("clover", () => {
  it("keeps rings private while writing and validates clues", () => {
    const t = table();
    const mine = t.view("a").myCards as [string, string][];
    expect(mine).toHaveLength(4);
    for (const w of mine.flat()) expect(t.wire("b")).not.toContain(`"${w}"`);
    expect(t.rejects(as("a"), { type: "clues", clues: [mine[0]?.[0], "二", "三", "四"] })).toBe(true);
    t.do(as("a"), clues);
    expect(t.rejects(as("a"), clues)).toBe(true);
    expect(t.view("b").submitted).toEqual(["a"]);
  });

  it("gives six points for a perfect first try and hides the answer until then", () => {
    const t = table();
    for (const p of players) t.do(as(p), clues);
    expect(t.state.phase).toBe("solve");
    expect(t.state.solve?.author).toBe("a");
    expect(t.view("b").solve?.tray).toHaveLength(5);
    expect(t.view("b").solve?.answer).toBeNull();
    expect(JSON.stringify(t.view("b"))).not.toContain("truth");
    expect(t.rejects(as("a"), { type: "place", slot: 0, card: 0 })).toBe(true);
    expect(t.rejects(as("b"), { type: "submit" })).toBe(true);
    solve(t, "b");
    t.do(as("c"), { type: "submit" });
    expect(t.state.phase).toBe("result");
    for (const p of players) expect(t.points(p)).toBe(CLOVER_PERFECT);
    expect(t.view("b").solve?.answer).toEqual(t.state.boards.a?.cards);
  });

  it("locks correct cards and scores one per card on the second try", () => {
    const t = table();
    for (const p of players) t.do(as(p), clues);
    solve(t, "b", [1, 2]);
    t.do(as("b"), { type: "submit" });
    expect(t.state.solve?.attempt).toBe(2);
    expect(t.state.solve?.locked).toEqual([true, false, false, true]);
    expect(t.state.solve?.slots[1]).toBeNull();
    expect(t.rejects(as("b"), { type: "place", slot: 0, card: null })).toBe(true);
    solve(t, "b", [2]);
    t.do(as("b"), { type: "submit" });
    expect(t.points("a")).toBe(3);
    t.do(as("a", true), { type: "advance" });
    expect(t.state.solve?.author).toBe("b");
  });

  it("skips rings without clues on timeout and finishes after the last ring", () => {
    const t = table();
    t.do(as("b"), clues);
    t.timeout();
    expect(t.state.solve?.author).toBe("b");
    solve(t, "a");
    t.do(as("a"), { type: "submit" });
    t.do(as("a", true), { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
