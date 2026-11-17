import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { spyGame as game, SPY_PLACES, type SpyState } from "./game.ts";

/** Four players; `c` is the outsider and the place is the hospital. */
function table(config: Record<string, number> = {}) {
  const t = new Table(game, makeCtx(["a", "b", "c", "d"], [], Math.random), config);
  Object.assign(t.state as SpyState, { spy: "c", place: "医院" });
  return t;
}

describe("spy", () => {
  it("has thirty different places and picks one of them and one outsider", () => {
    expect(new Set(SPY_PLACES).size).toBe(30);
    const s = new Table(game, makeCtx(["a", "b", "c"], [], Math.random)).state as SpyState;
    expect(SPY_PLACES).toContain(s.place);
    expect(["a", "b", "c"]).toContain(s.spy);
  });

  it("tells everyone the place except the outsider, and nobody who the outsider is", () => {
    const t = table();
    expect([t.view("a").place, t.view("a").iAmSpy]).toEqual(["医院", false]);
    expect([t.view("c").place, t.view("c").iAmSpy]).toEqual([null, true]);
    expect(t.view("c").places.length).toBe(30);
    expect(t.wire("a")).not.toContain('"spy"');
    expect(t.wire("a")).not.toContain("外人是");
    expect(t.wire("c")).not.toContain('"place":"医院"');
  });

  it("puts an accusation to a majority vote; a failed one returns to the talk", () => {
    const t = table();
    expect(t.rejects(as("a"), { type: "accuse", target: "a" })).toBe(true);
    t.do(as("a"), { type: "accuse", target: "b" });
    expect([t.state.phase, t.view("d").vote]).toEqual(["vote", { by: "a", target: "b", voted: ["a"], myVote: null }]);
    expect(t.rejects(as("b"), { type: "vote", yes: false })).toBe(true);
    t.do(as("c"), { type: "vote", yes: false });
    t.do(as("d"), { type: "vote", yes: false });
    expect([t.state.phase, t.state.failed]).toEqual(["talk", { by: "a", target: "b", yes: 1, no: 2 }]);
    expect(t.rejects(as("a"), { type: "accuse", target: "c" })).toBe(true);
  });

  it("catching the outsider scores for the table and the accuser; a wrong reveal scores for the outsider", () => {
    const right = table();
    right.do(as("a"), { type: "accuse", target: "c" });
    right.do(as("b"), { type: "vote", yes: true });
    right.do(as("d"), { type: "vote", yes: false });
    expect(right.state.result).toMatchObject({ winner: "team", how: "accused", by: "a" });
    expect([right.points("a"), right.points("b"), right.points("c"), right.points("d")]).toEqual([2, 1, 0, 1]);
    expect(right.view("b").reveal).toMatchObject({ spy: "c", place: "医院" });

    const wrong = table();
    wrong.do(as("a"), { type: "accuse", target: "b" });
    wrong.do(as("c"), { type: "vote", yes: true });
    wrong.do(as("d"), { type: "vote", yes: true });
    expect(wrong.state.result).toMatchObject({ winner: "spy", how: "wrong-accused" });
    expect(wrong.points("c")).toBe(3);
  });

  it("lets only the outsider guess the place, winning or losing the round on it", () => {
    const t = table();
    expect(t.rejects(as("a"), { type: "guess", place: "医院" })).toBe(true);
    expect(t.rejects(as("c"), { type: "guess", place: "月球背面" })).toBe(true);
    t.do(as("c"), { type: "guess", place: "学校" });
    expect([t.state.result?.winner, t.points("a"), t.points("c")]).toEqual(["team", 1, 0]);
    const lucky = table();
    lucky.do(as("c"), { type: "guess", place: "医院" });
    expect([lucky.state.result?.how, lucky.points("c")]).toEqual(["guessed", 3]);
  });

  it("ends the talk with everyone naming a suspect; a tie lets the outsider off", () => {
    const t = table();
    t.timeout();
    expect(t.state.phase).toBe("final");
    t.do(as("a"), { type: "final", target: "c" });
    expect(t.view("b").finalVoted).toEqual(["a"]);
    t.do(as("b"), { type: "final", target: "c" });
    t.do(as("c"), { type: "final", target: "a" });
    t.do(as("d"), { type: "final", target: "a" });
    expect(t.state.result).toMatchObject({ winner: "spy", how: "final-miss" });

    const caught = table({ rounds: 1 });
    caught.do(host, { type: "endTalk" });
    for (const [p, target] of [
      ["a", "c"],
      ["b", "c"],
      ["c", "a"],
      ["d", "c"],
    ] as const) {
      caught.do(as(p, p === "a"), { type: "final", target });
    }
    expect(caught.state.result).toMatchObject({ winner: "team", how: "final" });
    caught.do(host, { type: "next" });
    expect(caught.finished).toBe(true);
  });
});
