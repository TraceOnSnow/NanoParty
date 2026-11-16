import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { type ClimbState, climbGame as game, heightOf, optionsFor } from "./game.ts";

/** A random source that yields the given dice faces in order, then repeats the last one. */
const diceOf = (...faces: number[]) => {
  let i = 0;
  return () => ((faces[Math.min(i++, faces.length - 1)] as number) - 1) / 6 + 0.01;
};
const table = (random: () => number = Math.random, players = ["a", "b", "c"]) =>
  new Table(game, makeCtx(players, [], random), { games: 2 });

describe("climb", () => {
  it("has longer columns towards the middle", () => {
    expect([2, 3, 7, 11, 12].map(heightOf)).toEqual([3, 5, 13, 5, 3]);
  });

  it("offers each distinct pairing once and requires both sums when both fit", () => {
    const t = table();
    expect(optionsFor(t.state, [1, 1, 1, 1])).toEqual([[2, 2]]);
    expect(
      optionsFor(t.state, [1, 2, 3, 4])
        .map((o) => o.join("+"))
        .sort(),
    ).toEqual(["3+7", "4+6", "5+5"]);
  });

  it("limits a turn to three columns and lets the player choose when only one of two fits", () => {
    const t = table();
    const s = t.state as ClimbState;
    s.climbers = { 2: 1, 3: 1 };
    // Pairings 4+7 and 5+6: one free climber, so any one of the four columns, never two.
    expect(
      optionsFor(s, [2, 2, 3, 4])
        .map((o) => o.join("+"))
        .sort(),
    ).toEqual(["4", "5", "6", "7"]);
    s.climbers = { 2: 1, 3: 1, 4: 1 };
    expect(optionsFor(s, [5, 5, 6, 6])).toEqual([]);
  });

  it("banks progress on stop and passes the turn", () => {
    const t = table(diceOf(1, 1, 2, 2));
    const first = t.state.current;
    expect(t.rejects(as(first), { type: "stop" })).toBe(true);
    expect(t.rejects(as("zz"), { type: "roll" })).toBe(true);
    t.do(as(first), { type: "roll" });
    expect(t.state.phase).toBe("move");
    expect(t.rejects(as(first), { type: "roll" })).toBe(true);
    const index = t.state.options.findIndex((o) => o.join() === "3,3");
    t.do(as(first), { type: "move", option: index });
    expect(t.state.climbers).toEqual({ 3: 2 });
    t.do(as(first), { type: "stop" });
    expect(t.state.saved[first]).toEqual({ 3: 2 });
    expect(t.state.current).not.toBe(first);
    expect(t.state.climbers).toEqual({});
  });

  it("loses the turn's climbers on a roll that fits nowhere", () => {
    const t = table(diceOf(6, 6, 6, 6));
    const s = t.state as ClimbState;
    const first = s.current;
    s.saved[first] = { 7: 4 };
    s.climbers = { 2: 1, 3: 2, 7: 6 };
    t.do(as(first), { type: "roll" });
    expect(t.state.last?.kind).toBe("bust");
    expect(t.state.saved[first]).toEqual({ 7: 4 });
    expect(t.state.current).not.toBe(first);
  });

  it("claims a column at the top, blocks it for others, and three columns win", () => {
    const t = table(diceOf(1, 1, 1, 1));
    const s = t.state as ClimbState;
    const first = s.current;
    s.claimed = { 11: first, 12: first };
    s.saved[first] = { 2: 1 };
    t.do(as(first), { type: "roll" });
    t.do(as(first), { type: "move", option: 0 });
    expect(t.state.climbers).toEqual({ 2: 3 });
    t.do(as(first), { type: "stop" });
    expect([t.state.phase, t.state.winners, t.state.claimed[2]]).toEqual(["gameOver", [first], first]);
    expect(t.points(first)).toBe(3);
    expect(t.rejects(as("b"), { type: "next" })).toBe(true);
    t.do(host, { type: "next" });
    expect([t.state.game, t.state.phase, t.state.claimed]).toEqual([2, "decide", {}]);
  });

  it("shows everyone the same table: there is nothing hidden", () => {
    const t = table();
    expect(t.view("a")).toEqual(t.view("b"));
  });
});
