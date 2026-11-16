import { describe, expect, it } from "vitest";
import { as, makeCtx, Table } from "../testkit.ts";
import {
  describeSevenEffects,
  END_DISCARDS,
  sevenGame as game,
  SEVEN_CARDS,
  SEVEN_HAND,
  type SevenState,
  type SevenTheme,
  scoreSevenHand,
  sevenCardName,
} from "./game.ts";

const theme: SevenTheme = {
  name: "测试",
  suits: ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"].map((label) => ({ label })),
  cards: Array.from({ length: 8 }, (_, s) => Array.from({ length: 7 }, (_, i) => `牌${s}${i}`)),
};
const table = (players = ["a", "b", "c"]) => new Table(game, makeCtx(players, [theme], Math.random));
const value = (hand: string[], id: string) => scoreSevenHand(hand).cards.find((c) => c.id === id);

describe("seven", () => {
  it("has fifty-six distinct cards, seven per suit, all describable and nameable", () => {
    expect(SEVEN_CARDS).toHaveLength(56);
    expect(new Set(SEVEN_CARDS.map((c) => c.id)).size).toBe(56);
    for (const c of SEVEN_CARDS) {
      expect(describeSevenEffects(c, theme)).not.toContain("?");
      expect(sevenCardName(c, theme)).toBe(`牌${c.suit}${c.index}`);
      expect(sevenCardName(c, { ...theme, cards: undefined })).toBe(`${theme.suits[c.suit]?.label} ${c.index + 1}`);
    }
  });

  it("scores bonuses and penalties from the suits of the rest of the hand", () => {
    // 0-0: base 5, +6 per card of suit 1. 0-2: base 18, −6 per card of suit 3.
    expect(value(["0-0", "1-1", "1-5"], "0-0")?.value).toBe(17);
    expect(value(["0-2", "3-0", "3-1"], "0-2")?.value).toBe(6);
    // 0-1: base 9, +10 if the hand has suit 2. 0-5: base 7, +7 per other card of its own suit.
    expect([value(["0-1", "2-5"], "0-1")?.value, value(["0-1", "3-5"], "0-1")?.value]).toEqual([19, 9]);
    expect(value(["0-5", "0-0", "0-1"], "0-5")?.value).toBe(21);
    // Specials: per distinct suit, all different, none of a suit, unless a suit, highest base.
    expect(value(["0-6", "1-5", "2-5"], "0-6")?.value).toBe(4 + 3 * 3);
    expect([value(["1-6", "2-5", "3-5"], "1-6")?.value, value(["1-6", "2-5", "2-0"], "1-6")?.value]).toEqual([43, 3]);
    expect([value(["2-6", "4-5"], "2-6")?.value, value(["2-6", "3-5"], "2-6")?.value]).toEqual([26, 8]);
    expect([value(["3-6", "5-5"], "3-6")?.value, value(["3-6", "4-5"], "3-6")?.value]).toEqual([22, 10]);
    expect(value(["7-6", "0-3", "5-0"], "7-6")?.value).toBe(5); // 0-3 is blank here, so 5-0's base counts
  });

  it("settles blanking first: a blank card scores nothing, has no effect and loses its suit", () => {
    // 0-3: base 24, blank unless the hand has suit 4.
    expect(value(["0-3", "1-4"], "0-3")).toMatchObject({ blank: true, value: 0 });
    expect(value(["0-3", "4-4"], "0-3")).toMatchObject({ blank: false, value: 24 });
    // 0-4 blanks every card of suit 5; a blanked card no longer feeds other cards' bonuses.
    const hand = ["0-4", "5-4", "4-0"]; // 4-0: +6 per card of suit 5
    expect(value(hand, "5-4")).toMatchObject({ blank: true, value: 0 });
    expect(value(hand, "4-0")?.value).toBe(5);
    // A card that is blank itself does not blank others: 3-3 needs suit 7, so 3-4 stays quiet... and 0-0 survives.
    expect(scoreSevenHand(["0-3", "3-4"]).cards.map((c) => c.blank)).toEqual([true, false]);
    expect(scoreSevenHand(["0-0", "1-4", "0-3"]).total).toBe(5 + 6 + 20);
  });

  it("deals seven secret cards each and never sends another player's hand or the deck", () => {
    const t = table();
    const s = t.state;
    for (const p of s.players) expect(s.hands[p]).toHaveLength(SEVEN_HAND);
    expect(s.deck).toHaveLength(56 - 21);
    const v = t.view("b");
    expect(v.hand).toHaveLength(SEVEN_HAND);
    expect(v.final).toBeNull();
    const wire = t.wire("b");
    for (const id of [...(s.hands.a ?? []), ...(s.hands.c ?? []), ...s.deck]) expect(wire).not.toContain(`"${id}"`);
    // A spectator sees no hand at all.
    expect(t.view("zz").hand).toBeNull();
  });

  it("draws from the deck or the open discards, then discards, in turn", () => {
    const t = table();
    const [a, b] = t.state.players as [string, string];
    expect(t.rejects(as(b), { type: "draw" })).toBe(true);
    expect(t.rejects(as(a), { type: "discard", cardId: t.state.hands[a]?.[0] })).toBe(true);
    t.do(as(a), { type: "draw" });
    expect(t.state.hands[a]).toHaveLength(SEVEN_HAND + 1);
    expect(t.rejects(as(a), { type: "draw" })).toBe(true);
    expect(t.rejects(as(a), { type: "discard", cardId: t.state.hands[b]?.[0] })).toBe(true);
    const thrown = t.state.hands[a]?.[0] as string;
    t.do(as(a), { type: "discard", cardId: thrown });
    expect([t.state.discards, t.state.current, t.state.hands[a]?.length]).toEqual([[thrown], b, SEVEN_HAND]);
    // The next player may pick that open card up instead of drawing blind.
    expect(t.view(b).discards.map((c) => c.id)).toEqual([thrown]);
    t.do(as(b), { type: "take", cardId: thrown });
    expect(t.state.discards).toEqual([]);
    expect(t.state.hands[b]).toContain(thrown);
  });

  it("ends when the discard area is full, reveals every hand and awards each player their total", () => {
    for (const players of [
      ["a", "b"],
      ["a", "b", "c", "d", "e", "f"],
    ]) {
      const t = table(players);
      for (let i = 0; i < 100 && !t.finished; i++) t.timeout();
      expect(t.finished).toBe(true);
      const s = t.state as SevenState;
      expect(s.discards).toHaveLength(END_DISCARDS);
      const v = t.view(players[0] as string);
      for (const p of players) {
        expect(v.final?.[p]?.cards).toHaveLength(SEVEN_HAND);
        expect(t.points(p)).toBe(Math.max(0, v.final?.[p]?.total ?? 0));
      }
      expect(s.winners.length).toBeGreaterThan(0);
    }
  });
});
