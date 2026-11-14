CREATE TABLE "interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"session_id" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text NOT NULL,
	"spec" jsonb NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "agent_note" text;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interactions_room_idx" ON "interactions" USING btree ("room_id","status");