import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { type EchoState, echoGame as game } from "./game.ts";

const TOPICS = [{ name: "水果园" }, { name: "动物园" }, { name: "城市园" }, { name: "颜色园" }];
const six = (...first: string[]) => [...first, "u1", "u2", "u3", "u4", "u5", "u6"].slice(0, 6);
const uniq = (who: string, ...first: string[]) => six(...first).map((t) => (t.startsWith("u") ? `${who}-${t}` : t));

/** Three players with written answers; `a` is the host and the first picker, so `b` moves first. */
function table(answers: Record<string, string[]>, config: Record<string, number> = {}) {
  const t = new Table(game, makeCtx(["a", "b", "c"], structuredClone(TOPICS)), config);
  for (const [p, list] of Object.entries(answers)) t.do(as(p, p === "a"), { type: "write", answers: list });
  return t;
}
const standard = () =>
  table({
    a: uniq("a", "苹果", "香蕉", "西瓜"),
    b: uniq("b", "苹果", "葡萄", "番茄"),
    c: uniq("c", "香蕉", "西红柿"),
  });

describe("echo", () => {
  it("picks a topic, then waits until everyone has written six different answers", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], structuredClone(TOPICS)));
    expect([t.state.phase, t.state.category.name, t.state.setter]).toEqual(["write", "水果园", "a"]);
    expect(t.rejects(as("a"), { type: "write", answers: ["苹果", "苹 果", "c", "d", "e", "f"] })).toBe(true);
    expect(t.rejects(as("a"), { type: "write", answers: ["a", "b", "c"] })).toBe(true);
    t.do(as("a"), { type: "write", answers: uniq("a", "苹果") });
    expect([t.state.phase, t.view("b").written]).toEqual(["write", ["a"]]);
    expect(t.rejects(as("b"), { type: "begin" })).toBe(true);
    t.do(as("b"), { type: "write", answers: uniq("b", "苹果") });
    t.do(as("c"), { type: "write", answers: uniq("c", "梨") });
    expect([t.state.phase, t.state.current]).toEqual(["play", "b"]);
  });

  it("keeps hidden answers away from the other players", () => {
    const t = standard();
    const wire = t.wire("a");
    expect(wire).toContain("香蕉");
    expect(wire).not.toContain("葡萄");
    expect(wire).not.toContain("西红柿");
    expect(t.view("a").hiddenCount).toEqual({ a: 6, b: 6, c: 6 });
    expect(t.view("c").myAnswers?.[1]?.text).toBe("西红柿");
  });

  it("a matched answer wins the pot when the table moves on; an unmatched one pays into it", () => {
    const t = standard();
    expect(t.rejects(as("a"), { type: "play", index: 0 })).toBe(true);
    t.do(as("b"), { type: "play", index: 0 });
    expect(t.state.open).toMatchObject({ by: "b", text: "苹果", joined: [{ player: "a", exact: true }] });
    expect([t.view("c").shown.a, t.view("c").hiddenCount.a, t.state.current]).toEqual([["苹果"], 5, "c"]);
    expect(t.state.money.b).toBe(150);
    // The next player's move settles it: b takes the 30 and the pot is refilled.
    t.do(as("c"), { type: "play", index: 2 });
    expect([t.state.money.b, t.state.pot, t.state.groups, t.state.last?.kind]).toEqual([180, 30, 1, "match"]);
    t.do(as("a"), { type: "play", index: 2 });
    expect([t.state.money.c, t.state.pot, t.state.last?.kind]).toEqual([140, 40, "miss"]);
  });

  it("lets a player claim a same-meaning answer, and the host overrule it or call the answer off-topic", () => {
    const t = standard();
    t.do(as("b"), { type: "play", index: 2 });
    expect(t.state.open?.joined).toEqual([]);
    expect(t.rejects(as("b"), { type: "join", index: 1 })).toBe(true);
    t.do(as("c"), { type: "join", index: 1 });
    expect(t.state.open?.joined).toEqual([{ player: "c", text: "西红柿", exact: false }]);
    expect(t.rejects(as("c"), { type: "reject", player: "c" })).toBe(true);
    t.do(host, { type: "reject", player: "c" });
    expect([t.state.open?.joined, t.view("a").shown.c]).toEqual([[], ["西红柿"]]);
    t.do(host, { type: "invalid" });
    t.do(as("c"), { type: "play", index: 0 });
    expect([t.state.money.b, t.state.last?.kind]).toEqual([130, "invalid"]);
  });

  it("takes a bet instead of a play, with limits per number and per player", () => {
    const t = standard();
    t.do(as("b"), { type: "bet", number: 1 });
    expect([t.state.money.b, t.state.pot, t.state.current]).toEqual([140, 40, "c"]);
    t.do(as("c"), { type: "bet", number: 1 });
    expect(t.rejects(as("a"), { type: "bet", number: 1 })).toBe(true);
    expect(t.rejects(as("a"), { type: "bet", number: 13 })).toBe(true);
  });

  it("ends the round when someone has shown everything and pays those who bet right", () => {
    const t = standard();
    t.do(as("b"), { type: "bet", number: 1 });
    t.do(as("c"), { type: "bet", number: 0 });
    t.do(as("a"), { type: "play", index: 0 });
    const s = t.state as EchoState;
    // Leave b with one hidden answer and let b play it.
    for (const answer of (s.answers.b ?? []).slice(1, 5)) answer.shown = true;
    expect(t.rejects(as("b"), { type: "settle" })).toBe(true);
    t.do(as("b"), { type: "play", index: 5 });
    expect(t.state.phase).toBe("lastCall");
    expect(t.rejects(as("c"), { type: "settle" })).toBe(true);
    t.do(as("b"), { type: "settle" });
    // a's 苹果 matched b: a took 50 (30 + two bets), one group. b's last answer missed: −10.
    expect([t.state.phase, t.state.groups, t.state.money.a]).toEqual(["roundOver", 1, 200]);
    // Pool: refilled 30 + b's 10 fine + this round's 30 bonus = 70, all to b who bet on 1.
    expect(t.state.payout).toEqual({ winners: ["b"], share: 70, pool: 70 });
    expect([t.state.money.b, t.state.pot]).toEqual([150 - 10 - 10 + 70, 30]);
    expect(t.view("a").shown.c?.length).toBe(6);
  });

  it("carries the prize over when nobody bet right, and the richest player wins after the last round", () => {
    const t = table({ a: uniq("a", "苹果"), b: uniq("b", "苹果"), c: uniq("c", "梨") }, { rounds: 1 });
    const s = t.state as EchoState;
    for (const answer of (s.answers.b ?? []).slice(1)) answer.shown = true;
    t.do(as("b"), { type: "play", index: 0 });
    t.do(host, { type: "settle" });
    expect([t.state.payout?.winners, t.state.pot, t.state.money.b]).toEqual([[], 60, 180]);
    t.do(host, { type: "next" });
    expect([t.finished, t.state.winners]).toEqual([true, ["b"]]);
    expect(t.points("b")).toBe(3);
  });

  it("starts without the players who never handed in answers when the host says so", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], structuredClone(TOPICS)));
    t.do(as("a"), { type: "write", answers: uniq("a", "苹果") });
    expect(t.rejects(host, { type: "begin" })).toBe(true);
    t.do(as("b"), { type: "write", answers: uniq("b", "苹果") });
    t.do(host, { type: "begin" });
    expect([t.state.phase, t.state.current, t.view("c").myAnswers]).toEqual(["play", "b", null]);
    t.do(as("b"), { type: "play", index: 1 });
    expect(t.state.current).toBe("a");
  });
});
