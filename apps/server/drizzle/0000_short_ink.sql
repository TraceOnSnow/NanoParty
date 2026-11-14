CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"sender_kind" text NOT NULL,
	"player_id" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"content_id" text NOT NULL,
	"content_version" integer NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"theme" text NOT NULL,
	"source" text NOT NULL,
	"verification" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_usage" (
	"session_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"content_id" text NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"nickname" text NOT NULL,
	"session_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"invite_token" text NOT NULL,
	"host_player_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "score_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"player_id" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"award_key" text NOT NULL,
	"corrects_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"game_id" text NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_usage" ADD CONSTRAINT "content_usage_session_id_party_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."party_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_sessions" ADD CONSTRAINT "party_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_session_id_party_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."party_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_session_id_party_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."party_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_room_idx" ON "chat_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_pk" ON "content_items" USING btree ("id","version");--> statement-breakpoint
CREATE INDEX "content_items_type_idx" ON "content_items" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "content_usage_once_per_segment" ON "content_usage" USING btree ("segment_id","content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "party_sessions_one_active" ON "party_sessions" USING btree ("room_id") WHERE "party_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "players_room_idx" ON "players" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_events_award_key" ON "score_events" USING btree ("segment_id","award_key");--> statement-breakpoint
CREATE INDEX "score_events_session_idx" ON "score_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "segments_session_idx" ON "segments" USING btree ("session_id");