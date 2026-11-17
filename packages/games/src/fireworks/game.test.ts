import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { type FireworksState, type FwCard, fwHandSize, fireworksGame as game } from "./game.ts";

const card = (color: string, number: number, id = `${color}${number}`): FwCard => ({
  id,
  color,
  number,
  knownColor: false,
  knownNumber: false,
  notColors: [],
  notNumbers: [],
});
/** Three players with known hands; `a` moves first; the deck holds `deck`. */
function table(deck: FwCard[] = [card("白", 4, "d1"), card("白", 5, "d2")]) {
  const t = new Table(game, makeCtx(["a", "b", "c"], [], Math.random));
  Object.assign(t.state as FireworksState, {
    hands: {
      a: [card("红", 1), card("红", 3), card("蓝", 1)],
      b: [card("黄", 1), card("黄", 2), card("绿", 5)],
      c: [card("绿", 1), card("白", 1), card("白", 2)],
    },
    deck,
    current: "a",
  });
  return t;
}

describe("fireworks", () => {
  it("has 50 cards and deals five (or four) each", () => {
    const s = new Table(game, makeCtx(["a", "b", "c"], [], Math.random)).state as FireworksState;
    expect(s.deck.length + 15).toBe(50);
    expect([2, 3, 4, 5].map(fwHandSize)).toEqual([5, 5, 4, 4]);
    const all = [...s.deck, ...Object.values(s.hands).flat()];
    expect(all.filter((c) => c.color === "红" && c.number === 1).length).toBe(3);
    expect(all.filter((c) => c.number === 5).length).toBe(5);
    // Ids are positions in the shuffled deck, not descriptions of the card.
    expect(new Set(all.map((c) => c.id)).size).toBe(50);
    expect(all.every((c) => /^f\d+$/.test(c.id))).toBe(true);
  });

  it("shows everyone's cards except the viewer's own, which carry only what was hinted", () => {
    const t = table();
    const view = t.view("a");
    expect(view.hands.a).toBeUndefined();
    expect(view.hands.b?.map((c) => `${c.color}${c.number}`)).toEqual(["黄1", "黄2", "绿5"]);
    expect(view.myHand).toEqual(
      [
        { id: "红1", color: null, number: null, notColors: [], notNumbers: [] },
        { id: "红3", color: null, number: null, notColors: [], notNumbers: [] },
        { id: "蓝1", color: null, number: null, notColors: [], notNumbers: [] },
      ].map((c, i) => ({ ...c, id: view.myHand?.[i]?.id })),
    );
    expect(JSON.stringify(view.myHand)).not.toContain('"color":"红"');
    expect(t.wire("a")).not.toContain('"deck"');
  });

  it("a hint marks every matching card, costs a token and must touch something", () => {
    const t = table();
    expect(t.rejects(as("a"), { type: "hint", target: "a", number: 1 })).toBe(true);
    expect(t.rejects(as("a"), { type: "hint", target: "b", color: "红" })).toBe(true);
    expect(t.rejects(as("a"), { type: "hint", target: "b", color: "黄", number: 1 })).toBe(true);
    t.do(as("a"), { type: "hint", target: "b", color: "黄" });
    expect([t.state.hints, t.state.current]).toEqual([7, "b"]);
    expect(t.view("b").myHand?.map((c) => [c.color, c.notColors])).toEqual([
      ["黄", []],
      ["黄", []],
      [null, ["黄"]],
    ]);
  });

  it("plays the next card of a colour, burns a fuse on a wrong one, and draws a replacement", () => {
    const t = table();
    t.do(as("a"), { type: "play", cardId: "红1" });
    expect([t.state.stacks.红, t.state.hands.a?.map((c) => c.id), t.state.deck.length]).toEqual([
      1,
      ["红3", "蓝1", "d1"],
      1,
    ]);
    t.do(as("b"), { type: "play", cardId: "黄2" });
    expect([t.state.stacks.黄, t.state.fuses, t.state.discard]).toEqual([0, 2, [{ color: "黄", number: 2 }]]);
  });

  it("discarding wins a hint back, but not when the hints are full", () => {
    const t = table();
    expect(t.rejects(as("a"), { type: "discard", cardId: "红3" })).toBe(true);
    t.do(as("a"), { type: "hint", target: "b", number: 1 });
    t.do(as("b"), { type: "discard", cardId: "绿5" });
    expect([t.state.hints, t.state.discard]).toEqual([8, [{ color: "绿", number: 5 }]]);
  });

  it("gives everyone one more turn after the last card is drawn, then scores the stacks", () => {
    const t = table([card("白", 4, "d1")]);
    t.do(as("a"), { type: "play", cardId: "红1" });
    expect(t.state.finalTurns).toBe(3);
    t.do(as("b"), { type: "play", cardId: "黄1" });
    t.do(as("c"), { type: "play", cardId: "绿1" });
    expect(t.state.phase).toBe("play");
    t.do(as("a"), { type: "play", cardId: "蓝1" });
    expect([t.state.phase, t.state.ended, t.view("a").score]).toEqual(["gameOver", "deck", 4]);
    expect(t.view("a").hands.a).toBeDefined();
    t.do(host, { type: "next" });
    expect([t.finished, t.points("a")]).toEqual([true, 0]);
  });

  it("explodes on the third wrong play, and a good score pays the whole team", () => {
    const boom = table();
    (boom.state as FireworksState).fuses = 1;
    boom.do(as("a"), { type: "play", cardId: "红3" });
    expect([boom.state.phase, boom.state.ended]).toEqual(["gameOver", "exploded"]);

    const good = table();
    Object.assign(good.state as FireworksState, { stacks: { 红: 5, 黄: 5, 绿: 5, 蓝: 4, 白: 2 }, finalTurns: 1 });
    good.do(as("a"), { type: "hint", target: "b", number: 1 });
    expect(good.state.ended).toBe("deck");
    good.do(host, { type: "next" });
    expect([good.points("a"), good.points("c")]).toEqual([3, 3]);
  });
});
