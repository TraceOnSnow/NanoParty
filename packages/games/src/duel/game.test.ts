import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { duelGame as game } from "./game.ts";

const table = (players = ["a", "b", "c"]) => new Table(game, makeCtx(players, [], Math.random), { tokens: 2 });
function rigged(hands: Record<string, number[]>, deck = [1, 1, 2, 2, 3]): ReturnType<typeof table> {
  const t = table(Object.keys(hands));
  Object.assign(t.state, { hands, deck, current: "a", alive: Object.keys(hands), shielded: [] });
  return t;
}

describe("duel", () => {
  it("deals one card each (plus a draw for the starter) and keeps hands private", () => {
    const t = table();
    expect([t.state.hands.a?.length, t.state.hands.b?.length, t.state.hands.c?.length]).toEqual([2, 1, 1]);
    expect(t.state.deck.length).toBe(16 - 1 - 3 - 1);
    expect(t.view("b").myHand).toEqual(t.state.hands.b);
    expect(JSON.stringify(t.view("b"))).not.toContain(`"myHand":${JSON.stringify(t.state.hands.a)}`);
  });

  it("guessing right knocks a player out; peeking is private; shields block targeting", () => {
    const t = rigged({ a: [1, 2], b: [5], c: [4] });
    expect(t.rejects(as("a"), { type: "play", card: 1, target: "b" })).toBe(true); // no guess
    t.do(as("a"), { type: "play", card: 1, target: "b", guess: 5 });
    expect(t.state.alive).toEqual(["a", "c"]);
    expect(t.state.current).toBe("c");
    t.do(as("c"), { type: "play", card: 4 }); // c drew 1, played the shield
    expect(t.state.shielded).toEqual(["c"]);
    // a cannot target c now: 2 has no legal target and simply has no effect.
    expect(t.rejects(as("a"), { type: "play", card: 2, target: "c" })).toBe(true);
    t.do(as("a"), { type: "play", card: 2 });
    expect(t.view("a").mySeen).toEqual([]);
  });

  it("comparison knocks out the lower card and both sides learn each other's card", () => {
    const t = rigged({ a: [3, 6], b: [2], c: [8] });
    t.do(as("a"), { type: "play", card: 3, target: "b" });
    expect(t.state.alive).toEqual(["a", "c"]);
    expect(t.view("a").mySeen).toEqual([{ about: "b", card: 2 }]);
    expect(t.view("c").mySeen).toEqual([]);
  });

  it("enforces the advisor rule, discarding the top card is fatal, last one standing wins", () => {
    const t = rigged({ a: [7, 5], b: [8] }, [1, 2, 3]);
    expect(t.rejects(as("a"), { type: "play", card: 5, target: "b" })).toBe(true);
    t.state.hands.a = [5, 1];
    t.do(as("a"), { type: "play", card: 5, target: "b" });
    expect(t.state.log.at(-1)).toMatchObject({ discarded: 8, out: ["b"] });
    expect([t.state.phase, t.state.roundWinners, t.state.tokens.a]).toEqual(["roundOver", ["a"], 1]);
    expect(t.points("a")).toBe(1);
    t.do(host, { type: "next" });
    expect([t.state.round, t.state.current]).toEqual([2, "a"]);
  });

  it("when the deck runs out, the highest card wins", () => {
    const t = rigged({ a: [1, 2], b: [6], c: [3] }, []);
    t.do(as("a"), { type: "play", card: 1, target: "c", guess: 2 });
    expect(t.state.showdown).toEqual({ a: 2, b: 6, c: 3 });
    expect(t.state.roundWinners).toEqual(["b"]);
  });
});
