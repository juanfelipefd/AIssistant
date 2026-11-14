ALTER TABLE "token_usage" ADD COLUMN "cache_creation_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "token_usage" ADD COLUMN "cache_read_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "tokens_used";