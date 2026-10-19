CREATE TYPE "public"."match_status" AS ENUM('ean', 'auto', 'review', 'manual', 'new');--> statement-breakpoint
CREATE TYPE "public"."size_unit" AS ENUM('g', 'ml', 'un');--> statement-breakpoint
CREATE TABLE "chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website" text NOT NULL,
	CONSTRAINT "chains_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"product_id" integer,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"ean" text,
	"image_url" text,
	"match_status" "match_status",
	"match_candidate_id" integer,
	"match_score" real,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"date" date NOT NULL,
	"list_price" numeric(10, 2) NOT NULL,
	"sale_price" numeric(10, 2),
	"promo_text" text,
	"available" boolean DEFAULT true NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"ean" text,
	"name" text NOT NULL,
	"brand" text,
	"size_amount" real,
	"size_unit" "size_unit",
	"image_url" text,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_ean_unique" UNIQUE("ean")
);
--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_match_candidate_id_products_id_fk" FOREIGN KEY ("match_candidate_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_chain_external" ON "listings" USING btree ("chain_id","external_id");--> statement-breakpoint
CREATE INDEX "listings_product" ON "listings" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_listing_date" ON "prices" USING btree ("listing_id","date");--> statement-breakpoint
CREATE INDEX "products_search_trgm" ON "products" USING gin ("search_text" gin_trgm_ops);