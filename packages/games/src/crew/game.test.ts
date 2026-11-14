import { describe, expect, it } from "vitest";
import { as, host, makeCtx, Table } from "../testkit.ts";
import { type CrewState, DECK, crewGame as game, legalCards, signalKind, trickWinner } from "./game.ts";

const table = () => new Table(game, makeCtx(["a", "b", "c"], [], Math.random), { missions: 2, tasks: 1 });

/** A rigged mid-mission position. */
function rigged(): Table<CrewState> {
  const t = table();
  Object.assign(t.state, {
    phase: "play",
    commander: "a",
    current: "a",
    hands: { a: ["red-9", "blue-2"], b: ["red-3", "green-5"], c: ["blue-8", "trump-1"] },
    tasks: [{ card: "red-3", owner: "a", done: false }],
    trick: [],
  });
  return t;
}

describe("crew", () => {
  it("deals the whole deck; the holder of trump 4 commands; hands stay private", () => {
    const t = table();
    const all = Object.values(t.state.hands).flat();
    expect(all.sort()).toEqual([...DECK].sort());
    expect(t.state.hands[t.state.commander]).toContain("trump-4");
    for (const p of ["a", "b", "c"]) {
      const others = Object.entries(t.state.hands)
        .filter(([q]) => q !== p)
        .flatMap(([, h]) => h);
      const wire = JSON.stringify(t.view(p));
      expect(others.some((c) => wire.includes(`"${c}"`) && !t.state.tasks.some((x) => x.card === c))).toBe(false);
    }
  });

  it("drafts tasks in turn from the commander, then the commander leads", () => {
    const t = table();
    const first = t.state.current;
    expect(first).toBe(t.state.commander);
    const other = ["a", "b", "c"].find((p) => p !== first) as string;
    expect(t.rejects(as(other), { type: "takeTask", card: t.state.tasks[0]?.card })).toBe(true);
    t.do(as(first), { type: "takeTask", card: t.state.tasks[0]?.card });
    expect([t.state.phase, t.state.current]).toEqual(["play", first]);
  });

  it("knows follow-suit, trump and signal rules", () => {
    expect(
      trickWinner([
        { playerId: "a", card: "red-2" },
        { playerId: "b", card: "red-9" },
        { playerId: "c", card: "blue-9" },
      ]),
    ).toBe("b");
    expect(
      trickWinner([
        { playerId: "a", card: "red-9" },
        { playerId: "b", card: "trump-1" },
      ]),
    ).toBe("b");
    expect(signalKind(["red-1", "red-5", "red-9"], "red-9")).toBe("highest");
    expect(signalKind(["red-1", "red-5", "red-9"], "red-5")).toBeNull();
    expect(signalKind(["red-5", "blue-1"], "red-5")).toBe("only");
    expect(signalKind(["trump-2"], "trump-2")).toBeNull();
    const t = rigged();
    t.state.trick = [{ playerId: "a", card: "red-9" }];
    t.state.current = "b";
    expect(legalCards(t.state, "b")).toEqual(["red-3"]);
    expect(legalCards(t.state, "c")).toEqual(["blue-8", "trump-1"]);
  });

  it("fails the mission when a task card is won by the wrong player", () => {
    const t = rigged();
    t.do(as("a"), { type: "play", card: "blue-2" });
    expect(t.rejects(as("b"), { type: "play", card: "red-3" })).toBe(false); // no blue: anything goes
    t.do(as("b"), { type: "play", card: "red-3" });
    t.do(as("c"), { type: "play", card: "blue-8" }); // c wins the trick holding a's task card
    expect([t.state.phase, t.state.result, t.state.failedTask]).toEqual(["missionOver", "failure", "red-3"]);
    expect(t.scores).toEqual([]);
  });

  it("succeeds when every task is won by its owner; signals are once per mission between tricks", () => {
    const t = rigged();
    expect(t.rejects(as("b"), { type: "signal", card: "green-5" })).toBe(false);
    t.do(as("b"), { type: "signal", card: "green-5" });
    expect(t.rejects(as("b"), { type: "signal", card: "red-3" })).toBe(true);
    t.do(as("a"), { type: "play", card: "red-9" });
    expect(t.rejects(as("c"), { type: "signal", card: "blue-8" })).toBe(true); // mid-trick
    t.do(as("b"), { type: "play", card: "red-3" });
    t.do(as("c"), { type: "play", card: "blue-8" });
    expect(t.state.result).toBe("success");
    expect(["a", "b", "c"].map((p) => t.points(p))).toEqual([3, 3, 3]);
    t.do(host, { type: "next" });
    expect([t.state.mission, t.state.tasks.length]).toEqual([2, 2]);
  });
});
