import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { oneClueGame as game } from "./game.ts";

const words = [{ word: "月亮" }, { word: "火锅" }];
const table = () => new Table(game, makeCtx(["a", "b", "c", "d"], words), { rounds: 2 });

describe("oneclue", () => {
  it("never shows the word or cancelled clues to the guesser before the reveal", () => {
    const t = table();
    expect(t.state.guesser).toBe("a");
    expect(t.view("a").word).toBeNull();
    expect(t.view("b").word).toBe("月亮");
    expect(t.rejects(as("a"), { type: "clue", text: "夜晚" })).toBe(true);
    expect(t.rejects(as("b"), { type: "clue", text: "大月亮" })).toBe(true);
    t.do(as("b"), { type: "clue", text: "夜晚" });
    expect(t.view("c").clues).toBeNull(); // other givers cannot copy a clue either
    t.do(as("c"), { type: "clue", text: "夜 晚" }); // collides with b after normalising
    t.do(as("d"), { type: "clue", text: "嫦娥" });
    expect(t.state.phase).toBe("guess");
    expect(t.state.cancelled.sort()).toEqual(["b", "c"]);

    const guesser = t.view("a");
    expect(guesser.clues?.filter((c) => !c.cancelled).map((c) => c.text)).toEqual(["嫦娥"]);
    expect(guesser.clues?.filter((c) => c.cancelled).every((c) => c.text === null)).toBe(true);
    expect(t.wire("a")).not.toMatch(/月亮|夜晚/);
    // Clue givers do see what collided.
    expect(t.view("d").clues?.find((c) => c.playerId === "b")).toEqual({
      playerId: "b",
      text: "夜晚",
      cancelled: true,
    });
  });

  it("scores the whole team on a correct guess", () => {
    const t = table();
    for (const [p, clue] of [
      ["b", "夜晚"],
      ["c", "圆"],
      ["d", "嫦娥"],
    ] as const)
      t.do(as(p), { type: "clue", text: clue });
    expect(t.rejects(as("b"), { type: "guess", text: "月亮" })).toBe(true);
    t.do(as("a"), { type: "guess", text: " 月亮 " });
    expect(t.state.correct).toBe(true);
    expect(["a", "b", "c", "d"].map((p) => t.points(p))).toEqual([1, 1, 1, 1]);
    expect(t.view("a").word).toBe("月亮");
  });

  it("lets the host accept a near miss once, and handles passing and timeouts", () => {
    const t = table();
    for (const [p, clue] of [
      ["b", "夜晚"],
      ["c", "圆"],
      ["d", "嫦娥"],
    ] as const)
      t.do(as(p), { type: "clue", text: clue });
    t.do(as("a"), { type: "guess", text: "月球" });
    expect([t.state.correct, t.scores.length]).toEqual([false, 0]);
    expect(t.rejects(as("b"), { type: "accept" })).toBe(true);
    t.do(host, { type: "accept" });
    expect(t.scores).toHaveLength(4);
    expect(t.rejects(host, { type: "accept" })).toBe(true); // cannot be awarded twice

    t.do(host, { type: "advance" });
    expect([t.state.round, t.state.guesser]).toEqual([2, "b"]);
    t.timeout(); // nobody wrote a clue
    t.do(as("b"), { type: "pass" });
    expect(t.state.correct).toBe(false);
    expect(t.rejects(host, { type: "accept" })).toBe(true); // nothing was guessed
    t.do(host, { type: "advance" });
    expect(t.finished).toBe(true);
  });
});
