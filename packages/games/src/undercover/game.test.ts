import type { Actor, ContentItem, GameContext } from "@apr/shared";
import { describe, expect, it } from "vitest";
import { undercoverGame as game, type UndercoverState, undercoverCountFor } from "./game.ts";

const item = (n: number): ContentItem => ({
  id: `w${n}`,
  version: 1,
  type: "word-pair",
  theme: "t",
  payload: { a: `甲词${n}`, b: `乙词${n}` },
});

/** random() = 0.9 keeps the shuffle order and makes word `b` the civilians' word; undercover = first player. */
function makeCtx(players: string[], count = 5): GameContext {
  const pool = Array.from({ length: count }, (_, i) => item(i + 1));
  return { now: 1000, random: () => 0.9, players, drawContent: () => pool.shift() ?? null };
}

const as = (playerId: string, isHost = false): Actor => ({ kind: "player", playerId, isHost });
const host = as("a", true);
const cfg = { games: 2, describeSeconds: 60, voteSeconds: 0 };

function start(ctx: GameContext, config = cfg): UndercoverState {
  const r = game.setup(config, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const must = (r: ReturnType<typeof game.apply>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

function describeAll(s: UndercoverState, ctx: GameContext): UndercoverState {
  for (const p of [...s.alive])
    s = must(game.apply(s, { type: "describe", step: s.step, text: `${p}的描述` }, as(p), ctx)).state;
  return s;
}
function voteAll(s: UndercoverState, ctx: GameContext, votes: Record<string, string>) {
  let last = { ok: true as const, state: s } as ReturnType<typeof must>;
  for (const [voter, target] of Object.entries(votes)) {
    last = must(game.apply(last.state, { type: "vote", step: last.state.step, target }, as(voter), ctx));
  }
  return last;
}

describe("undercover game", () => {
  it("needs three players; deals one undercover up to five players and two from six", () => {
    expect(game.setup(cfg, makeCtx(["a", "b"])).ok).toBe(false);
    expect([3, 5, 6, 8].map(undercoverCountFor)).toEqual([1, 1, 2, 2]);
    const s = start(makeCtx(["a", "b", "c", "d", "e", "f"]));
    expect(Object.values(s.roles).filter((r) => r === "undercover")).toHaveLength(2);
  });

  it("shows each player only their own word and never their role", () => {
    const ctx = makeCtx(["a", "b", "c", "d"]);
    const s = start(ctx);
    expect(s.roles).toEqual({ a: "undercover", b: "civilian", c: "civilian", d: "civilian" });
    const a = game.view(s, "a");
    const b = game.view(s, "b");
    expect(a.myWord).toBe("甲词1");
    expect(b.myWord).toBe("乙词1");
    expect(JSON.stringify(a)).not.toContain("乙词1");
    expect(JSON.stringify(b)).not.toContain("甲词1");
    for (const v of [a, b]) {
      expect(JSON.stringify(v)).not.toMatch(/undercover"|civilian"/);
      expect(v.revealedRoles).toEqual({});
      expect(v.outcome).toBeNull();
    }
    // A spectator (not dealt in) sees no word at all.
    const z = game.view(s, "z");
    expect(z.myWord).toBeNull();
    expect(JSON.stringify(z)).not.toMatch(/甲词|乙词/);
    expect(game.publicSummary(s)).not.toMatch(/甲词|乙词/);
  });

  it("keeps descriptions hidden until everyone has submitted, then shows them together", () => {
    const ctx = makeCtx(["a", "b", "c"]);
    let s = start(ctx);
    expect(
      game.apply(structuredClone(s), { type: "describe", step: s.step, text: "就是甲词1呀" }, as("a"), ctx).ok,
    ).toBe(false);
    s = must(game.apply(s, { type: "describe", step: s.step, text: "圆圆的" }, as("a"), ctx)).state;
    const peek = game.view(s, "b");
    expect(peek.descriptions).toBeNull();
    expect(peek.submitted).toEqual(["a"]);
    expect(JSON.stringify(peek)).not.toContain("圆圆的");
    expect(game.view(s, "a").myDescription).toBe("圆圆的");
    expect(game.apply(structuredClone(s), { type: "describe", step: s.step, text: "再来" }, as("a"), ctx).ok).toBe(
      false,
    );

    s = must(game.apply(s, { type: "describe", step: s.step, text: "能吃" }, as("b"), ctx)).state;
    s = must(game.apply(s, { type: "describe", step: s.step, text: "很甜" }, as("c"), ctx)).state;
    expect(s.phase).toBe("vote");
    expect(game.view(s, "b").descriptions).toEqual({ a: "圆圆的", b: "能吃", c: "很甜" });
  });

  it("hides votes until the tally; civilians win by voting out the undercover", () => {
    const ctx = makeCtx(["a", "b", "c", "d"]);
    let s = describeAll(start(ctx), ctx);
    s = must(game.apply(s, { type: "vote", step: s.step, target: "a" }, as("b"), ctx)).state;
    const mid = game.view(s, "c");
    expect(mid.submitted).toEqual(["b"]);
    expect(mid.myVote).toBeNull();
    expect(mid.history).toEqual([]);
    expect(game.apply(structuredClone(s), { type: "vote", step: s.step, target: "c" }, as("c"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "vote", step: s.step, target: "zz" }, as("c"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "vote", step: s.step, target: "c" }, as("b"), ctx).ok).toBe(false);

    const end = voteAll(s, ctx, { c: "a", d: "a", a: "b" });
    expect(end.state.phase).toBe("gameOver");
    expect(end.state.winner).toBe("civilian");
    expect(end.scores?.map((x) => [x.playerId, x.points, x.key])).toEqual([
      ["b", 2, "g1:win:b"],
      ["c", 2, "g1:win:c"],
      ["d", 2, "g1:win:d"],
    ]);
    const v = game.view(end.state, "a");
    expect(v.outcome).toEqual({ winner: "civilian", words: { civilian: "乙词1", undercover: "甲词1" } });
    expect(v.revealedRoles.a).toBe("undercover");
    expect(v.history[0]?.votes).toEqual({ b: "a", c: "a", d: "a", a: "b" });
  });

  it("continues after a wrong elimination, reveals the eliminated role, and lets the undercover win at parity", () => {
    const ctx = makeCtx(["a", "b", "c", "d", "e"]);
    let s = describeAll(start(ctx), ctx);
    const wrong = voteAll(s, ctx, { a: "b", c: "b", d: "b", e: "b", b: "a" });
    s = wrong.state;
    expect(s.phase).toBe("result");
    expect(wrong.scores).toBeUndefined();
    expect(game.view(s, "c").revealedRoles).toEqual({ b: "civilian" });
    // Eliminated players can no longer describe or vote.
    s = must(game.apply(s, { type: "advance", step: s.step }, host, ctx)).state;
    expect([s.phase, s.turn]).toEqual(["describe", 2]);
    expect(game.apply(structuredClone(s), { type: "describe", step: s.step, text: "我还在" }, as("b"), ctx).ok).toBe(
      false,
    );
    s = describeAll(s, ctx);

    // Tie: nobody leaves.
    const tie = voteAll(s, ctx, { a: "c", c: "a", d: "c", e: "a" });
    expect(tie.state.phase).toBe("result");
    expect(tie.state.history.at(-1)?.eliminated).toBeNull();
    s = must(game.apply(tie.state, { type: "advance", step: tie.state.step }, host, ctx)).state;
    s = describeAll(s, ctx);
    s = voteAll(s, ctx, { a: "c", c: "a", d: "c", e: "c" }).state; // c out -> a, d, e
    s = must(game.apply(s, { type: "advance", step: s.step }, host, ctx)).state;
    s = describeAll(s, ctx);
    const end = voteAll(s, ctx, { a: "d", d: "a", e: "d" }); // d out -> a vs e: parity
    expect(end.state.winner).toBe("undercover");
    expect(end.scores).toEqual([{ playerId: "a", points: 4, reason: "卧底获胜", key: "g1:win:a" }]);
  });

  it("binds every action to the current step; host-only controls; timeouts move the game on", () => {
    const ctx = makeCtx(["a", "b", "c"]);
    const s = start(ctx);
    expect(game.apply(structuredClone(s), { type: "advance", step: s.step }, as("b"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "skip", step: s.step }, as("b"), ctx).ok).toBe(false);
    expect(game.apply(structuredClone(s), { type: "describe", step: s.step - 1, text: "迟到" }, as("b"), ctx).ok).toBe(
      false,
    );

    expect(game.deadline?.(s)).toBe(61_000);
    const timedOut = game.onTimeout?.(structuredClone(s), ctx);
    expect(timedOut?.ok && timedOut.state.phase).toBe("vote");
    expect(timedOut?.ok && game.deadline?.(timedOut.state)).toBeNull();
    // An action prepared for the describe phase is stale once voting has begun.
    if (timedOut?.ok) {
      expect(game.apply(timedOut.state, { type: "describe", step: s.step, text: "迟到" }, as("b"), ctx).ok).toBe(false);
    }
    // Host closes a vote nobody cast: nobody is eliminated.
    const voting = must(game.apply(structuredClone(s), { type: "advance", step: s.step }, host, ctx)).state;
    const closed = must(game.apply(voting, { type: "advance", step: voting.step }, host, ctx)).state;
    expect([closed.phase, closed.alive.length]).toEqual(["result", 3]);
  });

  it("skips to new words without scoring, starts further games with late joiners, and finishes", () => {
    const ctx = makeCtx(["a", "b", "c"]);
    let s = start(ctx);
    const skipped = must(game.apply(s, { type: "skip", step: s.step }, host, ctx));
    expect(skipped.scores).toBeUndefined();
    s = skipped.state;
    expect([s.game, s.words.contentId]).toEqual([1, "w2"]);

    s = voteAll(describeAll(s, ctx), ctx, { b: "a", c: "a", a: "b" }).state;
    expect(game.apply(structuredClone(s), { type: "skip", step: s.step }, host, ctx).ok).toBe(false);
    ctx.players = ["a", "b", "c", "d"];
    s = must(game.apply(s, { type: "advance", step: s.step }, host, ctx)).state;
    expect([s.game, s.players.length, s.phase]).toEqual([2, 4, "describe"]);

    s = voteAll(describeAll(s, ctx), ctx, { b: "a", c: "a", d: "a", a: "b" }).state;
    const end = must(game.apply(s, { type: "advance", step: s.step }, host, ctx));
    expect(end.finished).toBe(true);
    expect(end.state.endedBecause).toBe("games");
  });
});
