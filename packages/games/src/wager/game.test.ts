import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { wagerGame as game } from "./game.ts";

const questions = [
  { text: "钢琴有多少个键？", unit: "个", answer: 88 },
  { text: "一天多少秒？", unit: "秒", answer: 86400 },
];

describe("wager", () => {
  it("hides estimates until everyone is in and the answer until the reveal", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], questions));
    t.do(as("a"), { type: "guess", value: 123 });
    expect(t.wire("b")).not.toContain("123");
    expect(t.view("b").guesses).toBeNull();
    t.do(as("b"), { type: "guess", value: 90 });
    t.do(as("c"), { type: "guess", value: 60 });
    expect(t.state.phase).toBe("bet");
    expect(t.view("c").guesses).toEqual([
      { playerId: "c", value: 60 },
      { playerId: "b", value: 90 },
      { playerId: "a", value: 123 },
    ]);
    expect(t.wire("c")).not.toContain("88");
    t.do(as("a"), { type: "bet", on: "b" });
    expect(t.view("c").myBet).toBeNull();
    expect(t.view("c").reveal).toBeNull();
  });

  it("pays the closest estimate and everyone who bet on it", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], questions));
    t.do(as("a"), { type: "guess", value: 123 });
    t.do(as("b"), { type: "guess", value: 90 });
    t.do(as("c"), { type: "guess", value: 60 });
    expect(t.rejects(as("a"), { type: "bet", on: "zz" })).toBe(true);
    t.do(as("a"), { type: "bet", on: "b" });
    expect(t.rejects(as("a"), { type: "bet", on: "c" })).toBe(true);
    t.do(as("b"), { type: "bet", on: "b" });
    t.do(as("c"), { type: "bet", on: "a" });
    expect(t.state.phase).toBe("reveal");
    expect([t.points("a"), t.points("b"), t.points("c")]).toEqual([1, 3, 0]);
    expect(t.view("c").reveal).toMatchObject({ answer: 88, closest: ["b"] });
  });

  it("skips betting when all estimates are equal; exact answers get a bonus", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], questions), { rounds: 1 });
    for (const p of ["a", "b", "c"]) t.do(as(p), { type: "guess", value: 88 });
    expect(t.state.phase).toBe("reveal");
    expect([t.points("a"), t.points("b"), t.points("c")]).toEqual([3, 3, 3]);
    expect(t.rejects(as("b"), { type: "advance" })).toBe(true);
    t.do(host, { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
