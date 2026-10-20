CREATE INDEX "listings_ean_digits" ON "listings" USING btree (ltrim("ean", '0'));--> statement-breakpoint
CREATE INDEX "products_ean_digits" ON "products" USING btree (ltrim("ean", '0'));