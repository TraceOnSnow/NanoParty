import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { type DelveCard, type DelveState, delveGame as game, relicValue } from "./game.ts";

const gems = (value: number): DelveCard => ({ kind: "gems", value, left: 0 });
const hazard = (name: string): DelveCard => ({ kind: "hazard", hazard: name });
/** A table of three whose cave shows `first` and will turn over `next` in order. */
function table(first: DelveCard, next: DelveCard[], config: Record<string, number> = {}) {
  const t = new Table(game, makeCtx(["a", "b", "c"], [], Math.random), config);
  const s = t.state as DelveState;
  s.path = [first];
  s.deck = next;
  s.carried = { a: 0, b: 0, c: 0 };
  if (first.kind === "gems") {
    s.carried = { a: Math.floor(first.value / 3), b: Math.floor(first.value / 3), c: Math.floor(first.value / 3) };
    first.left = first.value % 3;
  }
  return t;
}
const all = (t: ReturnType<typeof table>, choices: Record<string, boolean>) => {
  for (const [p, stay] of Object.entries(choices)) t.do(as(p), { type: "choose", stay });
};

describe("delve", () => {
  it("starts with one card turned over, 15 gem cards, 15 hazards and a relic", () => {
    const s = new Table(game, makeCtx(["a", "b", "c"], [], Math.random)).state as DelveState;
    const cards = [...s.path, ...s.deck];
    expect(cards.length).toBe(31);
    expect(cards.filter((c) => c.kind === "hazard").length).toBe(15);
    expect([relicValue(0), relicValue(2), relicValue(3)]).toEqual([5, 5, 10]);
  });

  it("keeps choices and tents private until everyone has chosen", () => {
    const t = table(gems(7), [gems(9)]);
    t.do(as("a"), { type: "choose", stay: false });
    expect(t.rejects(as("a"), { type: "choose", stay: true })).toBe(true);
    expect(t.view("b").chosen).toEqual(["a"]);
    expect(t.view("b").myChoice).toBeNull();
    const wire = t.wire("b");
    expect(wire).not.toContain('"choices"');
    expect(wire).not.toContain('"banked":{');
    expect(wire).not.toContain('"deck"');
  });

  it("shares gems among those inside and leaves the remainder on the path for those who walk out", () => {
    const t = table(gems(7), [gems(9), gems(4)]);
    expect([t.state.carried, t.state.path[0]]).toEqual([
      { a: 2, b: 2, c: 2 },
      { kind: "gems", value: 7, left: 1 },
    ]);
    all(t, { a: false, b: true, c: true });
    // a takes the 1 left on the path plus the 2 carried; b and c split the next 9 as 4 + 4.
    expect([t.view("a").myBanked, t.state.inside, t.state.carried]).toEqual([3, ["b", "c"], { a: 0, b: 6, c: 6 }]);
    expect(t.state.lastLeft).toEqual({ players: ["a"], each: 1, relics: 0 });
    expect(t.state.path[1]).toEqual({ kind: "gems", value: 9, left: 1 });
  });

  it("the second hazard of a kind empties everyone still inside and is removed for good", () => {
    const t = table(hazard("毒蛇"), [gems(9), hazard("毒蛇")]);
    all(t, { a: true, b: true, c: true });
    expect(t.state.carried).toEqual({ a: 3, b: 3, c: 3 });
    all(t, { a: false, b: true, c: true });
    expect([t.state.phase, t.state.collapsed, t.state.carried, t.state.removed]).toEqual([
      "roundOver",
      "毒蛇",
      { a: 0, b: 0, c: 0 },
      ["毒蛇"],
    ]);
    expect([t.view("a").myBanked, t.view("b").myBanked]).toEqual([3, 0]);
    t.do(host, { type: "next" });
    const s = t.state as DelveState;
    expect([...s.path, ...s.deck].filter((c) => c.kind === "hazard" && c.hazard === "毒蛇").length).toBe(2);
  });

  it("gives a relic only to a player who leaves alone", () => {
    const pair = table({ kind: "relic", taken: false }, [gems(1)]);
    all(pair, { a: false, b: false, c: true });
    expect(pair.state.lastLeft?.relics).toBe(0);
    const solo = table({ kind: "relic", taken: false }, [gems(1)]);
    all(solo, { a: false, b: true, c: true });
    expect([solo.state.lastLeft?.relics, solo.view("a").myBanked]).toEqual([5, 5]);
  });

  it("ends the round when everyone has left, times out by walking out, and the richest tent wins", () => {
    const t = table(gems(9), [gems(3)], { rounds: 1 });
    t.do(as("a"), { type: "choose", stay: true });
    t.timeout();
    expect([t.state.inside, t.view("b").myBanked]).toEqual([["a"], 3]);
    all(t, { a: false });
    expect([t.state.phase, t.view("a").myBanked]).toEqual(["roundOver", 6]);
    expect(t.rejects(as("b"), { type: "next" })).toBe(true);
    t.do(host, { type: "next" });
    expect([t.finished, t.state.winners, t.view("b").banked]).toEqual([true, ["a"], { a: 6, b: 3, c: 3 }]);
  });
});
