import { bundledContent, games } from "@apr/games";

export const GAME_COUNT = Object.keys(games).length;

/** Where the bundled content comes from, largest first, for the credits on the landing page. */
export const CREDITS = [
  ...bundledContent.reduce((m, c) => m.set(c.source, (m.get(c.source) ?? 0) + 1), new Map<string, number>()),
]
  .map(([source, count]) => ({ source, count }))
  .sort((a, b) => b.count - a.count);
