import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { soupGame as game } from "./game.ts";

const puzzles = [1, 2, 3].map((n) => ({ surface: `汤面${n}`, solution: `秘密汤底${n}` }));
const table = () => new Table(game, makeCtx(["a", "b", "c"], puzzles), { rounds: 2 });

describe("soup", () => {
  it("shows the solution only to the soup master until the reveal", () => {
    const t = table();
    expect(t.state.master).toBe("a");
    expect(t.view("a").solution).toBe("秘密汤底1");
    for (const p of ["b", "c", "zz"]) expect(t.wire(p)).not.toContain("秘密汤底");
    // During the pick the candidates show surfaces only, even to the master.
    const fresh = new Table(game, makeCtx(["a", "b", "c"], puzzles), {}, false);
    expect(JSON.stringify(fresh.view("a"))).not.toContain("秘密汤底");
  });

  it("lets players ask one at a time and only the master answer", () => {
    const t = table();
    t.do(as("b"), { type: "ask", text: "他认识厨师吗？" });
    expect(t.rejects(as("b"), { type: "ask", text: "再问一个" })).toBe(true);
    expect(t.rejects(as("a"), { type: "ask", text: "汤主自己问" })).toBe(true);
    expect(t.rejects(as("c"), { type: "answer", id: 1, verdict: "yes" })).toBe(true);
    t.do(as("a"), { type: "answer", id: 1, verdict: "irrelevant" });
    expect(t.rejects(as("a"), { type: "answer", id: 1, verdict: "yes" })).toBe(true);
    t.do(as("b"), { type: "ask", text: "和过去有关吗？" });
    expect(t.view("c").log.map((e) => e.verdict)).toEqual(["irrelevant", null]);
  });

  it("scores the solver and the master when an attempt is judged correct", () => {
    const t = table();
    t.do(as("c"), { type: "solve", text: "我猜是……" });
    expect(t.rejects(as("a"), { type: "answer", id: 1, verdict: "yes" })).toBe(true);
    t.do(as("a"), { type: "judge", id: 1, correct: false });
    t.do(as("c"), { type: "solve", text: "完整推理" });
    t.do(as("a"), { type: "judge", id: 2, correct: true });
    expect(t.state.phase).toBe("reveal");
    expect([t.points("a"), t.points("b"), t.points("c")]).toEqual([1, 0, 3]);
    expect(t.view("b").solution).toBe("秘密汤底1");
  });

  it("reveals with no points on give-up or timeout, and rotates the soup master", () => {
    const t = table();
    expect(t.rejects(as("b"), { type: "reveal" })).toBe(true);
    t.do(as("a"), { type: "reveal" });
    expect(t.scores).toEqual([]);
    t.do(host, { type: "next" });
    expect([t.state.round, t.state.master]).toEqual([2, "b"]);
    t.timeout();
    expect(t.state.phase).toBe("reveal");
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
