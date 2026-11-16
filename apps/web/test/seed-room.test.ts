import { games } from "@apr/games";
import { describe, expect, it } from "vitest";
import { type Block, type DealInput, SEED_GAMES } from "../src/demo/seed.ts";

const base: DealInput = { code: "8270", round: 1, players: 6, seat: 1, team: 0, captain: false };
const game = (id: string) => SEED_GAMES.find((g) => g.id === id) ?? SEED_GAMES[0];
const deal = (id: string, input: Partial<DealInput> = {}) =>
  (game(id) as (typeof SEED_GAMES)[number]).deal({ ...base, ...input });
/** Everything a phone could show, with secrets opened. */
const text = (blocks: Block[]): string =>
  blocks
    .map((b) =>
      b.kind === "secret"
        ? text(b.body)
        : b.kind === "line"
          ? b.text
          : b.kind === "list"
            ? b.items.join(",")
            : b.kind === "grid"
              ? b.words.join(",")
              : `${b.left}-${b.right}-${b.target}`,
    )
    .join("|");
const secret = (blocks: Block[]) => text(blocks.filter((b) => b.kind === "secret"));

describe("same room code", () => {
  it("only lists real games and deals every one of them for many rounds", () => {
    for (const g of SEED_GAMES) {
      expect(games[g.id], g.id).toBeDefined();
      for (let round = 1; round <= 60; round++) {
        for (let seat = 1; seat <= 6; seat++) {
          const blocks = g.deal({ ...base, round, seat, team: (seat % 2) as 0 | 1, captain: seat === 1 });
          expect(blocks.length, `${g.id} r${round}`).toBeGreaterThan(0);
          expect(text(blocks)).not.toMatch(/undefined|NaN/);
        }
      }
    }
  });

  it("two phones with the same code see the same thing; another code differs", () => {
    for (const g of SEED_GAMES) {
      expect(text(g.deal({ ...base, round: 3 })), g.id).toBe(text(g.deal({ ...base, round: 3 })));
    }
    const first = (code: string) => text(deal("categories", { code }));
    expect(new Set(["1", "2", "3", "4", "5", "6", "7", "8"].map(first)).size).toBeGreaterThan(1);
  });

  it("undercover: exactly the right number of seats hold the other word", () => {
    for (const players of [4, 6, 9]) {
      for (let round = 1; round <= 20; round++) {
        const words = Array.from({ length: players }, (_, k) =>
          secret(deal("undercover", { players, round, seat: k + 1 })),
        );
        const counts = [...new Set(words)].map((w) => words.filter((x) => x === w).length).sort((a, b) => a - b);
        expect(counts).toEqual([players >= 6 ? 2 : 1, players - (players >= 6 ? 2 : 1)]);
      }
    }
  });

  it("ranking: everyone but the captain holds a different number", () => {
    for (let round = 1; round <= 12; round++) {
      const numbers = Array.from({ length: 6 }, (_, k) => secret(deal("ranking", { round, seat: k + 1 })));
      const held = numbers.filter((n) => n !== "");
      expect(held).toHaveLength(5);
      expect(new Set(held).size).toBe(5);
      expect(numbers[(round - 1) % 6]).toBe("");
    }
  });

  it("oneclue: the guesser's phone never holds the word", () => {
    for (let round = 1; round <= 12; round++) {
      const guesser = ((round - 1) % 6) + 1;
      const word = secret(deal("oneclue", { round, seat: guesser === 1 ? 2 : 1 }));
      expect(word.length).toBeGreaterThan(0);
      expect(text(deal("oneclue", { round, seat: guesser }))).not.toContain(word);
    }
  });

  it("wordhunt: one mayor, the right wolves, one seer, and villagers never get the word", () => {
    for (let round = 1; round <= 12; round++) {
      const cards = Array.from({ length: 6 }, (_, k) => secret(deal("wordhunt", { round, seat: k + 1 })));
      const count = (role: string) => cards.filter((c) => c.startsWith(role)).length;
      expect([count("村长"), count("狼人"), count("预言家"), count("村民")]).toEqual([1, 1, 1, 3]);
      const word = (cards.find((c) => c.startsWith("村长")) as string).split("|").pop() as string;
      for (const c of cards) expect(c.includes(word)).toBe(!c.startsWith("村民"));
    }
  });

  it("wordgrid: captain and member get the same grid, only the captain sees the owners", () => {
    const captain = deal("wordgrid", { captain: true }).find((b) => b.kind === "grid");
    const member = deal("wordgrid", { captain: false }).find((b) => b.kind === "grid");
    if (captain?.kind !== "grid" || member?.kind !== "grid") throw new Error("no grid");
    expect(member.words).toEqual(captain.words);
    expect(member.owners).toEqual(captain.owners);
    expect([captain.showAll, member.showAll]).toEqual([true, false]);
    const n = (o: string) => captain.owners.filter((x) => x === o).length;
    expect([n("red") + n("blue"), n("neutral"), n("trap")]).toEqual([17, 7, 1]);
  });

  it("codebreak: teams hold different keywords that stay put, and codes change", () => {
    const words = (team: 0 | 1, round: number) =>
      text(deal("codebreak", { team, round }).filter((b) => b.kind === "list"));
    expect(words(0, 1)).toBe(words(0, 5));
    expect(
      words(0, 1)
        .split(",")
        .some((w) => words(1, 1).split(",").includes(w)),
    ).toBe(false);
    const codes = new Set(Array.from({ length: 8 }, (_, k) => secret(deal("codebreak", { round: k + 1 }))));
    expect(codes.size).toBeGreaterThan(1);
    for (const c of codes) expect(new Set(c.split(" - ")).size).toBe(3);
  });
});
