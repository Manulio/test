ALTER TABLE "products" ADD COLUMN "category" text DEFAULT 'otros' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_category" ON "products" USING btree ("category");