import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { DISH_KINDS, type DishState, dishGame as game } from "./game.ts";

function table(hands: Record<string, string[]>, config: Record<string, number> = {}) {
  const t = new Table(game, makeCtx(Object.keys(hands), [], Math.random), config);
  Object.assign(t.state as DishState, { hands: structuredClone(hands), current: "a" });
  return t;
}
const three = () => table({ a: ["香菜", "榴莲"], b: ["苦瓜", "皮蛋"], c: ["芥末", "芥末"] });

describe("dish", () => {
  it("deals all 64 cards", () => {
    const s = new Table(game, makeCtx(["a", "b", "c"], [], Math.random)).state as DishState;
    expect(Object.values(s.hands).reduce((n, h) => n + h.length, 0)).toBe(64);
    expect(Object.values(s.hands).map((h) => h.length)).toEqual([22, 21, 21]);
    expect(DISH_KINDS.length).toBe(8);
  });

  it("shows the passed card only to those who have looked at it", () => {
    const t = three();
    expect(t.rejects(as("b"), { type: "offer", kind: "苦瓜", target: "a", claim: "苦瓜" })).toBe(true);
    expect(t.rejects(as("a"), { type: "offer", kind: "皮蛋", target: "b", claim: "皮蛋" })).toBe(true);
    t.do(as("a"), { type: "offer", kind: "榴莲", target: "b", claim: "香菜" });
    expect([t.view("a").pass?.card, t.view("b").pass?.card, t.view("c").pass?.card]).toEqual(["榴莲", null, null]);
    expect(t.wire("b")).not.toContain('"card":"榴莲"');
    expect(t.wire("b")).not.toContain('["芥末","芥末"]');
    expect(t.wire("b")).not.toContain('"hands"');
    expect(t.view("b").handCounts).toEqual({ a: 1, b: 2, c: 2 });
  });

  it("a right call sends the card back to the liar; a wrong call keeps it", () => {
    const right = three();
    right.do(as("a"), { type: "offer", kind: "榴莲", target: "b", claim: "香菜" });
    right.do(as("b"), { type: "call", truth: false });
    expect([right.state.table.a, right.state.current, right.state.last?.taker]).toEqual([{ 榴莲: 1 }, "a", "a"]);

    const wrong = three();
    wrong.do(as("a"), { type: "offer", kind: "榴莲", target: "b", claim: "香菜" });
    wrong.do(as("b"), { type: "call", truth: true });
    expect([wrong.state.table.b, wrong.state.current]).toEqual([{ 榴莲: 1 }, "b"]);
  });

  it("peeking commits to passing on, only to someone who has not seen the card", () => {
    const t = three();
    t.do(as("a"), { type: "offer", kind: "榴莲", target: "b", claim: "香菜" });
    t.do(as("b"), { type: "peek" });
    expect([t.state.phase, t.view("b").pass?.card]).toEqual(["relay", "榴莲"]);
    expect(t.rejects(as("b"), { type: "call", truth: true })).toBe(true);
    expect(t.rejects(as("b"), { type: "relay", target: "a", claim: "榴莲" })).toBe(true);
    t.do(as("b"), { type: "relay", target: "c", claim: "榴莲" });
    expect(t.state.pass).toMatchObject({ sender: "b", holder: "c", claim: "榴莲", seen: ["a", "b"] });
    // Everyone else has seen it: c can only call.
    expect(t.rejects(as("c"), { type: "peek" })).toBe(true);
    t.do(as("c"), { type: "call", truth: false });
    // b told the truth, c called it a lie: c keeps the card.
    expect([t.state.table.c, t.state.current]).toEqual([{ 榴莲: 1 }, "c"]);
  });

  it("four of a kind loses, and so does having to start with an empty hand", () => {
    const four = three();
    (four.state as DishState).table.b = { 榴莲: 3 };
    four.do(as("a"), { type: "offer", kind: "榴莲", target: "b", claim: "榴莲" });
    four.do(as("b"), { type: "call", truth: false });
    expect([four.state.phase, four.state.loser, four.state.lostBy]).toEqual(["gameOver", "b", "four"]);
    expect([four.points("a"), four.points("b"), four.points("c")]).toEqual([1, 0, 1]);
    four.do(host, { type: "next" });
    expect(four.finished).toBe(true);

    const empty = table({ a: ["香菜"], b: ["苦瓜"], c: ["芥末"] });
    empty.do(as("a"), { type: "offer", kind: "香菜", target: "b", claim: "香菜" });
    empty.do(as("b"), { type: "call", truth: true });
    expect([empty.state.loser, empty.state.lostBy]).toEqual(["a", "empty"]);
  });
});
