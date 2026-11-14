import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { wordHuntGame as game, type WordHuntState, wolvesFor } from "./game.ts";

const words = [{ word: "火锅" }, { word: "月亮" }, { word: "地铁" }];
// random() = 0.9 keeps the shuffle order: with players a..e and mayor a -> b wolf, c seer, d/e villagers.
const table = (players = ["a", "b", "c", "d", "e"]) => new Table(game, makeCtx(players, words), { rounds: 2 });
const role = (t: Table<WordHuntState>, p: string) => t.state.roles[p];

describe("wordhunt", () => {
  it("deals roles and shares the word only with mayor, wolves and seer", () => {
    expect([3, 5, 6, 7].map(wolvesFor)).toEqual([1, 1, 2, 2]);
    const t = table();
    expect([t.state.mayor, role(t, "b"), role(t, "c"), role(t, "d")]).toEqual(["a", "wolf", "seer", "villager"]);
    expect(t.view("a").word).toBe("火锅");
    expect(t.view("b").word).toBe("火锅");
    expect(t.view("c").word).toBe("火锅");
    for (const p of ["d", "e", "zz"]) {
      expect(t.wire(p)).not.toContain("火锅");
      expect(JSON.stringify(t.view(p))).not.toMatch(/"wolf"|"seer"/);
    }
    // The candidate words are for the mayor's eyes only.
    const fresh = new Table(game, makeCtx(["a", "b", "c", "d"], words), {}, false);
    expect(fresh.view("a").pick?.candidates).toHaveLength(3);
    expect(fresh.view("b").pick?.candidates).toBeNull();
  });

  it("runs questions through the mayor; a correct guess lets the wolves hunt the seer", () => {
    const t = table();
    t.do(as("d"), { type: "ask", text: "是吃的吗？" });
    expect(t.rejects(as("d"), { type: "ask", text: "再问" })).toBe(true);
    expect(t.rejects(as("b"), { type: "answer", id: 1, answer: "yes" })).toBe(true);
    t.do(as("a"), { type: "answer", id: 1, answer: "yes" });
    t.do(as("e"), { type: "guess", text: "麻辣烫" });
    expect(t.state.phase).toBe("ask");
    t.do(as("d"), { type: "guess", text: " 火锅 " });
    expect([t.state.phase, t.state.finder]).toEqual(["found", "d"]);
    expect(t.view("d").accusers).toEqual(["b"]);
    expect(t.rejects(as("d"), { type: "accuse", target: "c" })).toBe(true);
    t.do(as("b"), { type: "accuse", target: "c" });
    expect(t.state.winner).toBe("wolves");
    expect(t.points("b")).toBe(3);
    expect(t.view("e").reveal?.roles).toMatchObject({ b: "wolf", c: "seer" });
  });

  it("when time runs out, the village wins only by naming a wolf", () => {
    const t = table();
    t.timeout();
    expect(t.state.phase).toBe("timeUp");
    for (const [p, target] of [
      ["a", "b"],
      ["b", "c"],
      ["c", "b"],
      ["d", "b"],
      ["e", "c"],
    ])
      t.do(as(p as string), { type: "accuse", target });
    expect([t.state.accused, t.state.winner]).toEqual(["b", "village"]);
    expect(["a", "b", "c", "d", "e"].map((p) => t.points(p))).toEqual([3, 0, 3, 3, 3]);
    t.do(host, { type: "advance" });
    expect(t.state.mayor).toBe("b");
  });

  it("the mayor can accept a close question as the word", () => {
    const t = table();
    t.do(as("e"), { type: "ask", text: "是重庆那种锅吗？" });
    t.do(as("a"), { type: "correct", id: 1 });
    expect([t.state.phase, t.state.finder]).toEqual(["found", "e"]);
    t.timeout(); // the wolves did not name anyone: the village wins
    expect(t.state.winner).toBe("village");
  });
});
