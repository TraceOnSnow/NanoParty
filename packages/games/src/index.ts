import type { ContentItem, GameModule } from "@apr/shared";
import { blatherGame } from "./blather/game.ts";
import bluffContent from "./bluff/content.json" with { type: "json" };
import bluffNet from "./bluff/content.net.json" with { type: "json" };
import { bluffGame } from "./bluff/game.ts";
import categoriesContent from "./categories/content.json" with { type: "json" };
import categoriesNet from "./categories/content.net.json" with { type: "json" };
import { categoriesGame } from "./categories/game.ts";
import { climbGame } from "./climb/game.ts";
import { cloverGame } from "./clover/game.ts";
import { codeBreakGame } from "./codebreak/game.ts";
import { crewGame } from "./crew/game.ts";
import { delveGame } from "./delve/game.ts";
import { duelGame } from "./duel/game.ts";
import { echoGame } from "./echo/game.ts";
import estimateContent from "./estimate/content.json" with { type: "json" };
import estimateNet from "./estimate/content.net.json" with { type: "json" };
import { estimateGame } from "./estimate/game.ts";
import { flipoutGame } from "./flipout/game.ts";
import { flushGame } from "./flush/game.ts";
import { liarGame } from "./liar/game.ts";
import mostlikelyContent from "./mostlikely/content.json" with { type: "json" };
import mostlikelyNet from "./mostlikely/content.net.json" with { type: "json" };
import { mostLikelyGame } from "./mostlikely/game.ts";
import { noThanksGame } from "./nothanks/game.ts";
import oneclueContent from "./oneclue/content.json" with { type: "json" };
import oneclueNet from "./oneclue/content.net.json" with { type: "json" };
import { oneClueGame } from "./oneclue/game.ts";
import percentContent from "./percent/content.json" with { type: "json" };
import percentNet from "./percent/content.net.json" with { type: "json" };
import { percentGame } from "./percent/game.ts";
import platterContent from "./platter/content.json" with { type: "json" };
import { platterGame } from "./platter/game.ts";
import pollmineContent from "./pollmine/content.json" with { type: "json" };
import pollmineNet from "./pollmine/content.net.json" with { type: "json" };
import { pollMineGame } from "./pollmine/game.ts";
import quipContent from "./quip/content.json" with { type: "json" };
import quipNet from "./quip/content.net.json" with { type: "json" };
import { quipGame } from "./quip/game.ts";
import rankingContent from "./ranking/content.json" with { type: "json" };
import rankingNet from "./ranking/content.net.json" with { type: "json" };
import { rankingGame } from "./ranking/game.ts";
import { rowCardsGame } from "./rowcards/game.ts";
import sevenContent from "./seven/content.json" with { type: "json" };
import { sevenGame } from "./seven/game.ts";
import { skullGame } from "./skull/game.ts";
import soupImported from "./soup/content.imported.json" with { type: "json" };
import soupContent from "./soup/content.json" with { type: "json" };
import soupNet from "./soup/content.net.json" with { type: "json" };
import { soupGame } from "./soup/game.ts";
import spectrumContent from "./spectrum/content.json" with { type: "json" };
import spectrumNet from "./spectrum/content.net.json" with { type: "json" };
import { spectrumGame } from "./spectrum/game.ts";
import { spellGame } from "./spell/game.ts";
import splitContent from "./split/content.json" with { type: "json" };
import splitNet from "./split/content.net.json" with { type: "json" };
import { splitGame } from "./split/game.ts";
import { syncGame } from "./sync/game.ts";
import tabooContent from "./taboo/content.json" with { type: "json" };
import tabooNet from "./taboo/content.net.json" with { type: "json" };
import { tabooGame } from "./taboo/game.ts";
import undercoverImported from "./undercover/content.imported.json" with { type: "json" };
import undercoverContent from "./undercover/content.json" with { type: "json" };
import undercoverNet from "./undercover/content.net.json" with { type: "json" };
import { undercoverGame } from "./undercover/game.ts";
import { wagerGame } from "./wager/game.ts";
import { wordGridGame } from "./wordgrid/game.ts";
import { wordHuntGame } from "./wordhunt/game.ts";

export * from "./blather/game.ts";
export * from "./bluff/game.ts";
export * from "./bots.ts";
export * from "./categories/game.ts";
export * from "./climb/game.ts";
export * from "./clover/game.ts";
export * from "./codebreak/game.ts";
export * from "./contentTypes.ts";
export * from "./crew/game.ts";
export * from "./delve/game.ts";
export * from "./duel/game.ts";
export * from "./echo/game.ts";
export * from "./estimate/game.ts";
export * from "./flipout/game.ts";
export * from "./flush/game.ts";
export * from "./liar/game.ts";
export * from "./mostlikely/game.ts";
export * from "./nothanks/game.ts";
export * from "./oneclue/game.ts";
export * from "./percent/game.ts";
export * from "./platter/game.ts";
export * from "./pollmine/game.ts";
export * from "./quip/game.ts";
export * from "./ranking/game.ts";
export * from "./rowcards/game.ts";
export * from "./seven/game.ts";
export * from "./skull/game.ts";
export * from "./soup/adapt.ts";
export * from "./soup/game.ts";
export * from "./spectrum/game.ts";
export * from "./spell/game.ts";
export * from "./split/game.ts";
export * from "./sync/game.ts";
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
  [platterGame.meta.id]: platterGame,
  [sevenGame.meta.id]: sevenGame,
  [climbGame.meta.id]: climbGame,
  [flipoutGame.meta.id]: flipoutGame,
  [spellGame.meta.id]: spellGame,
  [echoGame.meta.id]: echoGame,
  [syncGame.meta.id]: syncGame,
  [delveGame.meta.id]: delveGame,
  [liarGame.meta.id]: liarGame,
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
  ...(platterContent as BundledContent[]),
  ...(sevenContent as BundledContent[]),
  // Wider packs written for the project (content.net.json) and lists by other people, each item
  // naming where it came from (content.imported.json; see docs/content-sources.md).
  ...(oneclueNet as BundledContent[]),
  ...(tabooNet as BundledContent[]),
  ...(undercoverNet as BundledContent[]),
  ...(estimateNet as BundledContent[]),
  ...(quipNet as BundledContent[]),
  ...(mostlikelyNet as BundledContent[]),
  ...(splitNet as BundledContent[]),
  ...(pollmineNet as BundledContent[]),
  ...(percentNet as BundledContent[]),
  ...(spectrumNet as BundledContent[]),
  ...(rankingNet as BundledContent[]),
  ...(categoriesNet as BundledContent[]),
  ...(bluffNet as BundledContent[]),
  ...(soupNet as BundledContent[]),
  ...(soupImported as BundledContent[]),
  ...(undercoverImported as BundledContent[]),
];

export { retiredContentIds } from "./retired.ts";
