CREATE TABLE "token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_usage_tokens_nonnegative_check" CHECK ("token_usage"."input_tokens" >= 0 AND "token_usage"."output_tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_usage_created_at_idx" ON "token_usage" USING btree ("created_at");