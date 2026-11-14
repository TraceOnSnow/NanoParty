import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { quipGame as game } from "./game.ts";

const prompts = [{ text: "最没用的超能力？" }, { text: "最糟的礼物？" }];

describe("quip", () => {
  it("hides answers while writing and authorship while voting", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], prompts));
    t.do(as("a"), { type: "answer", text: "隐形但只在没人看时" });
    expect(t.wire("b")).not.toContain("隐形");
    expect(t.view("a").myAnswer).toBe("隐形但只在没人看时");
    t.do(as("b"), { type: "answer", text: "会飞一厘米" });
    t.do(as("c"), { type: "answer", text: "预知昨天" });
    expect(t.state.phase).toBe("vote");
    const view = t.view("c");
    expect(view.options?.map((o) => o.text).sort()).toEqual(["会飞一厘米", "隐形但只在没人看时", "预知昨天"].sort());
    // The voting view names no authors: only "is this one mine".
    expect(view.options?.filter((o) => o.mine)).toHaveLength(1);
    expect(JSON.stringify(view.options)).not.toMatch(/"a"|"b"/);
    expect(view.reveal).toBeNull();
  });

  it("forbids voting for yourself; one point per vote plus a bonus for the favourite", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], prompts));
    for (const p of ["a", "b", "c"]) t.do(as(p), { type: "answer", text: `${p}的回答` });
    const indexOf = (author: string) => t.state.order.indexOf(author);
    expect(t.rejects(as("a"), { type: "vote", index: indexOf("a") })).toBe(true);
    expect(t.rejects(as("a"), { type: "vote", index: 9 })).toBe(true);
    t.do(as("a"), { type: "vote", index: indexOf("b") });
    expect(t.rejects(as("a"), { type: "vote", index: indexOf("c") })).toBe(true);
    t.do(as("b"), { type: "vote", index: indexOf("a") });
    t.do(as("c"), { type: "vote", index: indexOf("b") });
    expect(t.state.phase).toBe("reveal");
    expect([t.points("a"), t.points("b"), t.points("c")]).toEqual([1, 3, 0]);
    expect(t.view("a").reveal?.[0]).toMatchObject({ playerId: "b", voters: ["a", "c"], points: 3 });
  });

  it("skips voting when there is nothing to choose between, and ends after the rounds", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], prompts), { rounds: 1 });
    t.do(as("a"), { type: "answer", text: "只有我写了" });
    expect(t.rejects(as("b"), { type: "advance" })).toBe(true);
    t.do(host, { type: "advance" });
    expect(t.state.phase).toBe("reveal");
    expect(t.scores).toEqual([]);
    t.do(host, { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
