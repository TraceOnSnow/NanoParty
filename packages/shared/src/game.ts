/**
 * Game kernel contract.
 *
 * A game is a set of pure, deterministic functions over a JSON-serialisable state.
 * The server runtime owns everything else: identity, permissions at room level,
 * persistence, timers, content supply and score bookkeeping. Game modules never
 * touch the network, the database or an LLM.
 */
import type { z } from "zod";

export type PlayerId = string;

/** A piece of reusable content (question, word pair...). Payload shape is defined per content type. */
export interface ContentItem<P = unknown> {
  id: string;
  version: number;
  type: string;
  theme: string;
  payload: P;
}

/** Everything non-deterministic or external is injected through the context. */
export interface GameContext {
  /** Epoch milliseconds. */
  now: number;
  /** Uniform random in [0, 1). */
  random: () => number;
  /** Current room members who may take part (used for safe-point joining). */
  players: PlayerId[];
  /** Draws the next unused content item for this segment, or null when the pool is exhausted. */
  drawContent: () => ContentItem | null;
}

export type Actor = { kind: "player"; playerId: PlayerId; isHost: boolean } | { kind: "system" };

/**
 * A score award. `key` must be unique and stable within one game segment
 * (e.g. "r3:closest:<playerId>"): the ledger ignores a second award with the same key,
 * which makes settlement idempotent across retries and restarts.
 */
export interface ScoreAward {
  playerId: PlayerId;
  points: number;
  reason: string;
  key: string;
}

export type GameResult<S> =
  | { ok: true; state: S; scores?: ScoreAward[]; finished?: boolean }
  | { ok: false; error: string };

export interface GameMeta {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Fixed rule summary shown before starting; works without AI. */
  rulesSummary: string;
  scoringSummary: string;
  /** Content type consumed from the content library, if any. */
  contentType?: string;
  /** Numeric settings the host may change before starting. Keys match the config schema. */
  options?: GameOption[];
}

export interface GameOption {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  hint?: string;
}

/**
 * Vote-to-skip support. The runtime owns the voting (who voted, threshold); the game only
 * says what is currently skippable, who is entitled to vote on it, and how to skip it.
 */
export interface SkipSupport<S> {
  /** Stable id of the item that can be skipped right now, or null when nothing can. */
  key(state: S): string | null;
  voters(state: S): PlayerId[];
  /** Skips the current item without awarding anything. */
  apply(state: S, ctx: GameContext): GameResult<S>;
}

export interface GameModule<S = unknown, A = unknown, V = unknown, C = unknown> {
  meta: GameMeta;
  configSchema: z.ZodType<C>;
  actionSchema: z.ZodType<A>;
  /** Creates the initial state. May fail (e.g. no content available). */
  setup(config: C, ctx: GameContext): GameResult<S>;
  /**
   * Applies one action. `state` is a private copy and may be mutated and returned.
   * Must validate phase, turn, actor and round binding itself.
   */
  apply(state: S, action: A, actor: Actor, ctx: GameContext): GameResult<S>;
  /** Absolute deadline (epoch ms) of the current phase, or null. The runtime schedules the timer. */
  deadline?(state: S): number | null;
  /** Called by the runtime when the deadline passes. */
  onTimeout?(state: S, ctx: GameContext): GameResult<S>;
  /** Called when a paused segment is resumed (e.g. after a server restart) to rebase timers. */
  onResume?(state: S, ctx: GameContext): S;
  /** What one player may see. MUST NOT contain other players' secrets or unrevealed answers. */
  view(state: S, viewer: PlayerId): V;
  skip?: SkipSupport<S>;
  /** Id of the content item currently on screen, for feedback. */
  currentContentId?(state: S): string | null;
  /** Public, secret-free description of the current situation, used as AI host context. */
  publicSummary(state: S): string;
}

/** Helper that keeps generic inference while erasing types for the registry. */
export function defineGame<S, A, V, C>(module: GameModule<S, A, V, C>): GameModule<S, A, V, C> {
  return module;
}
