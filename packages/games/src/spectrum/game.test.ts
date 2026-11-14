import type { Actor, ContentItem, GameContext } from "@apr/shared";
import { describe, expect, it } from "vitest";
import { poolCtx } from "../testkit.ts";
import { spectrumGame as game, pointsFor, type SpectrumState } from "./game.ts";

const item = (n: number): ContentItem => ({
  id: `s${n}`,
  version: 1,
  type: "spectrum",
  theme: "t",
  payload: { left: `左${n}`, right: `右${n}` },
});

function makeCtx(players: string[], count = 5, rand = 0.5): GameContext {
  return poolCtx(
    players,
    Array.from({ length: count }, (_, i) => item(i + 1)),
    () => rand,
  );
}

const as = (playerId: string, isHost = false): Actor => ({ kind: "player", playerId, isHost });
const host = as("a", true);
const cfg = { rounds: 3, pickSeconds: 45, clueSeconds: 60, guessSeconds: 30 };

/** A fresh game, still in the topic-pick phase. */
function open(ctx: GameContext, config = cfg): SpectrumState {
  const r = game.setup(config, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
/** The clue giver takes the first candidate, which formally starts the round. */
function pick(s: SpectrumState, ctx: GameContext): SpectrumState {
  const r = game.apply(s, { type: "choose", round: s.round, index: 0 }, as(s.giver), ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const start = (ctx: GameContext, config = cfg) => pick(open(ctx, config), ctx);
const must = (r: ReturnType<typeof game.apply>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("spectrum game", () => {
  it("scores by distance bands", () => {
    expect([0, 5, 6, 12, 13, 22, 23].map(pointsFor)).toEqual([4, 4, 3, 3, 2, 2, 0]);
  });

  it("shows the target only to the clue giver until the reveal", () => {
    const ctx = makeCtx(["a", "b", "c"], 5, 0.5); // target = 5 + floor(0.5 * 91) = 50
    let s = start(ctx);
    expect(s.giver).toBe("a");
    expect(s.target).toBe(50);
    expect(game.view(s, "a").target).toBe(50);
    expect(game.view(s, "b").target).toBeNull();
    expect(game.publicSummary(s)).not.toContain("50");

    s = must(game.apply(s, { type: "clue", round: 1, text: "温水" }, as("a"), ctx)).state;
    s = must(game.apply(s, { type: "guess", round: 1, value: 77 }, as("b"), ctx)).state;
    const viewC = game.view(s, "c");
    expect(viewC.target).toBeNull();
    expect(viewC.submitted).toEqual(["b"]);
    expect(JSON.stringify(viewC)).not.toContain("77");
    expect(game.publicSummary(s)).not.toContain("77");
  });

  it("validates who may do what and when", () => {
    const ctx = makeCtx(["a", "b", "c"]);
    const s = start(ctx);
    const clone = () => structuredClone(s);
    expect(game.apply(clone(), { type: "clue", round: 1, text: "x" }, as("b"), ctx).ok).toBe(false);
    expect(game.apply(clone(), { type: "clue", round: 1, text: "大概 70 吧" }, as("a"), ctx).ok).toBe(false);
    expect(game.apply(clone(), { type: "guess", round: 1, value: 10 }, as("b"), ctx).ok).toBe(false);
    const g = must(game.apply(clone(), { type: "clue", round: 1, text: "温水" }, as("a"), ctx)).state;
    expect(game.apply(structuredClone(g), { type: "guess", round: 1, value: 10 }, as("a"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(g), { type: "guess", round: 1, value: 10 }, as("z"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(g), { type: "reveal", round: 1 }, as("b"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(g), { type: "guess", round: 2, value: 10 }, as("b"), ctx).ok).toBe(false);
    const once = must(game.apply(structuredClone(g), { type: "guess", round: 1, value: 10 }, as("b"), ctx)).state;
    expect(game.apply(once, { type: "guess", round: 1, value: 11 }, as("b"), ctx).ok).toBe(false);
  });

  it("settles when all guessers are in: guessers by distance, giver gets the rounded average", () => {
    const ctx = makeCtx(["a", "b", "c"]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "clue", round: 1, text: "温水" }, as("a"), ctx)).state;
    s = must(game.apply(s, { type: "guess", round: 1, value: 52 }, as("b"), ctx)).state; // 4
    const r = must(game.apply(s, { type: "guess", round: 1, value: 80 }, as("c"), ctx)); // 0
    expect(r.state.phase).toBe("reveal");
    expect(r.scores).toEqual([
      { playerId: "b", points: 4, reason: "猜中刻度", key: "r1:guess:b" },
      { playerId: "a", points: 2, reason: "提示有效", key: "r1:giver:a" },
    ]);
    expect(game.view(r.state, "c").target).toBe(50);
    expect(game.view(r.state, "c").reveal?.results.map((x) => x.playerId)).toEqual(["b", "c"]);
  });

  it("rotates the clue giver fairly, lets late joiners in next round, ends after the configured rounds", () => {
    const ctx = makeCtx(["a", "b"]);
    let s = start(ctx);
    const givers = [s.giver];
    for (let round = 1; round <= 3; round++) {
      if (round > 1) s = pick(s, ctx);
      s = must(game.apply(s, { type: "clue", round, text: "提示" }, as(s.giver), ctx)).state;
      s = must(game.apply(s, { type: "reveal", round }, host, ctx)).state;
      if (round === 1) ctx.players = ["a", "b", "c"];
      const next = must(game.apply(s, { type: "next", round }, host, ctx));
      s = next.state;
      if (round < 3) givers.push(s.giver);
      else expect(next.finished).toBe(true);
    }
    expect(givers).toEqual(["a", "b", "c"]);
    expect(s.endedBecause).toBe("rounds");
  });

  it("times out: no clue voids the round, no guesses settles with what arrived; skip never scores", () => {
    const ctx = makeCtx(["a", "b", "c"]);
    const s = start(ctx);
    expect(game.deadline?.(s)).toBe(61_000);
    const voided = game.onTimeout?.(structuredClone(s), ctx);
    expect(voided?.ok && [voided.state.round, voided.state.giver, voided.scores]).toEqual([2, "b", undefined]);

    let g = must(game.apply(structuredClone(s), { type: "clue", round: 1, text: "温水" }, as("a"), ctx)).state;
    expect(game.deadline?.(g)).toBe(31_000);
    g = must(game.apply(g, { type: "guess", round: 1, value: 50 }, as("b"), ctx)).state;
    const skipped = must(game.apply(structuredClone(g), { type: "skip", round: 1 }, host, ctx));
    expect(skipped.scores).toBeUndefined();
    const late = game.onTimeout?.(structuredClone(g), ctx);
    expect(late?.ok && late.state.phase).toBe("reveal");
    expect(late?.ok && late.scores?.map((x) => x.playerId)).toEqual(["b", "a"]);
    const resumed = game.onResume?.(structuredClone(g), { ...ctx, now: 100_000 });
    expect(resumed?.deadlineAt).toBe(130_000);
  });

  it("lets the clue giver choose, refresh without limit, or write a scale before the round starts", () => {
    const ctx = makeCtx(["a", "b"], 7);
    let s = open(ctx);
    expect(s.phase).toBe("pick");
    expect(game.view(s, "b").candidates).toEqual([
      { left: "左1", right: "右1" },
      { left: "左2", right: "右2" },
      { left: "左3", right: "右3" },
    ]);
    // Picking is the giver's call, and it is not a skippable (started) round yet.
    expect(game.apply(structuredClone(s), { type: "choose", round: 1, index: 0 }, as("b"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "refresh", round: 1 }, as("b"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "clue", round: 1, text: "太早" }, as("a"), ctx).ok).toBe(false);
    expect(game.skip?.key(s)).toBeNull();
    expect(game.atSafePoint?.(s)).toBe(true);

    // Refreshing cycles through the pool and comes back around: effectively unlimited.
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = must(game.apply(s, { type: "refresh", round: 1 }, as("a"), ctx)).state;
      seen.push(s.candidates.map((c) => c.left).join(""));
    }
    expect(seen[0]).toBe("左4左5左6");
    expect(new Set(seen).size).toBeGreaterThan(2);
    expect(s.round).toBe(1);

    const chosen = s.candidates[1];
    s = must(game.apply(s, { type: "choose", round: 1, index: 1 }, as("a"), ctx)).state;
    expect([s.phase, s.scale.left]).toEqual(["clue", chosen?.left]);
    expect(game.skip?.key(s)).toBe("r1");
    // Only the confirmed scale left the pool; the ones refreshed away are still available.
    expect(ctx.peekContent(20)).toHaveLength(6);
  });

  it("accepts a player's own scale and reports it as contributed content", () => {
    const ctx = makeCtx(["a", "b"], 0); // empty library: writing your own still works
    const s = open(ctx);
    expect(s.candidates).toEqual([]);
    expect(game.apply(structuredClone(s), { type: "refresh", round: 1 }, as("a"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "custom", round: 1, left: "甜", right: "甜" }, as("a"), ctx).ok).toBe(
      false,
    );
    const r = must(game.apply(s, { type: "custom", round: 1, left: "青铜", right: "王者" }, as("a"), ctx));
    expect([r.state.phase, r.state.scale]).toEqual(["clue", { contentId: null, left: "青铜", right: "王者" }]);
    expect(r.contributed).toEqual([
      { type: "spectrum", theme: "玩家自拟", payload: { left: "青铜", right: "王者" }, authorId: "a" },
    ]);
    expect(game.currentContentId?.(r.state)).toBeNull();
  });

  it("takes outside offers: now if still picking, otherwise at the next pick; picks time out to the first candidate", () => {
    const ctx = makeCtx(["a", "b"], 5);
    const offered = [
      { id: "gen1", version: 1, type: "spectrum", theme: "英雄联盟", payload: { left: "脆皮", right: "坦克" } },
      { id: "bad", version: 1, type: "spectrum", theme: "x", payload: { nope: true } },
    ];
    let s = open(ctx);
    expect(game.offer?.(structuredClone(s), [offered[1] as (typeof offered)[0]], ctx).ok).toBe(false);
    const now = game.offer?.(s, offered, ctx);
    expect(now?.ok && now.state.candidates).toEqual([{ contentId: "gen1", left: "脆皮", right: "坦克" }]);
    s = (now?.ok ? now.state : s) as SpectrumState;

    const timedOut = game.onTimeout?.(structuredClone(s), ctx);
    expect(timedOut?.ok && [timedOut.state.phase, timedOut.state.scale.left]).toEqual(["clue", "脆皮"]);

    // Offered mid-round: kept for the next clue giver.
    s = pick(s, ctx);
    const later = game.offer?.(s, offered, ctx);
    expect(later?.ok && [later.state.candidates, later.state.queued.length, later.message]).toEqual([
      [],
      1,
      expect.stringContaining("下一轮"),
    ]);
    s = (later?.ok ? later.state : s) as SpectrumState;
    s = must(game.apply(s, { type: "skip", round: 1 }, host, ctx)).state;
    expect([s.round, s.phase, s.candidates.map((c) => c.left)]).toEqual([2, "pick", ["脆皮"]]);
  });
});
