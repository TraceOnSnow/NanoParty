import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { allStones, spellGame as game, revealedAtStart, type SpellState } from "./game.ts";

const table = (players = ["a", "b", "c", "d"], config: Record<string, number> = {}, random = Math.random) =>
  new Table(game, makeCtx(players, [], random), config);
/** Puts the table in a known position with `a` to move. */
function scene(hands: Record<string, number[]>, config: Record<string, number> = {}, random: () => number = () => 0.5) {
  const t = table(Object.keys(hands), config, random);
  const s = t.state as SpellState;
  s.hands = structuredClone(hands);
  s.current = "a";
  s.floor = 0;
  s.casts = 0;
  s.supply = [8, 8, 8, 8, 8, 8];
  s.secret = [4, 6, 7, 2];
  s.board = {};
  return t;
}

describe("spell", () => {
  it("has 36 stones and deals five each with four set aside", () => {
    expect(allStones().length).toBe(36);
    expect(allStones().filter((n) => n === 5).length).toBe(5);
    expect([2, 3, 4, 5].map(revealedAtStart)).toEqual([12, 6, 0, 0]);
    for (const players of [
      ["a", "b"],
      ["a", "b", "c"],
      ["a", "b", "c", "d", "e"],
    ]) {
      const s = table(players).state as SpellState;
      const onBoard = Object.values(s.board).reduce((n, k) => n + k, 0);
      expect(Object.values(s.hands).every((h) => h.length === 5)).toBe(true);
      expect(s.secret.length + onBoard + s.supply.length + players.length * 5).toBe(36);
      expect(onBoard).toBe(revealedAtStart(players.length));
    }
  });

  it("never sends a player their own stones, the supply or the secret stones", () => {
    const t = scene({ a: [1, 1, 1, 1, 1], b: [2, 2, 2, 2, 2], c: [3, 3, 3, 3, 3] });
    const view = t.view("a");
    expect(view.hands.a).toBeUndefined();
    expect(view.hands.b).toEqual([2, 2, 2, 2, 2]);
    expect(view.myCount).toBe(5);
    const wire = t.wire("a");
    expect(wire).not.toContain("[1,1,1,1,1]");
    expect(wire).not.toContain('"supply"');
    expect(wire).not.toContain('"secret"');
    expect(wire).not.toContain('"taken"');
  });

  it("a right call moves the stone to the board and lets the caster go on with equal or higher", () => {
    const t = scene({ a: [6, 6, 8, 3, 2], b: [1, 2, 3, 4, 5], c: [5, 5, 5, 7, 7] });
    expect(t.rejects(as("b"), { type: "cast", number: 6 })).toBe(true);
    expect(t.rejects(as("a"), { type: "end" })).toBe(true);
    t.do(as("a"), { type: "cast", number: 6 });
    expect([t.state.hands.a, t.state.board[6], t.state.life.b, t.state.floor]).toEqual([[6, 8, 3, 2], 1, 5, 6]);
    expect(t.rejects(as("a"), { type: "cast", number: 3 })).toBe(true);
    t.do(as("a"), { type: "cast", number: 8 });
    expect(t.state.life.a).toBe(6);
    t.do(as("a"), { type: "end" });
    expect([t.state.current, t.state.hands.a?.length]).toEqual(["b", 5]);
  });

  it("a wrong call costs a life and ends the turn", () => {
    const t = scene({ a: [6, 6, 8, 3, 2], b: [1, 2, 3, 4, 5], c: [5, 5, 5, 7, 7] });
    t.do(as("a"), { type: "cast", number: 7 });
    expect([t.state.life.a, t.state.current, t.state.log.at(-1)?.hit]).toEqual([5, "b", false]);
  });

  it("applies each spell to the right people", () => {
    const hands = { a: [1, 2, 3, 4, 5], b: [8, 8, 8, 8, 8], c: [8, 8, 8, 8, 8], d: [8, 8, 8, 8, 8] };
    // The die reads 2 with this random source.
    const t = scene(hands);
    (t.state as SpellState).life = { a: 3, b: 6, c: 6, d: 6 };
    t.do(as("a"), { type: "cast", number: 1 });
    expect(t.state.life).toEqual({ a: 3, b: 4, c: 4, d: 4 });
    t.do(as("a"), { type: "cast", number: 2 });
    expect(t.state.life).toEqual({ a: 4, b: 3, c: 3, d: 3 });
    t.do(as("a"), { type: "cast", number: 3 });
    expect(t.state.life.a).toBe(6);
    t.do(as("a"), { type: "cast", number: 4 });
    expect([t.view("a").myTaken, t.view("b").myTaken, t.view("b").takenCount.a, t.state.secret.length]).toEqual([
      [4],
      [],
      1,
      3,
    ]);
    t.do(as("a"), { type: "cast", number: 5 });
    // The last stone: everyone else falls and the caster takes the round.
    expect([t.state.phase, t.state.roundWinner, t.state.gained]).toEqual([
      "roundOver",
      "a",
      { a: 4, b: 0, c: 0, d: 0 },
    ]);
  });

  it("left is the next player and right the previous one", () => {
    const t = scene({ a: [6, 7, 8, 8, 8], b: [8, 8, 8, 8, 8], c: [8, 8, 8, 8, 8], d: [8, 8, 8, 8, 8] });
    t.do(as("a"), { type: "cast", number: 6 });
    t.do(as("a"), { type: "cast", number: 7 });
    expect(t.state.life).toEqual({ a: 6, b: 5, c: 6, d: 5 });
  });

  it("ends the round when someone falls: survivors score, the one who did it scores three", () => {
    const t = scene({ a: [7, 8, 8, 8, 8], b: [8, 8, 8, 8, 8], c: [8, 8, 8, 8, 8] });
    (t.state as SpellState).life = { a: 2, b: 6, c: 1 };
    t.do(as("a"), { type: "cast", number: 7 });
    expect([t.state.phase, t.state.gained]).toEqual(["roundOver", { a: 3, b: 1, c: 0 }]);
    expect(t.view("a").hands.a).toBeDefined();
    t.do(host, { type: "next" });
    expect([t.state.round, t.state.life.c, t.state.points]).toEqual([2, 6, { a: 3, b: 1, c: 0 }]);
  });

  it("falling by your own wrong call gives the others a point each", () => {
    const t = scene({ a: [7, 8, 8, 8, 8], b: [8, 8, 8, 8, 8], c: [8, 8, 8, 8, 8] });
    (t.state as SpellState).life = { a: 1, b: 6, c: 6 };
    t.do(as("a"), { type: "cast", number: 2 });
    expect([t.state.roundWinner, t.state.gained]).toEqual([null, { a: 0, b: 1, c: 1 }]);
  });

  it("finishes when someone reaches the target", () => {
    const t = scene({ a: [7, 8, 8, 8, 8], b: [8, 8, 8, 8, 8] }, { target: 3 });
    (t.state as SpellState).life = { a: 6, b: 1 };
    t.do(as("a"), { type: "cast", number: 7 });
    expect([t.state.phase, t.state.winners]).toEqual(["gameOver", ["a"]]);
    expect(t.points("a")).toBe(3);
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
