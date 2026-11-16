import { describe, expect, it } from "vitest";
import { as, makeCtx, poolCtx, Table } from "../testkit.ts";
import {
  ALL_CARDS,
  cardOf,
  cardsPerKind,
  describeRule,
  platterGame as game,
  type PlatterRule,
  type PlatterState,
  type PlatterTheme,
  scoreRule,
} from "./game.ts";

const theme: PlatterTheme = { name: "测试", kinds: ["甲", "乙", "丙", "丁", "戊", "己"].map((label) => ({ label })) };
const table = (players = ["a", "b", "c"]) => new Table(game, makeCtx(players, [theme], Math.random));
const firstSlots = (s: PlatterState, n: number) =>
  s.market
    .flatMap((column, col) => column.map((id, row) => (id ? { col, row } : null)))
    .filter((x) => x !== null)
    .slice(0, n);

describe("platter", () => {
  it("has sixty distinct cards, ten of each kind, each describable in the theme's words", () => {
    expect(ALL_CARDS).toHaveLength(60);
    expect(new Set(ALL_CARDS.map((c) => c.id)).size).toBe(60);
    for (let k = 0; k < 6; k++) expect(ALL_CARDS.filter((c) => c.kind === k)).toHaveLength(10);
    for (const c of ALL_CARDS) expect(describeRule(c.rule, theme)).not.toContain("?");
  });

  it("scores every kind of rule against the player's own ingredients", () => {
    const items = { a: [3, 2, 0, 1, 4, 0], b: [1, 2, 0, 0, 5, 1] };
    const score = (rule: PlatterRule, p = "a") => scoreRule(rule, p, items);
    expect(
      score({
        t: "per",
        items: [
          { k: 0, pts: 3 },
          { k: 1, pts: -2 },
        ],
      }),
    ).toBe(5);
    expect(score({ t: "set", kinds: [0, 1], pts: 5 })).toBe(10);
    expect(score({ t: "set", kinds: [0, 1, 2], pts: 8 })).toBe(0);
    expect(score({ t: "multi", k: 4, n: 3, pts: 8 })).toBe(8);
    expect([score({ t: "most", k: 0, pts: 10 }), score({ t: "most", k: 4, pts: 10 })]).toEqual([10, 0]);
    expect(score({ t: "most", k: 1, pts: 10 })).toBe(10); // a tie counts
    expect([score({ t: "fewest", k: 3, pts: 7 }), score({ t: "fewest", k: 3, pts: 7 }, "b")]).toEqual([0, 7]);
    expect([0, 1, 2].map((k) => score({ t: "parity", k, even: 7, odd: 3 }))).toEqual([3, 7, 0]);
    expect([score({ t: "mostTotal", pts: 10 }), score({ t: "fewestTotal", pts: 7 }, "b")]).toEqual([10, 7]);
    expect(score({ t: "missing", pts: 5 })).toBe(10);
    expect(score({ t: "rainbow", pts: 12 })).toBe(0);
    expect(score({ t: "atLeast", n: 2, pts: 3 })).toBe(9);
  });

  it("deals by player count, shows three rules and six ingredients, and hides the rest of the piles", () => {
    const t = table();
    const s = t.state;
    expect(s.piles.flat().length + 6).toBe(cardsPerKind(3) * 6);
    const v = t.view("b");
    expect(v.piles.every((p) => p.top !== null)).toBe(true);
    expect(v.market.flat().every((m) => m !== null)).toBe(true);
    expect(v.theme.name).toBe("测试");
    // Only the top card of each pile is visible; hidden cards never reach a client.
    const wire = t.wire("b");
    for (const pile of s.piles) for (const id of pile.slice(1)) expect(wire).not.toContain(`"${id}"`);
    for (const id of s.market.flat()) expect(wire).not.toContain(`"${id}"`);
  });

  it("takes one rule or exactly two ingredients, in turn, and refills from the pile above", () => {
    const t = table();
    const [a, b] = t.state.players as [string, string];
    expect(t.rejects(as(b), { type: "takeRule", pile: 0 })).toBe(true);
    expect(t.rejects(as(a), { type: "takeItems", slots: firstSlots(t.state, 1) })).toBe(true);
    expect(
      t.rejects(as(a), {
        type: "takeItems",
        slots: [
          { col: 0, row: 0 },
          { col: 0, row: 0 },
        ],
      }),
    ).toBe(true);
    const top = t.state.piles[0]?.[0] as string;
    t.do(as(a), { type: "takeRule", pile: 0 });
    expect(t.state.rules[a]).toEqual([top]);
    expect(t.state.current).toBe(b);
    const before = t.state.piles.flat().length;
    t.do(as(b), {
      type: "takeItems",
      slots: [
        { col: 1, row: 0 },
        { col: 2, row: 1 },
      ],
    });
    expect((t.state.items[b] as number[]).reduce((x, y) => x + y, 0)).toBe(2);
    expect(t.state.market.flat().every((m) => m !== null)).toBe(true);
    expect(t.state.piles.flat().length).toBe(before - 2);
  });

  it("lets the player turn one rule into its ingredient per turn, for good", () => {
    const t = table();
    const [a, b, c] = t.state.players as [string, string, string];
    t.do(as(a), { type: "takeRule", pile: 0 });
    t.do(as(b), { type: "takeRule", pile: 1 });
    t.do(as(c), { type: "takeRule", pile: 2 });
    const mine = t.state.rules[a]?.[0] as string;
    expect(t.rejects(as(a), { type: "flip", cardId: t.state.rules[b]?.[0] })).toBe(true);
    expect(t.view(a).canFlip).toBe(true);
    t.do(as(a), { type: "flip", cardId: mine });
    expect(t.state.rules[a]).toEqual([]);
    expect(t.state.items[a]?.[cardOf(mine).kind]).toBe(1);
    expect(t.state.current).toBe(a); // still has to take
    expect(t.view(a).canFlip).toBe(false);
    t.do(as(a), { type: "takeRule", pile: 0 });
    expect(t.rejects(as(a), { type: "flip", cardId: t.state.rules[a]?.[0] })).toBe(true); // not their turn
  });

  it("plays to the end by timeouts alone, uses every card and awards each player their total", () => {
    for (const players of [
      ["a", "b"],
      ["a", "b", "c", "d", "e", "f"],
    ]) {
      const t = table(players);
      for (let i = 0; i < 200 && !t.finished; i++) t.timeout();
      expect(t.finished).toBe(true);
      const s = t.state;
      expect(s.phase).toBe("finished");
      const held = players.reduce(
        (n, p) => n + (s.rules[p]?.length ?? 0) + (s.items[p] as number[]).reduce((x, y) => x + y, 0),
        0,
      );
      expect(held).toBe(cardsPerKind(players.length) * 6);
      for (const p of players) expect(t.points(p)).toBe(Math.max(0, t.view(p).totals[p] as number));
      expect(s.winners.length).toBeGreaterThan(0);
    }
  });

  it("prefers the theme with the highest weight and falls back to the built-in one", () => {
    const heavy = { ...theme, name: "私货", weight: 10 };
    const items = [theme, heavy].map((payload, i) => ({
      id: `t${i}`,
      version: 1,
      type: "platter-theme",
      theme: "t",
      payload,
    }));
    const t = new Table(game, poolCtx(["a", "b"], items, Math.random));
    expect(t.state.theme.name).toBe("私货");
    expect(new Table(game, makeCtx(["a", "b"], [], Math.random)).state.theme.name).toBe("零食局");
  });
});
