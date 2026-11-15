import type { ContentItem, GameModule } from "@apr/shared";
import { blatherGame } from "./blather/game.ts";
import bluffContent from "./bluff/content.json" with { type: "json" };
import { bluffGame } from "./bluff/game.ts";
import categoriesContent from "./categories/content.json" with { type: "json" };
import { categoriesGame } from "./categories/game.ts";
import { cloverGame } from "./clover/game.ts";
import { codeBreakGame } from "./codebreak/game.ts";
import { crewGame } from "./crew/game.ts";
import { duelGame } from "./duel/game.ts";
import estimateContent from "./estimate/content.json" with { type: "json" };
import { estimateGame } from "./estimate/game.ts";
import { flushGame } from "./flush/game.ts";
import mostlikelyContent from "./mostlikely/content.json" with { type: "json" };
import { mostLikelyGame } from "./mostlikely/game.ts";
import { noThanksGame } from "./nothanks/game.ts";
import oneclueContent from "./oneclue/content.json" with { type: "json" };
import { oneClueGame } from "./oneclue/game.ts";
import percentContent from "./percent/content.json" with { type: "json" };
import { percentGame } from "./percent/game.ts";
import pollmineContent from "./pollmine/content.json" with { type: "json" };
import { pollMineGame } from "./pollmine/game.ts";
import quipContent from "./quip/content.json" with { type: "json" };
import { quipGame } from "./quip/game.ts";
import rankingContent from "./ranking/content.json" with { type: "json" };
import { rankingGame } from "./ranking/game.ts";
import { rowCardsGame } from "./rowcards/game.ts";
import { skullGame } from "./skull/game.ts";
import soupContent from "./soup/content.json" with { type: "json" };
import { soupGame } from "./soup/game.ts";
import spectrumContent from "./spectrum/content.json" with { type: "json" };
import { spectrumGame } from "./spectrum/game.ts";
import splitContent from "./split/content.json" with { type: "json" };
import { splitGame } from "./split/game.ts";
import tabooContent from "./taboo/content.json" with { type: "json" };
import { tabooGame } from "./taboo/game.ts";
import undercoverContent from "./undercover/content.json" with { type: "json" };
import { undercoverGame } from "./undercover/game.ts";
import { wagerGame } from "./wager/game.ts";
import { wordGridGame } from "./wordgrid/game.ts";
import { wordHuntGame } from "./wordhunt/game.ts";

export * from "./blather/game.ts";
export * from "./bluff/game.ts";
export * from "./bots.ts";
export * from "./categories/game.ts";
export * from "./clover/game.ts";
export * from "./codebreak/game.ts";
export * from "./contentTypes.ts";
export * from "./crew/game.ts";
export * from "./duel/game.ts";
export * from "./estimate/game.ts";
export * from "./flush/game.ts";
export * from "./mostlikely/game.ts";
export * from "./nothanks/game.ts";
export * from "./oneclue/game.ts";
export * from "./percent/game.ts";
export * from "./pollmine/game.ts";
export * from "./quip/game.ts";
export * from "./ranking/game.ts";
export * from "./rowcards/game.ts";
export * from "./skull/game.ts";
export * from "./soup/game.ts";
export * from "./spectrum/game.ts";
export * from "./split/game.ts";
export * from "./taboo/game.ts";
export * from "./undercover/game.ts";
export * from "./wager/game.ts";
export * from "./wordgrid/game.ts";
export * from "./wordhunt/game.ts";
export * from "./words.ts";

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
  [soupGame.meta.id]: soupGame,
  [splitGame.meta.id]: splitGame,
  [wordHuntGame.meta.id]: wordHuntGame,
  [crewGame.meta.id]: crewGame,
  [skullGame.meta.id]: skullGame,
  [noThanksGame.meta.id]: noThanksGame,
  [flushGame.meta.id]: flushGame,
  [duelGame.meta.id]: duelGame,
  [wordGridGame.meta.id]: wordGridGame,
  [codeBreakGame.meta.id]: codeBreakGame,
  [tabooGame.meta.id]: tabooGame,
  [blatherGame.meta.id]: blatherGame,
  [cloverGame.meta.id]: cloverGame,
  [pollMineGame.meta.id]: pollMineGame,
  [percentGame.meta.id]: percentGame,
  [estimateGame.meta.id]: estimateGame,
};

export const bundledContent: BundledContent[] = [
  ...(soupContent as BundledContent[]),
  ...(splitContent as BundledContent[]),
  ...(spectrumContent as BundledContent[]),
  ...(undercoverContent as BundledContent[]),
  ...(categoriesContent as BundledContent[]),
  ...(rankingContent as BundledContent[]),
  ...(bluffContent as BundledContent[]),
  ...(mostlikelyContent as BundledContent[]),
  ...(quipContent as BundledContent[]),
  ...(oneclueContent as BundledContent[]),
  ...(percentContent as BundledContent[]),
  ...(pollmineContent as BundledContent[]),
  ...(tabooContent as BundledContent[]),
  ...(estimateContent as BundledContent[]),
];
