import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { cardPoints, noThanksGame as game, type NoThanksState, startingChips } from "./game.ts";

const table = () => new Table(game, makeCtx(["a", "b", "c"], [], Math.random), { games: 2 });

describe("nothanks", () => {
  it("scores runs by their lowest card", () => {
    expect(cardPoints([10, 11, 12, 30])).toBe(40);
    expect(cardPoints([5, 7, 6])).toBe(5);
    expect([3, 5, 6, 7].map(startingChips)).toEqual([11, 11, 9, 7]);
  });

  it("deals 24 cards in play and keeps chip counts private", () => {
    const t = table();
    expect(t.state.deck.length + 1).toBe(24);
    expect(t.view("b").myChips).toBe(11);
    expect(JSON.stringify(t.view("b"))).not.toContain('"chips"');
    expect(t.view("b").final).toBeNull();
  });

  it("passing costs a chip and moves on; taking collects the pot and faces the next card", () => {
    const t = table();
    const first = t.state.current;
    const card = t.state.card;
    expect(t.rejects(as("zz"), { type: "take" })).toBe(true);
    t.do(as(first), { type: "pass" });
    expect([t.state.pot, t.state.chips[first], t.state.current]).toEqual([1, 10, t.state.players[1]]);
    t.do(as(t.state.current), { type: "take" });
    const taker = t.state.players[1] as string;
    expect([t.state.cards[taker], t.state.chips[taker], t.state.pot, t.state.current]).toEqual([[card], 12, 0, taker]);
  });

  it("forces a take without chips, ends when the deck runs out, lowest score wins", () => {
    const t = table();
    const s = t.state as NoThanksState;
    s.chips[s.current] = 0;
    expect(t.rejects(as(s.current), { type: "pass" })).toBe(true);
    // Play the deck out by always taking.
    while (t.state.phase === "play") t.do(as(t.state.current), { type: "take" });
    expect(t.state.phase).toBe("gameOver");
    expect(t.view("c").final?.chips).toBeDefined();
    expect(t.scores.length).toBeGreaterThan(0);
    t.do(host, { type: "next" });
    expect([t.state.game, t.state.phase]).toEqual([2, "play"]);
  });
});
