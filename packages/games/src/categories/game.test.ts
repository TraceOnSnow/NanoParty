import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { categoriesGame as game } from "./game.ts";

const cats = [{ name: "水果园" }, { name: "动物园" }];

describe("categories", () => {
  it("enforces turn order and rejects repeated words without ending the turn", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], cats));
    expect(t.state.current).toBe("a");
    expect(t.rejects(as("b"), { type: "say", text: "苹果" })).toBe(true);
    t.do(as("a"), { type: "say", text: "苹果" });
    expect(t.state.current).toBe("b");
    expect(t.rejects(as("b"), { type: "say", text: " 苹 果！" })).toBe(true); // same word after normalising
    expect(t.state.current).toBe("b");
    t.do(as("b"), { type: "say", text: "香蕉" });
    expect(t.view("c").words.map((w) => w.text)).toEqual(["苹果", "香蕉"]);
  });

  it("eliminates on timeout, giving up or a host ruling; the last player standing scores", () => {
    const t = new Table(game, makeCtx(["a", "b", "c"], cats));
    t.do(as("a"), { type: "say", text: "苹果" });
    t.timeout(); // b runs out of time
    expect([t.state.alive, t.state.current]).toEqual([["a", "c"], "c"]);
    t.do(as("c"), { type: "say", text: "桌子" });
    expect(t.rejects(as("c"), { type: "invalidate" })).toBe(true);
    t.do(host, { type: "invalidate" }); // "桌子" is not a fruit: c is out
    expect(t.state.phase).toBe("roundOver");
    expect(t.state.winner).toBe("a");
    expect(t.scores).toEqual([{ playerId: "a", points: 2, reason: "撑到最后", key: "r1:win:a" }]);
    expect(t.state.out).toEqual([
      { playerId: "b", reason: "timeout" },
      { playerId: "c", reason: "invalid" },
    ]);
  });

  it("rejects stale actions, rotates the starting seat and finishes after the rounds", () => {
    const t = new Table(game, makeCtx(["a", "b"], cats), { rounds: 2 });
    const stale = t.state.step;
    t.do(as("a"), { type: "say", text: "苹果" });
    expect(t.rejects(as("b"), { type: "say", step: stale, text: "香蕉" })).toBe(true);
    t.do(as("b"), { type: "giveUp" });
    expect(t.state.winner).toBe("a");
    t.do(host, { type: "next" });
    expect([t.state.round, t.state.current, t.state.words]).toEqual([2, "b", []]);
    t.do(as("b"), { type: "giveUp" });
    t.do(host, { type: "next" });
    expect(t.finished).toBe(true);
  });
});
