CREATE TABLE "adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"session_id" text NOT NULL,
	"segment_id" text,
	"status" text NOT NULL,
	"items" jsonb NOT NULL,
	"reason" text NOT NULL,
	"proposed_by" text NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "candidate_history" (
	"session_id" text NOT NULL,
	"content_type" text NOT NULL,
	"content_id" text NOT NULL,
	"status" text NOT NULL,
	"seen_by" jsonb,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"session_id" text,
	"segment_id" text,
	"type" text NOT NULL,
	"actor" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"session_id" text NOT NULL,
	"segment_id" text,
	"game_id" text,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_points" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"segment_id" text,
	"player_id" text NOT NULL,
	"tenths" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"proposed_by" text,
	"approved_by" text,
	"adjustment_id" text,
	"award_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "purpose" text DEFAULT 'room' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "party_sessions" ADD COLUMN "scoring" text DEFAULT 'raw-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "party_sessions" ADD COLUMN "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "party_sessions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "party_sessions" ADD COLUMN "summary_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "prefs" jsonb;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "participants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "settlement" jsonb;--> statement-breakpoint
ALTER TABLE "candidate_history" ADD CONSTRAINT "candidate_history_session_id_party_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."party_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_points" ADD CONSTRAINT "party_points_session_id_party_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."party_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustments_session_idx" ON "adjustments" USING btree ("session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_history_pk" ON "candidate_history" USING btree ("session_id","content_id");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "events_room_idx" ON "events" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_session_idx" ON "feedback" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_points_award_key" ON "party_points" USING btree ("session_id","award_key");