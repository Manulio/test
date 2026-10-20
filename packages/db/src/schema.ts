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
/** De dónde sale un listado: el scraper de la tienda online o los datos abiertos del SIPC (con meses de atraso). */
export const listingSource = pgEnum("listing_source", ["scraper", "sipc"]);
/** "running" mientras corre: si queda así, el proceso murió sin poder anotar el final. */
export const scrapeRunStatus = pgEnum("scrape_status", ["running", "ok", "error"]);

/** Cadenas de supermercados. */
export const chains = pgTable("chains", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  website: text("website").notNull(),
  /** Si se muestra en la web. Se sincroniza con ACTIVE_CHAINS (active-chains.ts) en cada migración. */
  active: boolean("active").notNull().default(true),
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
    /** Categoría propia del catálogo (ver CATEGORIES en @precios/matching). */
    category: text("category").notNull().default("otros"),
    /** Marca + nombre normalizados (sin tildes, en minúsculas). Es lo que se indexa para buscar. */
    searchText: text("search_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_search_trgm").using("gin", sql`${t.searchText} gin_trgm_ops`),
    index("products_category").on(t.category),
    // Para buscar por código de barras sin importar los ceros a la izquierda (UPC-A, EAN-13 o GTIN-14).
    index("products_ean_digits").using("btree", sql`ltrim(${t.ean}, '0')`),
  ],
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
    source: listingSource("source").notNull().default("scraper"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_chain_external").on(t.chainId, t.externalId),
    index("listings_product").on(t.productId),
    index("listings_ean_digits").using("btree", sql`ltrim(${t.ean}, '0')`),
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

/** Una corrida del scraper de una cadena, con su resultado (también cuando falla). */
export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id")
      .notNull()
      .references(() => chains.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: scrapeRunStatus("status").notNull().default("running"),
    error: text("error"),
    // Las IngestStats de ingestListings. Si falla, `listings` cuenta los que llegaron a guardarse.
    listings: integer("listings").notNull().default(0),
    matchedByEan: integer("matched_by_ean").notNull().default(0),
    matchedAuto: integer("matched_auto").notNull().default(0),
    needsReview: integer("needs_review").notNull().default(0),
    newProducts: integer("new_products").notNull().default(0),
  },
  (t) => [index("scrape_runs_chain_started").on(t.chainId, t.startedAt)],
);

export type Chain = typeof chains.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Price = typeof prices.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
