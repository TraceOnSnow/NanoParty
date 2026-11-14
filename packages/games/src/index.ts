import type { ContentItem, GameModule } from "@apr/shared";
import estimateContent from "./estimate/content.json" with { type: "json" };
import { estimateGame } from "./estimate/game.ts";
import spectrumContent from "./spectrum/content.json" with { type: "json" };
import { spectrumGame } from "./spectrum/game.ts";
import undercoverContent from "./undercover/content.json" with { type: "json" };
import { undercoverGame } from "./undercover/game.ts";

export * from "./estimate/game.ts";
export * from "./spectrum/game.ts";
export * from "./undercover/game.ts";

/** Content shipped with the repo; seeded into the content library at server start. */
export interface BundledContent extends ContentItem {
  source: string;
  verification: "unverified" | "verified";
}

/**
 * Registry of implemented games. Adding a game = adding a module here
 * (plus its UI in apps/web/src/games). The AI host can only refer to games listed here.
 */
// biome-ignore lint/suspicious/noExplicitAny: the registry erases per-game generics on purpose
export const games: Record<string, GameModule<any, any, any, any>> = {
  [spectrumGame.meta.id]: spectrumGame,
  [undercoverGame.meta.id]: undercoverGame,
  [estimateGame.meta.id]: estimateGame,
};

export const bundledContent: BundledContent[] = [
  ...(spectrumContent as BundledContent[]),
  ...(undercoverContent as BundledContent[]),
  ...(estimateContent as BundledContent[]),
];
