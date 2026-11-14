import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { skullGame as game, type SkullState } from "./game.ts";

const table = () =>
  new Table(
    game,
    makeCtx(["a", "b", "c"], [], () => 0),
    {},
  );
const setupAll = (t: Table<SkullState>, discs: Record<string, "flower" | "skull">) => {
  for (const [p, disc] of Object.entries(discs)) t.do(as(p), { type: "place", disc });
};

describe("skull", () => {
  it("keeps stacks secret: others only see sizes", () => {
    const t = table();
    t.do(as("a"), { type: "place", disc: "skull" });
    expect(t.view("a").myStack).toEqual(["skull"]);
    expect(t.view("b").placed).toEqual(["a"]);
    expect(JSON.stringify(t.view("b"))).not.toContain('skull"]');
    expect(t.rejects(as("a"), { type: "place", disc: "flower" })).toBe(true);
    t.do(as("b"), { type: "place", disc: "flower" });
    t.do(as("c"), { type: "place", disc: "flower" });
    expect(t.state.phase).toBe("turns");
    expect(t.rejects(as("a"), { type: "place", disc: "skull" })).toBe(true); // only one skull
  });

  it("runs adding and bidding in turn; the challenger flips their own stack first", () => {
    const t = table();
    setupAll(t, { a: "flower", b: "flower", c: "flower" });
    t.do(as("a"), { type: "place", disc: "flower" });
    expect(t.rejects(as("b"), { type: "bid", value: 5 })).toBe(true);
    t.do(as("b"), { type: "bid", value: 2 });
    expect(t.rejects(as("c"), { type: "place", disc: "flower" })).toBe(true);
    expect(t.rejects(as("c"), { type: "bid", value: 2 })).toBe(true);
    t.do(as("c"), { type: "pass" });
    t.do(as("a"), { type: "pass" });
    expect([t.state.phase, t.state.current, t.state.flipped]).toEqual([
      "flipping",
      "b",
      [{ owner: "b", disc: "flower" }],
    ]);
    expect(t.rejects(as("b"), { type: "flip", owner: "b" })).toBe(true);
    t.do(as("b"), { type: "flip", owner: "a" });
    expect(t.state.result).toEqual({ challenger: "b", success: true, lostDisc: null, eliminated: false });
    expect(t.state.wins.b).toBe(1);
  });

  it("hitting a skull loses a disc; two successes win the game", () => {
    const t = table();
    setupAll(t, { a: "skull", b: "flower", c: "flower" });
    t.do(as("a"), { type: "bid", value: 3 }); // the maximum: flip at once
    // a flips own skull first: fails, loses a random disc (random() = 0 -> a flower)
    expect(t.state.result).toEqual({ challenger: "a", success: false, lostDisc: "flower", eliminated: false });
    expect(t.state.owned.a).toEqual({ flowers: 2, skull: true });
    t.do(host, { type: "next" });
    setupAll(t, { a: "flower", b: "flower", c: "flower" });
    t.do(as("a"), { type: "bid", value: 3 });
    t.do(as("a"), { type: "flip", owner: "b" });
    t.do(as("a"), { type: "flip", owner: "c" });
    expect(t.state.wins.a).toBe(1);
    t.do(host, { type: "next" });
    setupAll(t, { a: "flower", b: "flower", c: "flower" });
    t.do(as("a"), { type: "bid", value: 3 });
    t.do(as("a"), { type: "flip", owner: "c" });
    t.do(as("a"), { type: "flip", owner: "b" });
    expect(t.state.winner).toBe("a");
    expect(t.points("a")).toBe(3);
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
