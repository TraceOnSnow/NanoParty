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
  /** The AI host's own short note about what it is in the middle of organising. */
  agentNote: text("agent_note"),
  /** Party preferences carried over as the template for the next party. */
  prefs: jsonb("prefs"),
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
    /** Set when the host removes the player; the session token stops working. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
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
    /**
     * How the party scoreboard is computed. raw-v1 = game scores added up (parties created
     * before VNext); rank-v1 = placement rewards + approved adjustments (`party_points`).
     */
    scoring: text("scoring", { enum: ["raw-v1", "rank-v1"] })
      .notNull()
      .default("raw-v1"),
    /** Theme, exclusions, difficulty, host mode and members' suggestions. */
    prefs: jsonb("prefs").notNull().default({}),
    /** AI-written recap text; the structured recap never depends on it. */
    summary: text("summary"),
    summaryStatus: text("summary_status", { enum: ["none", "pending", "ok", "failed"] })
      .notNull()
      .default("none"),
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
    /** settling = the game is over and its party points are waiting for the host's confirmation. */
    status: text("status", { enum: ["active", "paused", "settling", "finished", "aborted"] }).notNull(),
    config: jsonb("config").notNull(),
    state: jsonb("state").notNull(),
    /** Players who took part (members when it started plus anyone who scored). */
    participants: jsonb("participants").notNull().default([]),
    /** Snapshot of the settlement that was confirmed: ranking, rewards, scoring version. */
    settlement: jsonb("settlement"),
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
    /** The party the message belongs to (null for messages from before VNext). */
    sessionId: text("session_id"),
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

/**
 * Canvas interaction: a piece of UI the AI host (or the program) put on the main panel,
 * the responses to it and its structured result. Survives restarts.
 */
export const interactions = pgTable(
  "interactions",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    createdBy: text("created_by", { enum: ["agent", "system"] }).notNull(),
    /** queued = waiting for a safe point; open = on screen; closed = has a result. */
    status: text("status", { enum: ["queued", "open", "closed", "cancelled"] }).notNull(),
    spec: jsonb("spec").notNull(),
    responses: jsonb("responses").notNull().default({}),
    result: jsonb("result"),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("interactions_room_idx").on(t.roomId, t.status)],
);

/** One row per model call, for usage observation and budget enforcement. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    sessionId: text("session_id"),
    /** room = host agent, judge = game referee, adapt = puzzle adaptation, summary = recap. */
    purpose: text("purpose").notNull().default("room"),
    model: text("model"),
    durationMs: integer("duration_ms"),
    /** Short error class; never the raw model response. */
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt)],
);

/**
 * Party points ledger (rank-v1 parties). Append-only; the scoreboard is its sum.
 * Points are stored in tenths so that shared placements (e.g. 8.5) stay exact.
 */
export const partyPoints = pgTable(
  "party_points",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => partySessions.id, { onDelete: "cascade" }),
    segmentId: text("segment_id"),
    playerId: text("player_id").notNull(),
    tenths: integer("tenths").notNull(),
    /** rank = placement reward, adjust = approved negotiation, correction = later fix. */
    kind: text("kind", { enum: ["rank", "adjust", "correction"] }).notNull(),
    reason: text("reason").notNull(),
    proposedBy: text("proposed_by"),
    approvedBy: text("approved_by"),
    adjustmentId: text("adjustment_id"),
    awardKey: text("award_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("party_points_award_key").on(t.sessionId, t.awardKey)],
);

/** A proposed change to party points. Nothing is credited until the host approves it. */
export const adjustments = pgTable(
  "adjustments",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    sessionId: text("session_id").notNull(),
    segmentId: text("segment_id"),
    status: text("status", { enum: ["pending", "approved", "cancelled", "replaced", "expired"] }).notNull(),
    /** [{ playerId, tenths }] */
    items: jsonb("items").notNull(),
    reason: text("reason").notNull(),
    /** "agent", "host" or a player id. */
    proposedBy: text("proposed_by").notNull(),
    decidedBy: text("decided_by"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("adjustments_session_idx").on(t.sessionId, t.status)],
);

/** Every candidate shown in a party and what became of it. One row per (party, content item). */
export const candidateHistory = pgTable(
  "candidate_history",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => partySessions.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    contentId: text("content_id").notNull(),
    status: text("status", { enum: ["shown", "used", "skipped"] }).notNull(),
    /** Players who saw a secret candidate; null = shown to everyone. */
    seenBy: jsonb("seen_by"),
    origin: text("origin", { enum: ["library", "ai", "player"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("candidate_history_pk").on(t.sessionId, t.contentId)],
);

/** In-place feedback from players, tied to what was on screen. */
export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    sessionId: text("session_id").notNull(),
    segmentId: text("segment_id"),
    gameId: text("game_id"),
    playerId: text("player_id").notNull(),
    kind: text("kind").notNull(),
    note: text("note"),
    /** { contentId?, entryId?, phase?, step? } */
    context: jsonb("context").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_session_idx").on(t.sessionId)],
);

/**
 * Append-only log of what happened in a room: the basis of play reports, the recap and
 * reproduction. `data` holds public facts only (action types, outcomes), never game secrets.
 */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    sessionId: text("session_id"),
    segmentId: text("segment_id"),
    type: text("type").notNull(),
    actor: text("actor"),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_session_idx").on(t.sessionId, t.createdAt), index("events_room_idx").on(t.roomId, t.createdAt)],
);
