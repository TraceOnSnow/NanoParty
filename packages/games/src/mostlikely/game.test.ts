import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { mostLikelyGame as game } from "./game.ts";

const prompts = [{ text: "谁最可能迟到？" }, { text: "谁最可能赖床？" }];

describe("mostlikely", () => {
  it("needs three players", () => {
    expect(game.setup(game.configSchema.parse({}), makeCtx(["a", "b"], prompts)).ok).toBe(false);
  });

  it("keeps votes secret until all are in, then rewards voting with the crowd", () => {
    const t = new Table(game, makeCtx(["a", "b", "c", "d"], prompts), { rounds: 2 });
    t.do(as("a"), { type: "vote", target: "d" });
    expect(t.view("b").reveal).toBeNull();
    expect(t.view("b").submitted).toEqual(["a"]);
    expect(t.view("b").myVote).toBeNull();
    expect(t.rejects(as("a"), { type: "vote", target: "b" })).toBe(true);
    expect(t.rejects(as("b"), { type: "vote", target: "nobody" })).toBe(true);
    expect(t.rejects(as("z"), { type: "vote", target: "a" })).toBe(true);
    t.do(as("b"), { type: "vote", target: "d" });
    t.do(as("c"), { type: "vote", target: "a" });
    t.do(as("d"), { type: "vote", target: "d" }); // voting for yourself is allowed
    expect(t.state.phase).toBe("reveal");
    expect(t.view("c").reveal).toEqual({ votes: { a: "d", b: "d", c: "a", d: "d" }, top: ["d"] });
    expect([t.points("a"), t.points("b"), t.points("c"), t.points("d")]).toEqual([1, 1, 0, 1]);
  });

  it("binds actions to the step, lets the host reveal early, and finishes after the last round", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], prompts), { rounds: 2 });
    const stale = t.state.step;
    expect(t.rejects(as("b"), { type: "reveal" })).toBe(true);
    t.do(host, { type: "reveal" });
    expect(t.scores).toEqual([]);
    expect(t.rejects(as("b"), { type: "vote", step: stale, target: "a" })).toBe(true);
    expect(t.rejects(as("b"), { type: "next" })).toBe(true);
    t.do(host, { type: "next" });
    expect(t.state.round).toBe(2);
    t.timeout();
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
