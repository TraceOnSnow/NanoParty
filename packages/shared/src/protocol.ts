/**
 * Wire protocol between web client and server (REST + realtime messages).
 * Client -> server payloads are validated with zod on the server.
 */
import { z } from "zod";
import type { CanvasView } from "./canvas.ts";
import type { GameMeta, PlayerId } from "./game.ts";
import type { SettlementRow } from "./scoring.ts";

export const NICKNAME_MAX = 20;
export const CHAT_MAX = 500;

export const nicknameSchema = z.string().trim().min(1).max(NICKNAME_MAX);

// ---------- REST ----------

export const createRoomRequest = z.object({
  adminPassword: z.string().min(1),
  roomName: z.string().trim().min(1).max(40),
  nickname: nicknameSchema,
});
export type CreateRoomRequest = z.infer<typeof createRoomRequest>;

export const joinRoomRequest = z.object({
  inviteToken: z.string().min(1),
  nickname: nicknameSchema,
});
export type JoinRoomRequest = z.infer<typeof joinRoomRequest>;

/** Returned by create/join. `sessionToken` is the player's reconnect credential; keep it private. */
export interface JoinResponse {
  roomId: string;
  playerId: PlayerId;
  sessionToken: string;
}

export interface InviteInfo {
  roomName: string;
}

export interface ApiError {
  error: string;
}

// ---------- Realtime: client -> server ----------

export const MSG = {
  chat: "chat",
  command: "cmd",
  view: "view",
  chatHistory: "chat:history",
  chatMessage: "chat:message",
} as const;

export const chatRequest = z.object({
  text: z.string().trim().min(1).max(CHAT_MAX),
  /** "Send and ask the AI": posts the message and triggers the host agent once. */
  askAi: z.boolean().optional(),
});

/** In-place feedback about what is on screen. */
export const playFeedbackKind = z.enum([
  "unclear",
  "wrong-answer",
  "not-interested",
  "too-hard",
  "ai-judgement",
  "ui-flow",
]);
export type PlayFeedbackKind = z.infer<typeof playFeedbackKind>;

export const feedbackKind = z.enum(["not-interested", "too-hard", "unclear", "wrong-answer"]);
export type FeedbackKind = z.infer<typeof feedbackKind>;

export const hostMode = z.enum(["normal", "quirky"]);
export type HostMode = z.infer<typeof hostMode>;
const prefText = z.string().trim().max(120);
/** What the host can set. All fields optional: only the given ones change. */
export const partyPrefsInput = z.object({
  hostMode: hostMode.optional(),
  /** What the group knows well (e.g. games, shows). */
  familiar: prefText.optional(),
  /** What they feel like playing today. */
  want: prefText.optional(),
  /** What should not come up. */
  avoid: prefText.optional(),
  difficulty: z.enum(["easy", "normal", "hard"]).optional(),
});

export interface PartyPrefs {
  hostMode: HostMode;
  familiar: string;
  want: string;
  avoid: string;
  difficulty: "easy" | "normal" | "hard";
  /** Members' suggestions, one per player, for the host to take into account. */
  suggestions: { playerId: PlayerId; text: string }[];
}

export const DEFAULT_PREFS: PartyPrefs = {
  // The friends' playtest is about the quirky host; it can be switched at any time.
  hostMode: "quirky",
  familiar: "",
  want: "",
  avoid: "",
  difficulty: "normal",
  suggestions: [],
};

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("startGame"), gameId: z.string(), config: z.unknown().optional() }),
  /** `segmentId` binds the action to one game segment so late/retried actions cannot hit a newer one. */
  z.object({ type: z.literal("gameAction"), segmentId: z.string(), action: z.unknown() }),
  /**
   * Host. settle = end the game and go to the settlement screen with the results so far;
   * abandon = drop it without party points. (Omitted mode = settle.)
   */
  z.object({ type: z.literal("endSegment"), segmentId: z.string(), mode: z.enum(["settle", "abandon"]).optional() }),
  /**
   * Host: credit the settled game's party points once. `adjustmentId` = also apply this pending
   * proposal; null = default result only (a pending proposal is then dropped).
   */
  z.object({ type: z.literal("confirmSettlement"), segmentId: z.string(), adjustmentId: z.string().nullable() }),
  /** Host: propose a party-point adjustment by hand (no AI needed). Points may be negative. */
  z.object({
    type: z.literal("proposeAdjustment"),
    items: z
      .array(z.object({ playerId: z.string(), points: z.number() }))
      .min(1)
      .max(8),
    reason: z.string().trim().min(1).max(200),
    /** A settled game this corrects; omitted = applies to the game being settled, or to the party. */
    segmentId: z.string().optional(),
  }),
  /** Host: approve (lobby: credits it now) or cancel a pending proposal. */
  z.object({ type: z.literal("decideAdjustment"), adjustmentId: z.string(), approve: z.boolean() }),
  /** Host: party preferences. Does not touch scores, identities or topics already confirmed. */
  z.object({ type: z.literal("setPrefs"), prefs: partyPrefsInput }),
  /** Anyone: add (or replace) their own suggestion for the party's preferences. */
  z.object({ type: z.literal("suggestPrefs"), text: z.string().trim().max(120) }),
  z.object({ type: z.literal("transferHost"), playerId: z.string() }),
  /** Host: try the AI recap of an ended party again. */
  z.object({ type: z.literal("retrySummary"), sessionId: z.string() }),
  z.object({ type: z.literal("resumeSegment"), segmentId: z.string() }),
  z.object({ type: z.literal("askAgent"), kind: z.literal("recommend") }),
  z.object({ type: z.literal("dismissSuggestion") }),
  /** `key` binds the vote to the item on screen; a vote for an earlier item is rejected. */
  z.object({ type: z.literal("voteSkip"), segmentId: z.string(), key: z.string() }),
  z.object({ type: z.literal("contentFeedback"), segmentId: z.string(), contentId: z.string(), kind: feedbackKind }),
  /** `entryId` points at one item of the game's log (e.g. a judged question). */
  z.object({
    type: z.literal("feedback"),
    kind: playFeedbackKind,
    note: z.string().trim().max(300).optional(),
    entryId: z.number().int().optional(),
  }),
  /** Picker or host, while a soup is being chosen: adapt the candidates to a theme. */
  z.object({ type: z.literal("adaptContent"), segmentId: z.string(), theme: z.string().trim().min(1).max(40) }),
  /** `discardPending` = knowingly drop adjustment proposals that were never confirmed. */
  z.object({ type: z.literal("endSession"), discardPending: z.boolean().optional() }),
  z.object({ type: z.literal("rotateInvite") }),
  z.object({ type: z.literal("removeMember"), playerId: z.string() }),
  /** Response to a Canvas interaction: text (collect), option id (choose) or approval (confirm). */
  z.object({
    type: z.literal("respond"),
    interactionId: z.string(),
    value: z.union([z.string().max(80), z.boolean()]),
  }),
  /** Host: close an open interaction with the responses received so far, or dismiss a closed one. */
  z.object({ type: z.literal("closeInteraction"), interactionId: z.string() }),
]);
export type Command = z.infer<typeof commandSchema>;

/** `cmdId` is a client-generated id; resending the same id never executes the command twice. */
export const commandEnvelope = z.object({ cmdId: z.string().min(8).max(64), command: commandSchema });
export type CommandEnvelope = z.infer<typeof commandEnvelope>;

export type Ack = { ok: true } | { ok: false; error: string };

// ---------- Realtime: server -> client ----------

export interface MemberView {
  id: PlayerId;
  nickname: string;
  isHost: boolean;
  connected: boolean;
}

export interface ScoreEntry {
  playerId: PlayerId;
  /** May be fractional (shared placements) and negative (approved adjustments). */
  points: number;
}

export interface AdjustmentView {
  id: string;
  items: { playerId: PlayerId; tenths: number }[];
  reason: string;
  /** "agent", "host" or the nickname of whoever asked for it. */
  proposedBy: string;
  segmentId: string | null;
}

/** A finished game waiting for the host to confirm its party points. */
export interface SettlementView {
  segmentId: string;
  gameId: string;
  gameName: string;
  endedReason: "finished" | "ended";
  rows: SettlementRow[];
  note: string | null;
}

export interface PartyInfo {
  sessionId: string;
  /** 1-based number of this party in the room. */
  number: number;
  /** raw-v1 = legacy party scored by adding raw game points. */
  scoring: "raw-v1" | "rank-v1";
  gamesPlayed: number;
  /** The party that ended most recently, if any (its recap can be opened). */
  lastEndedSessionId: string | null;
}

export interface SegmentView {
  id: string;
  gameId: string;
  /** "paused" = waiting for the host to resume (e.g. after a server restart). */
  status: "active" | "paused";
  /** Game-specific, already filtered for the receiving player. */
  view: unknown;
  /** Present while the current item can be skipped by vote. */
  skip: { key: string; votes: number; needed: number; canVote: boolean; voted: boolean } | null;
  /** Raw points earned in this game so far; they become party points only at settlement. */
  rawScores: ScoreEntry[];
  /** Content item on screen that feedback can be given on. */
  contentId: string | null;
  /** Something the Game AI is doing for this game right now (not a wait on other players). */
  notice: string | null;
}

export interface LastSegmentView {
  gameId: string;
  gameName: string;
  endedReason: "finished" | "aborted";
  scores: ScoreEntry[];
}

export interface AiStatus {
  enabled: boolean;
  state: "idle" | "thinking" | "unavailable";
  note?: string;
}

/** Full per-player snapshot. Sent on join and after every state change; it is the recovery path too. */
export interface RoomView {
  room: { id: string; name: string };
  me: { playerId: PlayerId; isHost: boolean };
  /** Only present for the host. */
  inviteToken?: string;
  members: MemberView[];
  sessionId: string;
  scoreboard: ScoreEntry[];
  games: GameMeta[];
  segment: SegmentView | null;
  lastSegment: LastSegmentView | null;
  party: PartyInfo;
  prefs: PartyPrefs;
  settlement: SettlementView | null;
  /** Adjustment proposals waiting for the host. */
  adjustments: AdjustmentView[];
  /** Game suggestion made by the AI host; only the host can act on it. */
  suggestion: { gameId: string; reason: string } | null;
  ai: AiStatus;
  canvas: CanvasView;
}

export interface ChatMessageView {
  id: string;
  sender: { kind: "player"; playerId: PlayerId; nickname: string } | { kind: "agent" } | { kind: "system" };
  text: string;
  createdAt: number;
  /** Party the message belongs to (null for messages older than party-scoped chat). */
  sessionId: string | null;
}
