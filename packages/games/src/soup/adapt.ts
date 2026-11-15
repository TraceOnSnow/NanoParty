/**
 * Themed adaptation of a soup puzzle, done by the program, not by free rewriting.
 *
 * A model may only PROPOSE word swaps; this module decides whether they are allowed and applies
 * them itself to the surface, the solution and the key facts at once, so the three can never
 * drift apart. Only words the puzzle lists as `adaptable` (names, places — dressing) may change;
 * words listed as `fixed` (what the logic depends on) must come out untouched. Anything else is
 * rejected and the original puzzle is used.
 */
import type { SoupPuzzle } from "./game.ts";

export interface Replacement {
  from: string;
  to: string;
}

export type AdaptResult = { ok: true; puzzle: SoupPuzzle } | { ok: false; reason: string };

const count = (text: string, word: string) => text.split(word).length - 1;

export function adaptPuzzle(original: SoupPuzzle, replacements: Replacement[], basedOn?: string): AdaptResult {
  const adaptable = original.adaptable ?? [];
  const fixed = original.fixed ?? [];
  if (adaptable.length === 0) return { ok: false, reason: "这道题没有可以替换的词" };
  if (replacements.length === 0) return { ok: false, reason: "没有给出替换" };
  const texts = [original.surface, original.solution, ...(original.facts ?? [])];
  const whole = texts.join("\n");
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  for (const { from, to } of replacements) {
    if (!adaptable.includes(from)) return { ok: false, reason: `「${from}」不在可替换词里` };
    if (seenFrom.has(from)) return { ok: false, reason: `「${from}」被替换了两次` };
    seenFrom.add(from);
    const word = to.trim();
    if (word.length === 0 || word.length > 12) return { ok: false, reason: "替换词要在 1–12 个字之间" };
    if (/[\s，。！？、；：,.!?;:"'「」（）()]/.test(word))
      return { ok: false, reason: `替换词「${word}」不能带标点或空白` };
    if (word === from) return { ok: false, reason: `「${from}」没有变化` };
    if (seenTo.has(word)) return { ok: false, reason: `「${word}」被用了两次` };
    seenTo.add(word);
    // A new word must not collide with the story's own words or smuggle in a logic word.
    if (whole.includes(word)) return { ok: false, reason: `「${word}」已经出现在原题里` };
    if (fixed.some((f) => word.includes(f) || f.includes(word))) {
      return { ok: false, reason: `「${word}」碰到了不能改的关键词` };
    }
  }
  const swap = (text: string) => replacements.reduce((out, { from, to }) => out.split(from).join(to.trim()), text);
  const surface = swap(original.surface);
  const solution = swap(original.solution);
  // The logic words must survive exactly as they were.
  for (const f of fixed) {
    if (count(surface, f) !== count(original.surface, f) || count(solution, f) !== count(original.solution, f)) {
      return { ok: false, reason: `替换改动了关键词「${f}」` };
    }
  }
  if (surface.length > 200 || solution.length > 400) return { ok: false, reason: "改编后太长" };
  return {
    ok: true,
    puzzle: {
      surface,
      solution,
      facts: (original.facts ?? []).map(swap),
      fixed,
      adaptable: adaptable.map((a) => replacements.find((r) => r.from === a)?.to.trim() ?? a),
      ...(basedOn ? { basedOn } : {}),
    },
  };
}
