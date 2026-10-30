CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"path" text,
	"asset" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_key_unique" UNIQUE("key"),
	CONSTRAINT "assets_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "collection_summaries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"path" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_summaries_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "page_summaries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"path" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_summaries_path_unique" UNIQUE("path")
);
--> statement-breakpoint
DROP TABLE "resource_meta" CASCADE;