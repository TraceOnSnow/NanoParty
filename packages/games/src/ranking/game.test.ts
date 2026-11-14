import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { rankingGame as game } from "./game.ts";

const scenarios = [
  { text: "说一种食物", low: "最难吃", high: "最好吃" },
  { text: "说一种动物", low: "最不危险", high: "最危险" },
];

function table(players = ["a", "b", "c", "d"]) {
  const t = new Table(game, makeCtx(players, scenarios), { rounds: 2 });
  // Deterministic, distinct numbers that are easy to recognise on the wire.
  t.state.numbers = { b: 2, c: 7, d: 9 };
  return t;
}

describe("ranking", () => {
  it("gives each writer a distinct secret number that nobody else sees", () => {
    const fresh = new Table(game, makeCtx(["a", "b", "c", "d"], scenarios));
    expect(fresh.state.captain).toBe("a");
    expect(new Set(Object.values(fresh.state.numbers)).size).toBe(3);
    expect(fresh.state.numbers.a).toBeUndefined();

    const t = table();
    expect(t.view("b").myNumber).toBe(2);
    expect(t.view("a").myNumber).toBeNull();
    for (const p of ["a", "c", "d"]) expect(JSON.stringify(t.view(p))).not.toContain('"myNumber":2');
    expect(t.rejects(as("a"), { type: "answer", text: "队长不写" })).toBe(true);
    expect(t.rejects(as("b"), { type: "answer", text: "大概 2 分吧" })).toBe(true);
    t.do(as("b"), { type: "answer", text: "水煮西兰花" });
    expect(t.wire("c")).not.toContain("西兰花");
  });

  it("opens the answers to the captain without numbers; a perfect order pays the whole team", () => {
    const t = table();
    t.do(as("b"), { type: "answer", text: "水煮西兰花" });
    t.do(as("c"), { type: "answer", text: "红烧肉" });
    t.do(as("d"), { type: "answer", text: "妈妈做的饺子" });
    expect(t.state.phase).toBe("order");
    const captainView = t.view("a");
    expect(captainView.answers).toHaveLength(3);
    expect(captainView.reveal).toBeNull();
    expect(JSON.stringify(captainView)).not.toMatch(/numbers|"myNumber":\d/);

    expect(t.rejects(as("b"), { type: "order", order: ["b", "c", "d"] })).toBe(true);
    expect(t.rejects(as("a"), { type: "order", order: ["b", "c"] })).toBe(true);
    expect(t.rejects(as("a"), { type: "order", order: ["b", "b", "c"] })).toBe(true);
    t.do(as("a"), { type: "order", order: ["b", "c", "d"] });
    expect(t.view("b").reveal).toMatchObject({ slips: 0, points: 3, numbers: { b: 2, c: 7, d: 9 } });
    expect(["a", "b", "c", "d"].map((p) => t.points(p))).toEqual([3, 3, 3, 3]);
  });

  it("pays less for one swapped pair and nothing beyond that; rotates the captain", () => {
    const one = table();
    for (const p of ["b", "c", "d"]) one.do(as(p), { type: "answer", text: `${p}答` });
    one.do(as("a"), { type: "order", order: ["c", "b", "d"] });
    expect([one.state.slips, one.points("a"), one.points("d")]).toEqual([1, 1, 1]);

    const bad = table();
    for (const p of ["b", "c", "d"]) bad.do(as(p), { type: "answer", text: `${p}答` });
    bad.do(as("a"), { type: "order", order: ["d", "c", "b"] });
    expect([bad.state.slips, bad.scores]).toEqual([3, []]);
    bad.do(host, { type: "advance" });
    expect([bad.state.round, bad.state.captain]).toEqual([2, "b"]);
    bad.timeout(); // nobody wrote: nothing to order, nothing scored
    expect(bad.state.phase).toBe("reveal");
    bad.do(host, { type: "advance" });
    expect(bad.finished).toBe(true);
  });
});
