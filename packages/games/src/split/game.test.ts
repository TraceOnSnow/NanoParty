import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { splitGame as game, splitContentSchema, splitPoints } from "./game.ts";

const prompts = [{ text: "按下按钮得一百万，但____。你按吗？", yes: "按", no: "不按" }, { text: "第二题____？" }];
const table = () => new Table(game, makeCtx(["a", "b", "c", "d"], prompts), { rounds: 1 });

describe("split", () => {
  it("validates prompts and scores evenness", () => {
    expect(splitContentSchema.safeParse({ text: "没有空格" }).success).toBe(false);
    expect(splitContentSchema.safeParse({ text: "两个____空____格" }).success).toBe(false);
    expect(splitContentSchema.parse({ text: "一个____空" })).toMatchObject({ yes: "愿意", no: "不愿意" });
    expect([splitPoints(2, 1), splitPoints(3, 0), splitPoints(2, 2), splitPoints(0, 0)]).toEqual([2, 0, 4, 0]);
  });

  it("hides fills until everyone is in, then requires an answer on every other version", () => {
    const t = table();
    t.do(as("a"), { type: "fill", text: "要先跳一次伞" });
    expect(t.wire("b")).not.toContain("跳一次伞");
    for (const p of ["b", "c", "d"]) t.do(as(p), { type: "fill", text: `${p}的代价` });
    expect(t.state.phase).toBe("vote");
    expect(t.view("b").versions).toHaveLength(4);
    expect(t.rejects(as("a"), { type: "vote", answers: { b: true, c: true } })).toBe(true);
    expect(t.rejects(as("a"), { type: "vote", answers: { a: true, b: true, c: true } })).toBe(true);
    t.do(as("a"), { type: "vote", answers: { b: true, c: true, d: false } });
    expect(t.view("b").myVotes).toBeNull();
    expect(t.wire("b")).not.toContain('"yes":["a"]');
  });

  it("pays each author by how evenly the others split on their version", () => {
    const t = table();
    for (const p of ["a", "b", "c", "d"]) t.do(as(p), { type: "fill", text: `${p}版` });
    t.do(as("a"), { type: "vote", answers: { b: true, c: true, d: true } });
    t.do(as("b"), { type: "vote", answers: { a: true, c: false, d: true } });
    t.do(as("c"), { type: "vote", answers: { a: false, b: true, d: true } });
    t.do(as("d"), { type: "vote", answers: { a: false, b: true, c: true } });
    expect(t.state.phase).toBe("reveal");
    // a: yes b / no c,d -> 3-1 = 2; b: all yes -> 0; c: yes a,d / no b -> 2; d: all yes -> 0
    expect(["a", "b", "c", "d"].map((p) => t.points(p))).toEqual([2, 0, 2, 0]);
    t.do(host, { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
