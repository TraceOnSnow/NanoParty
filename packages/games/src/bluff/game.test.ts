import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { bluffGame as game } from "./game.ts";

const facts = [
  { text: "章鱼有____颗心脏。", answer: "三" },
  { text: "北极熊皮肤是____色。", answer: "黑" },
];

describe("bluff", () => {
  it("never shows the truth, other lies or authorship before the reveal", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], facts));
    expect(t.wire("a")).not.toContain('"三"');
    expect(t.rejects(as("a"), { type: "lie", text: " 三 " })).toBe(true); // stumbling on the truth
    t.do(as("a"), { type: "lie", text: "八" });
    expect(t.wire("b")).not.toContain("八");
    t.do(as("b"), { type: "lie", text: "两" });
    t.do(as("c"), { type: "lie", text: "八" }); // same fake as a: merged into one option
    expect(t.state.phase).toBe("select");
    const view = t.view("b");
    expect(view.options?.map((o) => o.text).sort()).toEqual(["三", "两", "八"].sort());
    expect(JSON.stringify(view.options)).not.toMatch(/truth|authors/);
    expect(view.reveal).toBeNull();
    expect(game.publicSummary(t.state)).not.toContain("三");
  });

  it("scores picking the truth and fooling others; own lie cannot be picked", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], facts));
    t.do(as("a"), { type: "lie", text: "八" });
    t.do(as("b"), { type: "lie", text: "两" });
    t.do(as("c"), { type: "lie", text: "八" });
    const idx = (text: string) => t.state.options.findIndex((o) => o.text === text);
    expect(t.rejects(as("a"), { type: "pick", index: idx("八") })).toBe(true);
    t.do(as("a"), { type: "pick", index: idx("三") });
    expect(t.rejects(as("a"), { type: "pick", index: idx("两") })).toBe(true);
    t.do(as("b"), { type: "pick", index: idx("八") });
    t.do(as("c"), { type: "pick", index: idx("三") });
    expect(t.state.phase).toBe("reveal");
    // a: truth 2 + b fooled 1; c: truth 2 + b fooled 1 (shared fake); b: nothing.
    expect([t.points("a"), t.points("b"), t.points("c")]).toEqual([3, 0, 3]);
    const truth = t.view("b").reveal?.options.find((o) => o.truth);
    expect(truth).toMatchObject({ text: "三", pickers: ["a", "c"] });
  });

  it("moves on by timeout or host, rejects stale actions, and ends when content runs out", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], facts.slice(0, 1)), { rounds: 0 });
    const writeStep = t.state.step;
    t.do(as("a"), { type: "lie", text: "八" });
    t.timeout();
    expect(t.state.phase).toBe("select");
    expect(t.rejects(as("b"), { type: "lie", step: writeStep, text: "迟到" })).toBe(true);
    t.do(host, { type: "advance" });
    expect(t.state.phase).toBe("reveal");
    t.do(host, { type: "advance" });
    expect(t.finished).toBe(true);
    expect(t.state.endedBecause).toBe("no-content");
  });
});
