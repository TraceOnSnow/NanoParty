import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { type Owner, wordGridGame } from "./game.ts";

const players = ["a", "b", "c", "d"]; // red: a (captain), c — blue: b (captain), d
const table = () =>
  new Table(
    wordGridGame,
    makeCtx(players, [], () => 0.1),
  );
const find = (t: ReturnType<typeof table>, owner: Owner, nth = 0) =>
  t.state.owners.map((o, i) => (o === owner && !t.state.revealed[i] ? i : -1)).filter((i) => i >= 0)[nth] as number;

describe("wordgrid", () => {
  it("deals 9/8/7/1 and only shows the key to captains", () => {
    const t = table();
    const count = (o: Owner) => t.state.owners.filter((x) => x === o).length;
    expect([count(t.state.turn), count(t.state.turn === 0 ? 1 : 0), count("neutral"), count("trap")]).toEqual([
      9, 8, 7, 1,
    ]);
    expect(t.view("a").owners.every((o) => o !== null)).toBe(true);
    expect(t.view("c").owners.every((o) => o === null)).toBe(true);
    expect(t.game.publicSummary(t.state)).not.toContain("trap");
  });

  it("enforces roles, turn order and the guess limit", () => {
    const t = table();
    const me = t.state.turn; // random 0.1 → red starts
    expect(me).toBe(0);
    expect(t.rejects(as("c"), { type: "clue", word: "天空", count: 1 })).toBe(true);
    expect(t.rejects(as("b"), { type: "clue", word: "天空", count: 1 })).toBe(true);
    expect(t.rejects(as("a"), { type: "clue", word: t.state.words[0], count: 1 })).toBe(true);
    t.do(as("a"), { type: "clue", word: "天空", count: 1 });
    expect(t.rejects(as("a"), { type: "guess", index: find(t, 0) })).toBe(true);
    expect(t.rejects(as("c"), { type: "stop" })).toBe(true);
    t.do(as("c"), { type: "guess", index: find(t, 0) });
    expect(t.state.phase).toBe("guess");
    t.do(as("c"), { type: "guess", index: find(t, 0) }); // count + 1 used up
    expect(t.state.turn).toBe(1);
    expect(t.state.phase).toBe("clue");
    expect(t.view("d").owners.filter((o) => o !== null)).toHaveLength(2);
  });

  it("ends the turn on a wrong word and loses on the trap", () => {
    const t = table();
    t.do(as("a"), { type: "clue", word: "天空", count: 3 });
    t.do(as("c"), { type: "guess", index: find(t, "neutral") });
    expect(t.state.turn).toBe(1);
    t.do(as("b"), { type: "clue", word: "大地", count: 2 });
    t.do(as("d"), { type: "guess", index: find(t, "trap") });
    expect(t.state.winner).toBe(0);
    expect(t.state.endedBy).toBe("trap");
    expect(t.points("a")).toBe(3);
    expect(t.points("c")).toBe(3);
    expect(t.points("d")).toBe(0);
    expect(t.view("d").owners.every((o) => o !== null)).toBe(true);
  });

  it("wins by finding every word, then finishes", () => {
    const t = table();
    for (let n = 0; n < 9; n++) {
      if (t.state.phase === "clue" && t.state.turn === 0) t.do(as("a"), { type: "clue", word: "天空", count: 9 });
      t.do(as("c"), { type: "guess", index: find(t, 0) });
    }
    expect(t.state.winner).toBe(0);
    expect(t.rejects(as("b"), { type: "next" })).toBe(true);
    t.do(as("a", true), { type: "next" });
    expect(t.finished).toBe(true);
  });
});
