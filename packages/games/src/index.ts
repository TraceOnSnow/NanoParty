import type { ContentItem, GameModule } from "@apr/shared";
import bluffContent from "./bluff/content.json" with { type: "json" };
import { bluffGame } from "./bluff/game.ts";
import categoriesContent from "./categories/content.json" with { type: "json" };
import { categoriesGame } from "./categories/game.ts";
import estimateContent from "./estimate/content.json" with { type: "json" };
import { estimateGame } from "./estimate/game.ts";
import mostlikelyContent from "./mostlikely/content.json" with { type: "json" };
import { mostLikelyGame } from "./mostlikely/game.ts";
import oneclueContent from "./oneclue/content.json" with { type: "json" };
import { oneClueGame } from "./oneclue/game.ts";
import quipContent from "./quip/content.json" with { type: "json" };
import { quipGame } from "./quip/game.ts";
import rankingContent from "./ranking/content.json" with { type: "json" };
import { rankingGame } from "./ranking/game.ts";
import { rowCardsGame } from "./rowcards/game.ts";
import spectrumContent from "./spectrum/content.json" with { type: "json" };
import { spectrumGame } from "./spectrum/game.ts";
import undercoverContent from "./undercover/content.json" with { type: "json" };
import { undercoverGame } from "./undercover/game.ts";
import { wagerGame } from "./wager/game.ts";

export * from "./bluff/game.ts";
export * from "./categories/game.ts";
export * from "./estimate/game.ts";
export * from "./mostlikely/game.ts";
export * from "./oneclue/game.ts";
export * from "./quip/game.ts";
export * from "./ranking/game.ts";
export * from "./rowcards/game.ts";
export * from "./spectrum/game.ts";
export * from "./undercover/game.ts";
export * from "./wager/game.ts";

/** Content shipped with the repo; seeded into the content library at server start. */
export interface BundledContent extends ContentItem {
  source: string;
  verification: "unverified" | "verified";
}

/**
 * Registry of implemented games, in lobby order. Adding a game = adding a module here
 * (plus its UI in apps/web/src/games). The AI host can only refer to games listed here.
 */
// biome-ignore lint/suspicious/noExplicitAny: the registry erases per-game generics on purpose
export const games: Record<string, GameModule<any, any, any, any>> = {
  [spectrumGame.meta.id]: spectrumGame,
  [undercoverGame.meta.id]: undercoverGame,
  [categoriesGame.meta.id]: categoriesGame,
  [rankingGame.meta.id]: rankingGame,
  [bluffGame.meta.id]: bluffGame,
  [wagerGame.meta.id]: wagerGame,
  [mostLikelyGame.meta.id]: mostLikelyGame,
  [quipGame.meta.id]: quipGame,
  [oneClueGame.meta.id]: oneClueGame,
  [rowCardsGame.meta.id]: rowCardsGame,
  [estimateGame.meta.id]: estimateGame,
};

export const bundledContent: BundledContent[] = [
  ...(spectrumContent as BundledContent[]),
  ...(undercoverContent as BundledContent[]),
  ...(categoriesContent as BundledContent[]),
  ...(rankingContent as BundledContent[]),
  ...(bluffContent as BundledContent[]),
  ...(mostlikelyContent as BundledContent[]),
  ...(quipContent as BundledContent[]),
  ...(oneclueContent as BundledContent[]),
  ...(estimateContent as BundledContent[]),
];
