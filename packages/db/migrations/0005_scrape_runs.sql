CREATE TYPE "public"."scrape_status" AS ENUM('running', 'ok', 'error');--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "scrape_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"listings" integer DEFAULT 0 NOT NULL,
	"matched_by_ean" integer DEFAULT 0 NOT NULL,
	"matched_auto" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"new_products" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scrape_runs_chain_started" ON "scrape_runs" USING btree ("chain_id","started_at");