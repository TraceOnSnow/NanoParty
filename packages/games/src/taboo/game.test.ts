import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { tabooGame } from "./game.ts";

const players = ["a", "b", "c", "d"];
const cards = ["火锅", "地铁", "熊猫", "外卖", "春节"].map((word) => ({ word, taboo: ["甲甲", "乙乙"] }));
const table = (n = cards.length) => new Table(tabooGame, makeCtx(players, cards.slice(0, n)));

describe("taboo", () => {
  it("shows the card only to the describer and the referee", () => {
    const t = table();
    expect(t.state.describer).toBe("a");
    expect(t.state.referee).toBe("b");
    expect(t.view("a").card?.word).toBe("火锅");
    expect(t.view("b").card?.taboo).toEqual(["甲甲", "乙乙"]);
    expect(t.wire("c")).not.toContain("火锅");
    expect(t.wire("c")).not.toContain("甲甲");
  });

  it("scores a correct guess for guesser and describer and moves on", () => {
    const t = table();
    expect(t.rejects(as("b"), { type: "guess", text: "火锅" })).toBe(true);
    t.do(as("c"), { type: "guess", text: "烧烤" });
    expect(t.view("d").guesses).toEqual([{ by: "c", text: "烧烤" }]);
    t.do(as("c"), { type: "guess", text: " 火锅！" });
    expect(t.points("c")).toBe(1);
    expect(t.points("a")).toBe(1);
    expect(t.view("a").card?.word).toBe("地铁");
    expect(t.rejects(as("c"), { type: "pass" })).toBe(true);
    expect(t.rejects(as("a"), { type: "foul" })).toBe(true);
    t.do(as("a"), { type: "pass" });
    t.do(as("b"), { type: "foul" });
    expect(t.state.played.map((p) => p.outcome)).toEqual(["guessed", "passed", "foul"]);
    expect(t.points("a")).toBe(1);
  });

  it("rotates on timeout and finishes after everyone has described", () => {
    const t = table();
    for (let turn = 1; turn <= 4; turn++) {
      expect(t.state.describer).toBe(players[turn - 1]);
      t.timeout();
      expect(t.state.phase).toBe("turnOver");
      expect(t.wire("c")).toContain(t.state.played.at(-1)?.word);
      t.do(as("a", true), { type: "next" });
    }
    expect(t.finished).toBe(true);
  });

  it("ends the turn when the cards run out", () => {
    const t = table(1);
    t.do(as("c"), { type: "guess", text: "火锅" });
    expect(t.state.phase).toBe("turnOver");
    t.do(as("a", true), { type: "next" });
    expect(t.state.endedBecause).toBe("no-content");
    expect(t.finished).toBe(true);
  });
});
