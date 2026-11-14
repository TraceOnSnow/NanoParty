/** Test helpers for game modules. Not used at runtime. */
import type { Actor, ContentItem, GameContext, GameModule, GameResult } from "@apr/shared";

export function makeCtx(players: string[], payloads: unknown[], random: () => number = () => 0.9): GameContext {
  const pool: ContentItem[] = payloads.map((payload, i) => ({
    id: `c${i + 1}`,
    version: 1,
    type: "t",
    theme: "t",
    payload,
  }));
  return { now: 1000, random, players, drawContent: () => pool.shift() ?? null };
}

export const as = (playerId: string, isHost = false): Actor => ({ kind: "player", playerId, isHost });
export const host = as("a", true);

export function must<S>(r: GameResult<S>) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

/** Drives one game: keeps the latest state and fills in the current `step` on every action. */
// biome-ignore lint/suspicious/noExplicitAny: generic over every game's action shape
export class Table<S extends { step: number }, A = any, V = unknown> {
  state: S;
  scores: { playerId: string; points: number; key: string }[] = [];
  finished = false;

  constructor(
    readonly game: GameModule<S, A, V, unknown>,
    readonly ctx: GameContext,
    config: Record<string, number> = {},
  ) {
    this.state = must(game.setup(game.configSchema.parse(config), ctx)).state;
  }

  /** Applies an action for the current step; throws if the game rejects it. */
  do(actor: Actor, action: Record<string, unknown>) {
    const r = must(this.try(actor, action));
    this.state = r.state;
    this.scores.push(...(r.scores ?? []));
    this.finished = r.finished ?? false;
    return r;
  }

  /** Applies an action to a copy; never changes the table. */
  try(actor: Actor, action: Record<string, unknown>) {
    return this.game.apply(structuredClone(this.state), { step: this.state.step, ...action } as A, actor, this.ctx);
  }

  rejects(actor: Actor, action: Record<string, unknown>): boolean {
    return !this.try(actor, action).ok;
  }

  timeout() {
    const r = must(this.game.onTimeout?.(structuredClone(this.state), this.ctx) as GameResult<S>);
    this.state = r.state;
    this.scores.push(...(r.scores ?? []));
    return r;
  }

  view(player: string): V {
    return this.game.view(this.state, player);
  }

  /** Everything a player's client would receive, as text, for leak checks. */
  wire(player: string): string {
    return JSON.stringify(this.view(player)) + this.game.publicSummary(this.state);
  }

  points(player: string): number {
    return this.scores.filter((s) => s.playerId === player).reduce((sum, s) => sum + s.points, 0);
  }
}
