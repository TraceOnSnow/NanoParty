/**
 * Wire protocol between web client and server (REST + realtime messages).
 * Client -> server payloads are validated with zod on the server.
 */
import { z } from "zod";
import type { GameMeta, PlayerId } from "./game.ts";

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

export const chatRequest = z.object({ text: z.string().trim().min(1).max(CHAT_MAX) });

export const feedbackKind = z.enum(["not-interested", "too-hard", "unclear", "wrong-answer"]);
export type FeedbackKind = z.infer<typeof feedbackKind>;

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("startGame"), gameId: z.string(), config: z.unknown().optional() }),
  /** `segmentId` binds the action to one game segment so late/retried actions cannot hit a newer one. */
  z.object({ type: z.literal("gameAction"), segmentId: z.string(), action: z.unknown() }),
  z.object({ type: z.literal("endSegment"), segmentId: z.string() }),
  z.object({ type: z.literal("resumeSegment"), segmentId: z.string() }),
  z.object({ type: z.literal("askAgent"), kind: z.literal("recommend") }),
  z.object({ type: z.literal("dismissSuggestion") }),
  /** `key` binds the vote to the item on screen; a vote for an earlier item is rejected. */
  z.object({ type: z.literal("voteSkip"), segmentId: z.string(), key: z.string() }),
  z.object({ type: z.literal("contentFeedback"), segmentId: z.string(), contentId: z.string(), kind: feedbackKind }),
  z.object({ type: z.literal("endSession") }),
  z.object({ type: z.literal("rotateInvite") }),
  z.object({ type: z.literal("removeMember"), playerId: z.string() }),
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
  points: number;
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
  /** Content item on screen that feedback can be given on. */
  contentId: string | null;
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
  /** Game suggestion made by the AI host; only the host can act on it. */
  suggestion: { gameId: string; reason: string } | null;
  ai: AiStatus;
}

export interface ChatMessageView {
  id: string;
  sender: { kind: "player"; playerId: PlayerId; nickname: string } | { kind: "agent" } | { kind: "system" };
  text: string;
  createdAt: number;
}
