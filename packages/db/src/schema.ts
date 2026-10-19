import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sizeUnit = pgEnum("size_unit", ["g", "ml", "un"]);
export const matchStatus = pgEnum("match_status", ["ean", "auto", "review", "manual", "new"]);

/** Cadenas de supermercados. */
export const chains = pgTable("chains", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  website: text("website").notNull(),
});

/** Catálogo propio: un producto que puede venderse en varias cadenas. */
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    ean: text("ean").unique(),
    name: text("name").notNull(),
    brand: text("brand"),
    sizeAmount: real("size_amount"),
    sizeUnit: sizeUnit("size_unit"),
    imageUrl: text("image_url"),
    /** Marca + nombre normalizados (sin tildes, en minúsculas). Es lo que se indexa para buscar. */
    searchText: text("search_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_search_trgm").using("gin", sql`${t.searchText} gin_trgm_ops`)],
);

/** Un producto tal como lo publica una cadena en su tienda online. */
export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id),
    externalId: text("external_id").notNull(),
    productId: integer("product_id").references(() => products.id),
    url: text("url").notNull(),
    name: text("name").notNull(),
    brand: text("brand"),
    ean: text("ean"),
    imageUrl: text("image_url"),
    matchStatus: matchStatus("match_status"),
    /** Producto sugerido cuando el matching tiene dudas (status "review"). */
    matchCandidateId: integer("match_candidate_id").references(() => products.id),
    matchScore: real("match_score"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_chain_external").on(t.chainId, t.externalId),
    index("listings_product").on(t.productId),
  ],
);

/** Precio de un listado en un día. Se guarda uno por día para tener historial. */
export const prices = pgTable(
  "prices",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    listPrice: numeric("list_price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    salePrice: numeric("sale_price", { precision: 10, scale: 2, mode: "number" }),
    promoText: text("promo_text"),
    available: boolean("available").notNull().default(true),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prices_listing_date").on(t.listingId, t.date)],
);

export type Chain = typeof chains.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Price = typeof prices.$inferSelect;
