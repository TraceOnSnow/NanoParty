import type { Actor, ContentItem, GameContext } from "@apr/shared";
import { describe, expect, it } from "vitest";
import { poolCtx } from "../testkit.ts";
import { type EstimateState, estimateGame as game } from "./game.ts";

const item = (n: number, answer: number): ContentItem => ({
  id: `q${n}`,
  version: 1,
  type: "numeric-fact",
  theme: "t",
  payload: { text: `Q${n}`, unit: "个", answer },
});

function makeCtx(players: string[], items: ContentItem[], now = 1000): GameContext {
  return poolCtx(players, [...items], () => 0.5, now);
}

const host: Actor = { kind: "player", playerId: "a", isHost: true };
const p = (playerId: string): Actor => ({ kind: "player", playerId, isHost: false });

function start(ctx: GameContext, config = { rounds: 2, answerSeconds: 60 }): EstimateState {
  const r = game.setup(config, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function must(r: ReturnType<typeof game.apply>) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("estimate game", () => {
  it("refuses to start without enough players or content", () => {
    expect(game.setup({ rounds: 1, answerSeconds: 0 }, makeCtx(["a"], [item(1, 10)])).ok).toBe(false);
    expect(game.setup({ rounds: 1, answerSeconds: 0 }, makeCtx(["a", "b"], [])).ok).toBe(false);
  });

  it("hides the answer and other players' guesses until reveal", () => {
    const ctx = makeCtx(["a", "b", "c"], [item(1, 777)]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "submit", round: 1, value: 333 }, p("a"), ctx)).state;

    const viewB = game.view(s, "b");
    expect(viewB.reveal).toBeNull();
    expect(viewB.myGuess).toBeNull();
    expect(viewB.submitted).toEqual(["a"]);
    // Nothing in another player's view may contain the answer or a's guess.
    const wire = JSON.stringify(viewB);
    expect(wire).not.toContain("777");
    expect(wire).not.toContain("333");
    expect(game.view(s, "a").myGuess).toBe(333);
    expect(game.publicSummary(s)).not.toContain("777");
  });

  it("settles when everyone has submitted: closest scores, exact gets a bonus, ties share", () => {
    const ctx = makeCtx(["a", "b", "c"], [item(1, 100)]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "submit", round: 1, value: 100 }, p("a"), ctx)).state;
    s = must(game.apply(s, { type: "submit", round: 1, value: 100 }, p("b"), ctx)).state;
    const r = must(game.apply(s, { type: "submit", round: 1, value: 5 }, p("c"), ctx));
    expect(r.state.phase).toBe("reveal");
    expect(r.scores).toEqual([
      { playerId: "a", points: 3, reason: "完全猜中", key: "r1:closest:a" },
      { playerId: "b", points: 3, reason: "完全猜中", key: "r1:closest:b" },
    ]);
    expect(game.view(r.state, "c").reveal?.answer).toBe(100);
  });

  it("rejects double submission, non-participants and wrong-phase actions", () => {
    const ctx = makeCtx(["a", "b"], [item(1, 10)]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "submit", round: 1, value: 1 }, p("a"), ctx)).state;
    expect(game.apply(structuredClone(s), { type: "submit", round: 1, value: 2 }, p("a"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "submit", round: 1, value: 2 }, p("z"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "next", round: 1 }, host, ctx).ok).toBe(false);
  });

  it("binds actions to their round: stale actions are rejected", () => {
    const ctx = makeCtx(["a", "b"], [item(1, 10), item(2, 20)]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "skip", round: 1 }, host, ctx)).state;
    expect(s.round).toBe(2);
    // A retried "skip round 1" must not skip round 2.
    expect(game.apply(structuredClone(s), { type: "skip", round: 1 }, host, ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "submit", round: 1, value: 3 }, p("b"), ctx).ok).toBe(false);
  });

  it("only lets the host reveal, skip and advance", () => {
    const ctx = makeCtx(["a", "b"], [item(1, 10), item(2, 20)]);
    const s = start(ctx);
    for (const type of ["reveal", "skip"] as const) {
      expect(game.apply(structuredClone(s), { type, round: 1 }, p("b"), ctx).ok).toBe(false);
    }
    const revealed = must(game.apply(structuredClone(s), { type: "reveal", round: 1 }, host, ctx)).state;
    expect(game.apply(structuredClone(revealed), { type: "next", round: 1 }, p("b"), ctx).ok).toBe(false);
  });

  it("skipping awards nothing; timeout settles with the guesses received", () => {
    const ctx = makeCtx(["a", "b"], [item(1, 10), item(2, 20)]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "submit", round: 1, value: 9 }, p("a"), ctx)).state;
    const skipped = must(game.apply(structuredClone(s), { type: "skip", round: 1 }, host, ctx));
    expect(skipped.scores).toBeUndefined();

    expect(game.deadline?.(s)).toBe(1000 + 60_000);
    const timedOut = game.onTimeout?.(structuredClone(s), ctx);
    expect(timedOut?.ok && timedOut.scores?.map((x) => x.playerId)).toEqual(["a"]);
    expect(timedOut?.ok && game.deadline?.(timedOut.state)).toBeNull();
  });

  it("lets late joiners in at the next round and finishes after the configured rounds", () => {
    const ctx = makeCtx(["a", "b"], [item(1, 10), item(2, 20), item(3, 30)]);
    let s = start(ctx);
    s = must(game.apply(s, { type: "reveal", round: 1 }, host, ctx)).state;
    ctx.players = ["a", "b", "c"];
    s = must(game.apply(s, { type: "next", round: 1 }, host, ctx)).state;
    expect(s.participants).toEqual(["a", "b", "c"]);
    s = must(game.apply(s, { type: "reveal", round: 2 }, host, ctx)).state;
    const end = must(game.apply(s, { type: "next", round: 2 }, host, ctx));
    expect(end.finished).toBe(true);
    expect(end.state.endedBecause).toBe("rounds");
  });

  it("finishes cleanly when the content pool runs out, and rebases the timer on resume", () => {
    const ctx = makeCtx(["a", "b"], [item(1, 10)]);
    let s = start(ctx, { rounds: 0, answerSeconds: 30 });
    const resumed = game.onResume?.(structuredClone(s), { ...ctx, now: 500_000 });
    expect(resumed?.deadlineAt).toBe(530_000);
    s = must(game.apply(s, { type: "reveal", round: 1 }, host, ctx)).state;
    const end = must(game.apply(s, { type: "next", round: 1 }, host, ctx));
    expect(end.finished).toBe(true);
    expect(end.state.endedBecause).toBe("no-content");
  });
});
