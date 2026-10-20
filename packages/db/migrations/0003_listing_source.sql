CREATE TYPE "public"."listing_source" AS ENUM('scraper', 'sipc');--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "source" "listing_source" DEFAULT 'scraper' NOT NULL;