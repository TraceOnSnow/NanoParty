/** Small helpers shared by game modules. Pure; no IO. */
import type { GameContext, PlayerId } from "@apr/shared";
import type { z } from "zod";

/** Absolute deadline for a phase, or null when the phase is untimed (seconds = 0). */
export const timer = (seconds: number, ctx: GameContext) => (seconds > 0 ? ctx.now + seconds * 1000 : null);

/** Draws content until an item matches the expected payload shape. */
export function drawPayload<T>(ctx: GameContext, schema: z.ZodType<T>): { contentId: string; data: T } | null {
  for (let item = ctx.drawContent(); item; item = ctx.drawContent()) {
    const parsed = schema.safeParse(item.payload);
    if (parsed.success) return { contentId: item.id, data: parsed.data };
  }
  return null;
}

/** Fisher–Yates with the injected RNG. Returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Normalises free text for equality checks (duplicates, matching a target word). */
export const norm = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");

/** Players who chose each option, keyed by option. */
export function groupVotes<K extends string | number>(votes: Record<PlayerId, K>): Map<K, PlayerId[]> {
  const out = new Map<K, PlayerId[]>();
  for (const [voter, choice] of Object.entries(votes) as [PlayerId, K][]) {
    out.set(choice, [...(out.get(choice) ?? []), voter]);
  }
  return out;
}

export const roundsOption = (def: number, label = "轮数") => ({
  key: "rounds",
  label,
  min: 0,
  max: 30,
  default: def,
  hint: "0 = 不限",
});
export const secondsOption = (key: string, label: string, def: number) => ({
  key,
  label: `${label}（秒）`,
  min: 0,
  max: 600,
  default: def,
  hint: "0 = 不限时",
});
