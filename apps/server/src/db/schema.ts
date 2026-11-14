import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Room: members, invite, chat and the place games happen. Survives game switches. */
export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Random invite credential. Rotating it revokes the old link (blocks new joins only). */
  inviteToken: text("invite_token").notNull().unique(),
  hostPlayerId: text("host_player_id").notNull(),
  createdAt: createdAt(),
});

export const players = pgTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    /** Display only. Never used for permissions or reconnect identity. */
    nickname: text("nickname").notNull(),
    /** SHA-256 of the player's session token; the token itself is never stored. */
    sessionTokenHash: text("session_token_hash").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("players_room_idx").on(t.roomId)],
);

/** Party session: one continuous play session in a room; owns the cumulative scoreboard. */
export const partySessions = pgTable(
  "party_sessions",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "ended"] }).notNull(),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    // At most one active session per room.
    uniqueIndex("party_sessions_one_active").on(t.roomId).where(sql`${t.status} = 'active'`),
  ],
);

/** Game segment: a stretch of playing one game. `state` is the authoritative state, secrets included. */
export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => partySessions.id, { onDelete: "cascade" }),
    gameId: text("game_id").notNull(),
    status: text("status", { enum: ["active", "paused", "finished", "aborted"] }).notNull(),
    config: jsonb("config").notNull(),
    state: jsonb("state").notNull(),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("segments_session_idx").on(t.sessionId)],
);

/**
 * Append-only score ledger. Totals are always derived from it.
 * (segment_id, award_key) is unique, so replaying a settlement cannot double-count.
 * Corrections are new rows pointing at the event they correct.
 */
export const scoreEvents = pgTable(
  "score_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => partySessions.id, { onDelete: "cascade" }),
    segmentId: text("segment_id")
      .notNull()
      .references(() => segments.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull(),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    awardKey: text("award_key").notNull(),
    correctsEventId: text("corrects_event_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("score_events_award_key").on(t.segmentId, t.awardKey),
    index("score_events_session_idx").on(t.sessionId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    senderKind: text("sender_kind", { enum: ["player", "agent", "system"] }).notNull(),
    playerId: text("player_id"),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_room_idx").on(t.roomId, t.createdAt)],
);

/** Content library. One row per content version; history stays addressable. */
export const contentItems = pgTable(
  "content_items",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    type: text("type").notNull(),
    theme: text("theme").notNull(),
    /** Where it came from: bundled / imported / generated (+ model). Never fabricated. */
    source: text("source").notNull(),
    verification: text("verification", { enum: ["unverified", "verified"] }).notNull(),
    status: text("status", { enum: ["active", "retired"] })
      .notNull()
      .default("active"),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_items_pk").on(t.id, t.version), index("content_items_type_idx").on(t.type)],
);

export const contentUsage = pgTable(
  "content_usage",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => partySessions.id, { onDelete: "cascade" }),
    segmentId: text("segment_id").notNull(),
    contentId: text("content_id").notNull(),
    contentVersion: integer("content_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_usage_once_per_segment").on(t.segmentId, t.contentId)],
);

export const contentFeedback = pgTable("content_feedback", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  contentId: text("content_id").notNull(),
  contentVersion: integer("content_version").notNull(),
  playerId: text("player_id").notNull(),
  kind: text("kind", { enum: ["not-interested", "too-hard", "unclear", "wrong-answer", "skipped"] }).notNull(),
  createdAt: createdAt(),
});

/** One row per model call, for usage observation and budget enforcement. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt)],
);
