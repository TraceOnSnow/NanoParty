/** The topic-pick phase, checked the same way for every game that has one. */
import type { ContentItem, GameModule } from "@apr/shared";
import { describe, expect, it } from "vitest";
import { bluffGame } from "./bluff/game.ts";
import { categoriesGame } from "./categories/game.ts";
import { mostLikelyGame } from "./mostlikely/game.ts";
import { oneClueGame } from "./oneclue/game.ts";
import { quipGame } from "./quip/game.ts";
import { rankingGame } from "./ranking/game.ts";
import { as, host, makeCtx, Table } from "./testkit.ts";
import { wagerGame } from "./wager/game.ts";

interface Case {
  // biome-ignore lint/suspicious/noExplicitAny: each game has its own generics
  game: GameModule<any, any, any, any>;
  item: (n: number) => Record<string, unknown>;
  /** Player-written payload, or null when the game does not allow it. */
  custom: Record<string, string> | null;
  /** Text that must never reach players during the pick (e.g. answers). */
  secret?: (n: number) => string;
}

const cases: Case[] = [
  { game: quipGame, item: (n) => ({ text: `脑洞题${n}` }), custom: { text: "自拟的脑洞题" } },
  { game: mostLikelyGame, item: (n) => ({ text: `谁最可能${n}` }), custom: { text: "谁最可能自拟" } },
  { game: categoriesGame, item: (n) => ({ name: `类别${n}园` }), custom: { name: "自拟园" } },
  {
    game: rankingGame,
    item: (n) => ({ text: `情境${n}`, low: "低", high: "高" }),
    custom: { text: "自拟情境", low: "最小", high: "最大" },
  },
  { game: oneClueGame, item: (n) => ({ word: `词语${n}` }), custom: { word: "自拟词" } },
  {
    game: bluffGame,
    item: (n) => ({ text: `事实${n}____`, answer: `真答案${n}` }),
    custom: null,
    secret: (n) => `真答案${n}`,
  },
  {
    game: wagerGame,
    item: (n) => ({ text: `数字题${n}`, unit: "个", answer: 7770 + n }),
    custom: null,
    secret: (n) => `${7770 + n}`,
  },
];

const players = ["a", "b", "c", "d"];
const table = (c: Case, count = 7) =>
  new Table(
    c.game,
    makeCtx(
      players,
      Array.from({ length: count }, (_, i) => c.item(i + 1)),
    ),
    { rounds: 3 },
    false,
  );
const pickerOf = (t: Table<{ step: number }>) => (t.state as unknown as { pick: { picker: string } }).pick.picker;
// biome-ignore lint/suspicious/noExplicitAny: game views are game-specific
const pickView = (t: Table<{ step: number }>, p: string) => (t.view(p) as any).pick;

describe.each(cases)("topic pick: $game.meta.name", (c) => {
  it("starts each round with a pick that only the picker controls and that is not yet a started round", () => {
    const t = table(c);
    const picker = pickerOf(t);
    expect((t.state as unknown as { phase: string }).phase).toBe("pick");
    const other = players.find((p) => p !== picker && pickView(t, p)?.candidates !== null) as string;
    expect(pickView(t, other).candidates).toHaveLength(3);
    expect(t.rejects(as(other), { type: "choose", index: 0 })).toBe(true);
    expect(t.rejects(as(other), { type: "refresh" })).toBe(true);
    expect(t.game.skip?.key(t.state)).toBeNull();
    expect(t.game.currentContentId?.(t.state)).toBeNull();
    expect(t.game.atSafePoint?.(t.state)).toBe(true);
    expect(t.game.deadline?.(t.state)).toBe(1000 + 60_000);
  });

  it("refreshes without limit, uses up only the confirmed item, and starts the round", () => {
    const t = table(c);
    const picker = pickerOf(t);
    const first = JSON.stringify(pickView(t, picker).candidates);
    t.do(as(picker), { type: "refresh" });
    expect(JSON.stringify(pickView(t, picker).candidates)).not.toBe(first);
    for (let i = 0; i < 5; i++) t.do(as(picker), { type: "refresh" });
    expect(t.ctx.peekContent(99)).toHaveLength(7);
    const chosen = pickView(t, picker).candidates[1];
    t.do(as(picker), { type: "choose", index: 1 });
    expect((t.state as unknown as { phase: string }).phase).not.toBe("pick");
    expect(t.ctx.peekContent(99)).toHaveLength(6);
    expect(JSON.stringify(t.view(picker))).toContain(chosen.split("（")[0]);
    expect(t.game.skip?.key(t.state)).not.toBeNull();
    expect(t.rejects(as(picker), { type: "refresh" })).toBe(true);
  });

  it(
    c.custom ? "accepts a player-written topic and reports it as contributed" : "does not allow player-written topics",
    () => {
      const t = table(c);
      const picker = pickerOf(t);
      if (!c.custom) {
        expect(t.rejects(as(picker), { type: "custom", payload: { text: "我自己出", answer: "1" } })).toBe(true);
        return;
      }
      expect(t.rejects(as(picker), { type: "custom", payload: { nope: "x" } })).toBe(true);
      const r = t.do(as(picker), { type: "custom", payload: c.custom });
      expect(r.contributed).toEqual([
        { type: c.game.meta.contentType, theme: "玩家自拟", payload: c.custom, authorId: picker },
      ]);
      expect(t.game.currentContentId?.(t.state)).toBeNull();
      expect(t.ctx.peekContent(99)).toHaveLength(7);
    },
  );

  it("never shows secrets during the pick", () => {
    const t = table(c);
    for (const p of [...players, "late-joiner"]) {
      const wire = t.wire(p);
      for (let n = 1; n <= 7; n++) if (c.secret) expect(wire).not.toContain(c.secret(n));
    }
  });

  it("takes outside offers only while picking; times out to the first candidate", () => {
    const t = table(c);
    const offered: ContentItem[] = [
      { id: "ai1", version: 1, type: "x", theme: "主题", payload: c.item(91) },
      { id: "bad", version: 1, type: "x", theme: "主题", payload: { nonsense: true } },
    ];
    expect(t.game.offer?.(structuredClone(t.state), [offered[1] as ContentItem], t.ctx).ok).toBe(false);
    const now = t.game.offer?.(t.state, offered, t.ctx);
    if (!now?.ok) throw new Error("offer failed");
    t.state = now.state;
    const picker = pickerOf(t);
    expect(pickView(t, picker).candidates).toHaveLength(1);

    t.timeout();
    expect((t.state as unknown as { phase: string }).phase).not.toBe("pick");
    // A confirmed topic is never replaced by a late offer (the runtime keeps it in the history).
    expect(t.game.offer?.(structuredClone(t.state), offered, t.ctx).ok).toBe(false);
  });

  it("lets a later picker take an earlier candidate from the party history", () => {
    const t = table(c);
    const record = (id: string, status: "shown" | "used" = "shown") => ({
      item: { id, version: 1, type: "x", theme: "主题", payload: c.item(id === "h1" ? 95 : 96) },
      status,
      // Written by the AI and not yet seen by anyone: usable even where candidates are a secret.
      seenBy: [] as string[],
      origin: "ai" as const,
    });
    t.ctx.history.push(record("h1"), record("h2", "used"));
    const picker = pickerOf(t);
    const other = ["a", "b", "c", "d"].find((p) => p !== picker) as string;
    t.do(as(picker), { type: "history" });
    const history = pickView(t, picker).history ?? [];
    expect(
      history.map((h: { contentId: string; status: string; origin: string }) => [h.contentId, h.status, h.origin]),
    ).toEqual([
      ["h1", "shown", "ai"],
      ["h2", "used", "ai"],
    ]);
    expect(t.rejects(as(other), { type: "chooseHistory", contentId: "h1" })).toBe(true);
    expect(t.rejects(as(picker), { type: "chooseHistory", contentId: "nope" })).toBe(true);
    t.do(as(picker), { type: "chooseHistory", contentId: "h1" });
    expect((t.state as unknown as { phase: string }).phase).not.toBe("pick");
  });

  it("hands the pick to someone else next round", () => {
    const t = table(c);
    const first = pickerOf(t);
    t.do(as(first), { type: "choose", index: 0 });
    const skipped = t.game.skip?.apply(structuredClone(t.state), t.ctx);
    if (!skipped?.ok) throw new Error("skip failed");
    t.state = skipped.state;
    expect(pickerOf(t)).not.toBe(first);
    expect(t.rejects(host, { type: "advance" })).toBe(true);
  });
});

describe("topic pick: game-specific roles", () => {
  it("ranking: the captain picks", () => {
    const t = table(cases[3] as Case);
    const s = t.state as unknown as { captain: string; pick: { picker: string } };
    expect(s.pick.picker).toBe(s.captain);
  });

  it("oneclue: the guesser neither picks nor sees the candidate words", () => {
    const t = table(cases[4] as Case);
    const s = t.state as unknown as { guesser: string; pick: { picker: string } };
    expect(s.pick.picker).not.toBe(s.guesser);
    expect(pickView(t, s.guesser).candidates).toBeNull();
    expect(t.wire(s.guesser)).not.toMatch(/词语\d/);
    expect(pickView(t, s.pick.picker).candidates).toHaveLength(3);
  });

  it("fact games end when the library has nothing left to pick", () => {
    expect(bluffGame.setup(bluffGame.configSchema.parse({}), makeCtx(players, [])).ok).toBe(false);
    const t = new Table(wagerGame, makeCtx(players, [cases[6]?.item(1)]), { rounds: 0 });
    const skipped = wagerGame.skip?.apply(structuredClone(t.state), t.ctx);
    expect(skipped?.ok && [skipped.finished, skipped.state.endedBecause]).toEqual([true, "no-content"]);
  });

  it("games that allow writing a topic still start with an empty library", () => {
    const t = new Table(quipGame, makeCtx(players, []), {}, false);
    expect(pickView(t, pickerOf(t)).candidates).toEqual([]);
    t.do(as(pickerOf(t)), { type: "custom", payload: { text: "空题库也能玩" } });
    expect(t.state.phase).toBe("write");
  });
});
