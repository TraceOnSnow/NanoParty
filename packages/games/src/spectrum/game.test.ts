import type { Actor, ContentItem, GameContext } from "@apr/shared";
import { describe, expect, it } from "vitest";
import { spectrumGame as game, pointsFor, type SpectrumState } from "./game.ts";

const item = (n: number): ContentItem => ({
  id: `s${n}`,
  version: 1,
  type: "spectrum",
  theme: "t",
  payload: { left: `左${n}`, right: `右${n}` },
});

function makeCtx(players: string[], count = 5, rand = 0.5): GameContext {
  const pool = Array.from({ length: count }, (_, i) => item(i + 1));
  return { now: 1000, random: () => rand, players, drawContent: () => pool.shift() ?? null };
}

const as = (playerId: string, isHost = false): Actor => ({ kind: "player", playerId, isHost });
const host = as("a", true);
const cfg = { rounds: 3, clueSeconds: 60, guessSeconds: 30 };

function start(ctx: GameContext, config = cfg): SpectrumState {
  const r = game.setup(config, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
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

  it("ends cleanly when the content runs out", () => {
    const ctx = makeCtx(["a", "b"], 1);
    let s = start(ctx, { rounds: 0, clueSeconds: 0, guessSeconds: 0 });
    s = must(game.apply(s, { type: "clue", round: 1, text: "提示" }, as("a"), ctx)).state;
    s = must(game.apply(s, { type: "guess", round: 1, value: 1 }, as("b"), ctx)).state;
    const end = must(game.apply(s, { type: "next", round: 1 }, host, ctx));
    expect(end.finished).toBe(true);
    expect(end.state.endedBecause).toBe("no-content");
  });
});
