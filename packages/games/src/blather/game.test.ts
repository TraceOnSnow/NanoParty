import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { blatherGame, FRAMES } from "./game.ts";

const players = ["a", "b", "c"];
const words = ["月亮", "火锅", "地铁", "熊猫"].map((word) => ({ word }));
const table = (config = {}) => new Table(blatherGame, makeCtx(players, [...words]), config);

describe("blather", () => {
  it("shows the word only to the describer", () => {
    const t = table();
    expect(t.state.phase).toBe("describe");
    expect(t.state.describer).toBe("a");
    expect(t.view("a").word).toBe("月亮");
    expect(t.wire("b")).not.toContain("月亮");
  });

  it("only lets the describer speak through frames", () => {
    const t = table();
    expect(t.rejects(as("b"), { type: "say", frame: 0, word: 0 })).toBe(true);
    expect(t.rejects(as("a"), { type: "say", frame: 0, word: 99 })).toBe(true);
    t.do(as("a"), { type: "say", frame: 1, word: 17 });
    expect(t.view("b").sentences).toEqual([FRAMES[1]?.text.replace("____", FRAMES[1]?.words[17] as string)]);
    expect(t.rejects(as("a"), { type: "say", frame: 1, word: 17 })).toBe(true);
    expect(t.rejects(as("a"), { type: "guess", text: "月亮" })).toBe(true);
  });

  it("scores the guesser and describer, then rotates", () => {
    const t = table({ rounds: 2 });
    t.do(as("b"), { type: "guess", text: "太阳" });
    t.do(as("a"), { type: "react", index: 0, close: true });
    expect(t.view("c").guesses[0]?.close).toBe(true);
    t.do(as("c"), { type: "guess", text: "月亮" });
    expect(t.state.phase).toBe("reveal");
    expect(t.points("c")).toBe(2);
    expect(t.points("a")).toBe(1);
    expect(t.view("b").word).toBe("月亮");
    t.do(as("a", true), { type: "advance" });
    expect(t.state.describer).toBe("b");
    t.timeout();
    expect(t.state.phase).toBe("reveal");
    expect(t.state.winner).toBeNull();
    t.do(as("a", true), { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
