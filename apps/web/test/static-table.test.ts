import { bundledContent, games } from "@apr/games";
import { describe, expect, it } from "vitest";
import { SCRIPTED_GAMES, scriptedMove } from "../src/demo/bots.ts";
import { type Seat, Table } from "../src/demo/engine.ts";

const seats = (n: number): Seat[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, nickname: `玩家${i + 1}`, avatar: "🐮", kind: "human" }));

// biome-ignore lint/suspicious/noExplicitAny: views are game-specific
const viewOf = (table: Table, id: string) => table.roomView(id).segment?.view as any;

/** Lets the scripts play every seat, pressing the host's "continue" whenever nobody can move. */
function playOut(table: Table, gameId: string, limit = 3000) {
  // Read the raw state the way the engine hands it to a script.
  const state = () => (table as unknown as { seg: { state: unknown } }).seg.state;
  for (let i = 0; i < limit && table.segmentLive; i++) {
    let moved = false;
    for (const seat of table.seats) {
      const move = scriptedMove(gameId, viewOf(table, seat.id), seat.id, state());
      if (move && table.act(seat.id, move).ok) moved = true;
    }
    if (moved) continue;
    const v = viewOf(table, "p1");
    const bind = typeof v.step === "number" ? { step: v.step } : { round: v.round };
    const pressed = ["advance", "next", "reveal"].some((type) => table.act("p1", { type, ...bind }).ok);
    if (!pressed) throw new Error(`${gameId} is stuck in phase ${v.phase}`);
  }
}

describe("static table", () => {
  it.each(SCRIPTED_GAMES)("scripts can play %s to a result", (gameId) => {
    const table = new Table({ mode: "manual", code: "1234", seats: seats(4), gameIds: [gameId] });
    expect(table.start(gameId)).toEqual({ ok: true });
    playOut(table, gameId);
    expect(table.segmentLive).toBe(false);
    expect(table.result?.rows).toHaveLength(4);
    table.dispose();
  });

  it("can start every game with four people", () => {
    for (const [id, module] of Object.entries(games)) {
      if (module.meta.minPlayers > 4 || module.meta.maxPlayers < 4) continue;
      const table = new Table({ mode: "manual", code: "77", seats: seats(4), gameIds: [id] });
      expect(table.start(id), id).toEqual({ ok: true });
      table.dispose();
    }
  });

  it("gives the same topics for the same room code", () => {
    const first = (code: string) => {
      const table = new Table({ mode: "manual", code, seats: seats(4), gameIds: ["estimate"] });
      table.start("estimate");
      const text = viewOf(table, "p1").question.text as string;
      table.dispose();
      return text;
    };
    expect(first("2468")).toBe(first("2468"));
    const texts = new Set(["1", "2", "3", "4", "5", "6"].map(first));
    expect(texts.size).toBeGreaterThan(1);
  });

  it("shows a seat only its own view", () => {
    const table = new Table({ mode: "manual", code: "9", seats: seats(4), gameIds: ["seven"] });
    table.start("seven");
    const mine = viewOf(table, "p1").hand.map((c: { id: string }) => c.id);
    const theirs = JSON.stringify(viewOf(table, "p2").hand);
    expect(mine).toHaveLength(7);
    for (const id of mine) expect(theirs).not.toContain(`"${id}"`);
    table.dispose();
  });

  it("only ships bundled content", () => {
    expect(bundledContent.every((c) => typeof c.source === "string" && c.source.length > 0)).toBe(true);
  });
});
