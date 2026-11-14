import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import { pollMineGame } from "./game.ts";

const players = ["a", "b", "c", "d"]; // red: a, c — blue: b, d
const polls = [1, 2, 3, 4].map((n) => ({ text: `题目${n}`, options: ["甲", "乙", "丙", "丁", "戊"] }));
const table = (config = {}) => new Table(pollMineGame, makeCtx(players, [...polls]), config);
const vote = (t: ReturnType<typeof table>, picks: number[]) => {
  for (const [i, p] of players.entries()) t.do(as(p), { type: "vote", option: picks[i] });
};

describe("pollmine", () => {
  it("hides votes and counts until options are opened", () => {
    const t = table();
    t.do(as("a"), { type: "vote", option: 3 });
    expect(t.view("b").voted).toEqual(["a"]);
    expect(t.view("b").myVote).toBeNull();
    expect(JSON.stringify(t.view("b"))).not.toContain('"votes"');
    expect(t.view("b").counts).toBeNull();
    expect(t.rejects(as("a"), { type: "vote", option: 1 })).toBe(true);
    expect(t.rejects(as("b"), { type: "vote", option: 9 })).toBe(true);
  });

  it("scores found options, costs a life for empty ones and alternates turns", () => {
    const t = table();
    vote(t, [0, 0, 1, 2]);
    expect(t.state.phase).toBe("hunt");
    expect(t.rejects(as("b"), { type: "open", option: 0 })).toBe(true); // red goes first in round 1
    t.do(as("c"), { type: "open", option: 0 });
    expect(t.state.points).toEqual([2, 0]);
    expect(t.rejects(as("d"), { type: "open", option: 0 })).toBe(true);
    t.do(as("d"), { type: "open", option: 4 });
    expect(t.state.lives).toEqual([2, 1]);
    t.do(as("a"), { type: "open", option: 3 });
    t.do(as("b"), { type: "open", option: 1 });
    expect(t.state.phase).toBe("hunt");
    t.do(as("a"), { type: "open", option: 2 });
    expect(t.state.phase).toBe("reveal");
    expect(t.state.points).toEqual([3, 1]);
    expect(t.points("a")).toBe(2);
    expect(t.points("c")).toBe(2);
    expect(t.points("b")).toBe(0);
    expect(t.view("b").counts).toEqual([2, 1, 1, 0, 0]);
  });

  it("passes over a team with no lives and ends when both are out", () => {
    const t = table({ rounds: 1 });
    vote(t, [0, 0, 0, 0]);
    // Everyone chose the same option, so only one is worth finding.
    t.do(as("a"), { type: "open", option: 1 });
    t.do(as("b"), { type: "open", option: 2 });
    t.do(as("a"), { type: "open", option: 3 });
    expect(t.state.lives).toEqual([0, 1]);
    expect(t.state.turn).toBe(1);
    t.do(as("b"), { type: "open", option: 4 });
    expect(t.state.phase).toBe("reveal");
    expect(t.scores).toEqual([]);
    t.do(as("a", true), { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
