CREATE TYPE "public"."activity_type_kind" AS ENUM('committed', 'available');--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "activity_type_kind" NOT NULL,
	"color" text NOT NULL
);
