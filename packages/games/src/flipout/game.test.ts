import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import {
  buildFlipDeck,
  type FlipCard,
  type FlipoutState,
  flipRoundScore,
  flipoutGame as game,
  isFlipBust,
} from "./game.ts";

const all = buildFlipDeck();
const card = (id: string) => all.find((c) => c.id === id) as FlipCard;
const cards = (...ids: string[]) => ids.map(card);
const ids = (list: FlipCard[] | undefined) => (list ?? []).map((c) => c.id);

/** A table put into a known position: who holds what, whose turn, and the next cards of the deck. */
function scene(held: Record<string, string[]>, top: string[], current = "a", config: Record<string, number> = {}) {
  const players = Object.keys(held);
  const t = new Table(
    game,
    makeCtx(players, [], () => 0.5),
    config,
  );
  const s = t.state as FlipoutState;
  const used = new Set([...top, ...Object.values(held).flat()]);
  s.cards = Object.fromEntries(players.map((p) => [p, cards(...(held[p] as string[]))]));
  s.status = Object.fromEntries(players.map((p) => [p, "active" as const]));
  s.deck = [...cards(...top), ...all.filter((c) => !used.has(c.id))];
  s.discard = [];
  s.tasks = [];
  s.pending = null;
  s.log = [];
  s.flip7 = null;
  s.phase = "turn";
  s.current = current;
  s.needAdvance = false;
  return { t, s };
}
const total = (s: FlipoutState) =>
  s.deck.length +
  s.discard.length +
  Object.values(s.cards).reduce((n, c) => n + c.length, 0) +
  (s.pending ? 1 : 0) +
  s.tasks.reduce((n, k) => n + (k.t === "assign" ? 1 : k.t === "flip4" ? k.held.length : 0), 0);

describe("flipout", () => {
  it("builds 108 cards: 92 numbers, 6 modifiers, 10 actions", () => {
    expect(all.length).toBe(108);
    expect(all.filter((c) => c.kind === "num").length).toBe(92);
    expect(all.filter((c) => c.kind === "num" && c.value === 9).length).toBe(9);
    expect(all.filter((c) => c.kind === "mod").length).toBe(6);
    expect(all.filter((c) => c.kind === "act").length).toBe(10);
    expect(new Set(all.map((c) => c.id)).size).toBe(108);
  });

  it("busts on a repeat, except one extra 13 next to the lucky 13", () => {
    expect(isFlipBust(cards("n5-1", "n5-2"))).toBe(true);
    expect(isFlipBust(cards("n13-1", "n13-2"))).toBe(false);
    expect(isFlipBust(cards("n13-1", "n13-2", "n13-3"))).toBe(true);
    expect(isFlipBust(cards("n13-2", "n13-3"))).toBe(true);
  });

  it("scores numbers, halves, subtracts, floors at zero, then adds the bonus", () => {
    expect(flipRoundScore(cards("n10-1", "n12-1", "mhalf", "m4"), "stayed", false)).toBe(7);
    expect(flipRoundScore(cards("n2-1", "m10"), "stayed", false)).toBe(0);
    expect(flipRoundScore(cards("n10-1", "n12-1"), "bust", false)).toBe(0);
    expect(flipRoundScore(cards("n0", "n12-1"), "stayed", false)).toBe(0);
    expect(flipRoundScore(cards("n0", "n1-1", "n2-1", "n3-1", "n4-1", "n5-1", "n6-1"), "active", true)).toBe(36);
  });

  it("deals a card to everyone, loses none, and never shows the deck", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], [], Math.random));
    const s = t.state as FlipoutState;
    expect(total(s)).toBe(108);
    // A player may end the deal with nothing in front of them: they drew an action card, or
    // their only card was stolen or discarded. What must hold is that no card went missing.
    expect(Object.keys(s.cards)).toEqual(["a", "b", "c"]);
    const wire = t.wire("a");
    expect(wire).not.toContain('"deck"');
    expect(wire).not.toContain('"discard"');
    expect(wire).not.toContain('"tasks"');
    expect(t.view("a")).toEqual(t.view("b"));
  });

  it("hit adds a card, a repeat busts, stay locks in, and the round scores when nobody is left", () => {
    const { t, s } = scene({ a: ["n3-1"], b: ["n4-1"], c: ["n5-1"] }, ["n9-1", "n4-2"]);
    expect(t.rejects(as("b"), { type: "hit" })).toBe(true);
    t.do(as("a"), { type: "hit" });
    expect([ids(t.state.cards.a), t.state.current]).toEqual([["n3-1", "n9-1"], "b"]);
    t.do(as("b"), { type: "hit" });
    expect([t.state.status.b, t.state.current]).toEqual(["bust", "c"]);
    t.do(as("c"), { type: "stay" });
    expect(t.state.current).toBe("a");
    t.do(as("a"), { type: "stay" });
    expect(t.state.phase).toBe("roundOver");
    expect(t.state.roundScores).toEqual({ a: 12, b: 0, c: 5 });
    expect(t.state.totals).toEqual({ a: 12, b: 0, c: 5 });
    expect(total(t.state)).toBe(108);
    t.do(host, { type: "next" });
    expect([t.state.round, total(t.state)]).toEqual([2, 108]);
  });

  it("ends the round at once on seven different numbers and pays the bonus", () => {
    const { t } = scene({ a: ["n1-1", "n2-1", "n3-1", "n4-1", "n5-1", "n6-1"], b: ["n9-1"] }, ["n8-1"]);
    t.do(as("a"), { type: "hit" });
    expect([t.state.phase, t.state.flip7]).toEqual(["roundOver", "a"]);
    expect(t.state.roundScores).toEqual({ a: 29 + 15, b: 9 });
  });

  it("lets the drawer hand a minus card to anyone still in, even a player who stayed", () => {
    const { t, s } = scene({ a: ["n3-1"], b: ["n12-1"], c: ["n5-1"] }, ["m10"]);
    s.status.b = "stayed";
    s.status.c = "bust";
    t.do(as("a"), { type: "hit" });
    expect([t.state.phase, t.state.pending?.by]).toEqual(["assign", "a"]);
    expect(t.rejects(as("b"), { type: "give", target: "a" })).toBe(true);
    expect(t.rejects(as("a"), { type: "give", target: "c" })).toBe(true);
    t.do(as("a"), { type: "give", target: "b" });
    expect(ids(t.state.cards.b)).toEqual(["n12-1", "m10"]);
    expect(t.view("a").preview.b).toBe(2);
    expect(t.state.phase).toBe("turn");
  });

  it("'one more' makes the target draw once and then stay", () => {
    const { t } = scene({ a: ["n3-1"], b: ["n4-1"] }, ["a-onemore-1", "n8-1"]);
    t.do(as("a"), { type: "hit" });
    t.do(as("a"), { type: "give", target: "b" });
    expect([ids(t.state.cards.b), t.state.status.b]).toEqual([["n4-1", "n8-1"], "stayed"]);
  });

  it("'flip four' stops on a bust and only hands out the other cards if all four survive", () => {
    const bust = scene({ a: ["n3-1"], b: ["n4-1"] }, ["a-flipfour-1", "n8-1", "m6", "n4-2", "n9-1"]);
    bust.t.do(as("a"), { type: "hit" });
    bust.t.do(as("a"), { type: "give", target: "b" });
    expect(bust.t.state.status.b).toBe("bust");
    expect(ids(bust.t.state.deck).slice(0, 1)).toEqual(["n9-1"]);
    expect(total(bust.t.state)).toBe(108);

    const safe = scene({ a: ["n3-1"], b: ["n4-1"] }, ["a-flipfour-1", "n8-1", "m6", "n5-1", "n9-1"]);
    safe.t.do(as("a"), { type: "hit" });
    safe.t.do(as("a"), { type: "give", target: "b" });
    expect([safe.t.state.phase, safe.t.state.pending?.by, safe.t.state.pending?.card.id]).toEqual([
      "assign",
      "b",
      "m6",
    ]);
    safe.t.do(as("b"), { type: "give", target: "a" });
    expect(ids(safe.t.state.cards.a)).toEqual(["n3-1", "m6"]);
    expect(ids(safe.t.state.cards.b)).toEqual(["n4-1", "n8-1", "n5-1", "n9-1"]);
  });

  it("steals, discards and swaps cards on the table; a stolen repeat busts the thief", () => {
    const steal = scene({ a: ["n3-1"], b: ["n3-2", "n11-1"] }, ["a-steal-1"]);
    steal.t.do(as("a"), { type: "hit" });
    expect(steal.t.state.phase).toBe("use");
    expect(steal.t.rejects(as("a"), { type: "use", cards: [{ player: "a", cardId: "n3-1" }] })).toBe(true);
    steal.t.do(as("a"), { type: "use", cards: [{ player: "b", cardId: "n3-2" }] });
    expect(steal.t.state.status.a).toBe("bust");

    const drop = scene({ a: ["n3-1", "mhalf"], b: ["n11-1"] }, ["a-discard-1"]);
    drop.t.do(as("a"), { type: "hit" });
    drop.t.do(as("a"), { type: "use", cards: [{ player: "a", cardId: "mhalf" }] });
    expect(ids(drop.t.state.cards.a)).toEqual(["n3-1"]);

    const swap = scene({ a: ["n3-1"], b: ["n11-1"], c: ["n2-1"] }, ["a-swap-1"]);
    swap.t.do(as("a"), { type: "hit" });
    expect(swap.t.rejects(as("a"), { type: "use", cards: [{ player: "b", cardId: "n11-1" }] })).toBe(true);
    swap.t.do(as("a"), {
      type: "use",
      cards: [
        { player: "b", cardId: "n11-1" },
        { player: "c", cardId: "n2-1" },
      ],
    });
    expect([ids(swap.t.state.cards.b), ids(swap.t.state.cards.c)]).toEqual([["n2-1"], ["n11-1"]]);
    expect(total(swap.t.state)).toBe(108);
  });

  it("the unlucky 7 clears the rest, and the 0 forbids staying", () => {
    const wipe = scene({ a: ["n3-1", "n9-1", "m4"], b: ["n4-1"] }, ["n7-1"]);
    wipe.t.do(as("a"), { type: "hit" });
    expect(ids(wipe.t.state.cards.a)).toEqual(["n7-1"]);
    expect(wipe.t.state.status.a).toBe("active");

    const zero = scene({ a: ["n0", "n9-1"], b: ["n4-1"] }, ["n5-1"]);
    expect(zero.t.rejects(as("a"), { type: "stay" })).toBe(true);
    zero.t.timeout();
    expect(ids(zero.t.state.cards.a)).toEqual(["n0", "n9-1", "n5-1"]);
  });

  it("ends the game after the round in which someone reaches the target", () => {
    const { t, s } = scene({ a: ["n13-2", "n12-1"], b: ["n4-1"] }, [], "a", { target: 50 });
    s.totals = { a: 30, b: 48 };
    t.do(as("a"), { type: "stay" });
    t.do(as("b"), { type: "stay" });
    expect([t.state.phase, t.state.winners, t.state.totals]).toEqual(["gameOver", ["a"], { a: 55, b: 52 }]);
    expect(t.points("a")).toBe(3);
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
