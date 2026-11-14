import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { percentGame } from "./game.ts";

const players = ["a", "b", "c", "d"];
const prompts = [1, 2, 3].map((n) => ({ text: `问题${n}` }));
const table = (config = {}) => new Table(percentGame, makeCtx(players, [...prompts]), config);
const answer = (t: ReturnType<typeof table>, yes: boolean[]) => {
  for (const [i, p] of players.entries()) t.do(as(p), { type: "answer", yes: yes[i] });
};

describe("percent", () => {
  it("never exposes individual answers", () => {
    const t = table();
    expect(t.state.guesser).toBe("a");
    answer(t, [true, false, true, true]);
    expect(t.state.phase).toBe("guess");
    expect(t.view("b").myAnswer).toBe(false);
    expect(JSON.stringify(t.view("b"))).not.toContain('"answers"');
    expect(t.view("b").reveal).toBeNull();
    t.do(as("a"), { type: "guess", count: 2 });
    for (const p of ["b", "c", "d"]) t.do(as(p), { type: "bet", side: "higher" });
    const v = t.view("b");
    expect(v.reveal).toEqual({ answered: 4, yes: 3, bets: { b: "higher", c: "higher", d: "higher" } });
    expect(JSON.stringify(v)).not.toContain('"answers"');
  });

  it("scores near and exact guesses and correct bets", () => {
    const t = table({ rounds: 2 });
    answer(t, [true, false, true, true]);
    expect(t.rejects(as("b"), { type: "guess", count: 2 })).toBe(true);
    expect(t.rejects(as("a"), { type: "guess", count: 5 })).toBe(true);
    t.do(as("a"), { type: "guess", count: 2 });
    expect(t.rejects(as("a"), { type: "bet", side: "higher" })).toBe(true);
    t.do(as("b"), { type: "bet", side: "higher" });
    t.do(as("c"), { type: "bet", side: "lower" });
    t.do(as("d"), { type: "bet", side: "higher" });
    expect(t.state.phase).toBe("reveal");
    expect(t.points("a")).toBe(1); // off by one
    expect(t.points("b")).toBe(1);
    expect(t.points("c")).toBe(0);
    t.do(as("a", true), { type: "advance" });
    expect(t.state.guesser).toBe("b");
    answer(t, [false, false, false, true]);
    t.do(as("b"), { type: "guess", count: 1 });
    for (const p of ["a", "c", "d"]) t.do(as(p), { type: "bet", side: "lower" });
    expect(t.points("b")).toBe(1 + 3); // exact
    expect(t.points("d")).toBe(1); // nobody wins a bet against an exact guess
    t.do(as("a", true), { type: "advance" });
    expect(t.finished).toBe(true);
  });

  it("moves on by timeout with whatever was submitted", () => {
    const t = table();
    t.do(as("a"), { type: "answer", yes: true });
    t.do(as("b"), { type: "answer", yes: true });
    t.timeout();
    expect(t.state.phase).toBe("guess");
    t.timeout();
    expect(t.state.phase).toBe("reveal");
    expect(t.scores).toEqual([]);
  });
});
