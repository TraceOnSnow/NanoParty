/**
 * Dynamic Canvas: a small set of interaction primitives that the AI host (or the program)
 * composes at runtime. The spec is declarative data, validated by the server; there is no
 * free-form layout and no executable content.
 */
import { z } from "zod";
import type { PlayerId } from "./game.ts";

const base = {
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  /** Who may respond: everyone in the room, or specific player ids. */
  audience: z.union([z.literal("all"), z.array(z.string()).min(1).max(8)]).default("all"),
};

export const collectSpec = z.object({
  kind: z.literal("collect"),
  ...base,
  placeholder: z.string().max(40).optional(),
  maxLength: z.number().int().min(1).max(80).default(40),
});

export const chooseSpec = z.object({
  kind: z.literal("choose"),
  ...base,
  /** With several responders this is a vote; with one responder it is a pick. */
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().min(1).max(60),
        detail: z.string().max(120).optional(),
      }),
    )
    .min(2)
    .max(10),
});

export const showSpec = z.object({
  kind: z.literal("show"),
  title: base.title,
  description: base.description,
  items: z
    .array(z.object({ label: z.string().min(1).max(60), detail: z.string().max(160).optional() }))
    .max(10)
    .default([]),
});

/** Specs the AI host may create directly. `confirm` is only created by the program, around an effect. */
export const agentInteractionSpec = z.discriminatedUnion("kind", [collectSpec, chooseSpec, showSpec]);
export type AgentInteractionSpec = z.infer<typeof agentInteractionSpec>;

/**
 * A change that needs someone's approval. It is stored with the confirm interaction and executed
 * by the program when approved — the model is not asked again.
 */
export type CanvasEffect = { type: "startGame"; gameId: string; config: Record<string, number> };

export type InteractionSpec =
  | AgentInteractionSpec
  | { kind: "confirm"; title: string; description?: string; audience: PlayerId[]; effect: CanvasEffect };

export type InteractionResult =
  | { kind: "collect"; entries: { playerId: PlayerId; text: string }[] }
  | { kind: "choose"; tally: { id: string; label: string; voters: PlayerId[] }[]; winners: string[] }
  | { kind: "confirm"; approved: boolean; outcome: string }
  | { kind: "show" };

/** What a player sees of an interaction. */
export interface InteractionView {
  id: string;
  kind: InteractionSpec["kind"];
  title: string;
  description?: string;
  placeholder?: string;
  maxLength?: number;
  options?: { id: string; label: string; detail?: string }[];
  items?: { label: string; detail?: string }[];
  /** Program-generated description of what approving will do (confirm only). */
  effectSummary?: string;
  responders: PlayerId[];
  responded: PlayerId[];
  canRespond: boolean;
  myResponse: string | boolean | null;
  status: "open" | "closed";
  result: InteractionResult | null;
}

export interface CanvasView {
  /** The interaction currently on screen, or the most recently closed one until dismissed. */
  current: InteractionView | null;
  /** Interactions waiting for a safe point (between rounds). */
  queued: number;
}
