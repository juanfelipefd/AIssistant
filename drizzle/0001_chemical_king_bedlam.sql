CREATE TYPE "public"."activity_type_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."roadmap_item_status" AS ENUM('todo', 'in_progress', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'closed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."track_kind" AS ENUM('study', 'project', 'habit');--> statement-breakpoint
CREATE TYPE "public"."track_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "calendar_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"note" text,
	CONSTRAINT "calendar_blocks_end_after_start_check" CHECK ("calendar_blocks"."end_time" > "calendar_blocks"."start_time")
);
--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"topic_key" text NOT NULL,
	"what" text NOT NULL,
	"why" text NOT NULL,
	"location" text NOT NULL,
	"learned" text NOT NULL,
	"source_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"status" "roadmap_item_status" DEFAULT 'todo' NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"topic_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "roadmap_items_estimated_minutes_check" CHECK ("roadmap_items"."estimated_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"actual_minutes" integer,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"handoff_done" text,
	"handoff_stopped" text,
	"handoff_next" text,
	"handoff_blockers" text,
	"tokens_used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_keys_track_id_key_unique" UNIQUE("track_id","key")
);
--> statement-breakpoint
CREATE TABLE "track_relevance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"weight" smallint NOT NULL,
	"rationale" text NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_relevance_weight_check" CHECK ("track_relevance"."weight" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "track_kind" NOT NULL,
	"charter" text NOT NULL,
	"weekly_minutes_target" integer NOT NULL,
	"status" "track_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"focus" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_plans_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
CREATE TABLE "week_template_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"activity_type_id" uuid NOT NULL,
	CONSTRAINT "week_template_blocks_day_of_week_check" CHECK ("week_template_blocks"."day_of_week" BETWEEN 1 AND 7),
	CONSTRAINT "week_template_blocks_end_after_start_check" CHECK ("week_template_blocks"."end_time" > "week_template_blocks"."start_time")
);
--> statement-breakpoint
ALTER TABLE "activity_types" ADD COLUMN "status" "activity_type_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_blocks" ADD CONSTRAINT "calendar_blocks_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_track_id_topic_key_fk" FOREIGN KEY ("track_id","topic_key") REFERENCES "public"."topic_keys"("track_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_track_id_topic_key_fk" FOREIGN KEY ("track_id","topic_key") REFERENCES "public"."topic_keys"("track_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_keys" ADD CONSTRAINT "topic_keys_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_relevance" ADD CONSTRAINT "track_relevance_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_template_blocks" ADD CONSTRAINT "week_template_blocks_activity_type_id_activity_types_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."activity_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_blocks_date_idx" ON "calendar_blocks" USING btree ("date");--> statement-breakpoint
CREATE INDEX "deadlines_due_date_idx" ON "deadlines" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "memories_track_id_created_at_idx" ON "memories" USING btree ("track_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "messages_session_id_created_at_idx" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "roadmap_items_track_id_status_idx" ON "roadmap_items" USING btree ("track_id","status");--> statement-breakpoint
CREATE INDEX "sessions_track_id_status_idx" ON "sessions" USING btree ("track_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_active_idx" ON "sessions" USING btree ("status") WHERE "sessions"."status" = 'active';--> statement-breakpoint
-- Safety rail against accidental UPDATE/DELETE on track_relevance
-- (append-only by design — a revised judgement is a new row, never an edit
-- of an existing one). This trigger can be dropped and recreated
-- (DROP TRIGGER ... / CREATE TRIGGER ...) if a genuine data repair is ever
-- needed — it is a safety rail, not an immutable law.
CREATE OR REPLACE FUNCTION track_relevance_prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'track_relevance is append-only; a revised judgement is a new row';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER track_relevance_append_only
BEFORE UPDATE OR DELETE ON "track_relevance"
FOR EACH ROW EXECUTE FUNCTION track_relevance_prevent_update_delete();--> statement-breakpoint
-- Generated tsvector over what/why/learned ONLY (deliberately excluding
-- location), GIN indexed for full-text search against this column.
ALTER TABLE "memories" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "what" || ' ' || "why" || ' ' || "learned")) STORED;--> statement-breakpoint
CREATE INDEX "memories_search_vector_idx" ON "memories" USING GIN ("search_vector");