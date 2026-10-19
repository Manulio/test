import {
  canonicalEan,
  matchProduct,
  normalizeText,
  parseSize,
  type Candidate,
} from "@precios/matching";
import { eq, sql } from "drizzle-orm";
import type { Db, Executor } from "./client";
import { chains, listings, prices, products } from "./schema";

export interface ChainInfo {
  slug: string;
  name: string;
  website: string;
}

/** Un producto tal como lo devuelve un scraper. */
export interface RawListing {
  externalId: string;
  url: string;
  name: string;
  brand?: string | null;
  ean?: string | null;
  imageUrl?: string | null;
  listPrice: number;
  salePrice?: number | null;
  promoText?: string | null;
  available: boolean;
}

export interface IngestStats {
  listings: number;
  matchedByEan: number;
  matchedAuto: number;
  needsReview: number;
  newProducts: number;
}

/** Fecha de hoy en Uruguay (YYYY-MM-DD), para que un scrapeo de madrugada no caiga en el día anterior. */
export function todayInUruguay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(now);
}

export async function upsertChain(db: Db, chain: ChainInfo): Promise<number> {
  const [row] = await db
    .insert(chains)
    .values(chain)
    .onConflictDoUpdate({ target: chains.slug, set: { name: chain.name, website: chain.website } })
    .returning({ id: chains.id });
  return row!.id;
}

function searchTextFor(name: string, brand?: string | null): string {
  const text = normalizeText(name);
  if (!brand) return text;
  const b = normalizeText(brand);
  return text.includes(b) ? text : `${b} ${text}`;
}

async function findCandidates(db: Executor, raw: RawListing): Promise<Candidate[]> {
  const ean = canonicalEan(raw.ean);
  const query = searchTextFor(raw.name, raw.brand);
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      brand: products.brand,
      ean: products.ean,
      sizeAmount: products.sizeAmount,
      sizeUnit: products.sizeUnit,
    })
    .from(products)
    .where(
      ean
        ? sql`${products.ean} = ${ean} or ${products.searchText} % ${query}`
        : sql`${products.searchText} % ${query}`,
    )
    .orderBy(sql`similarity(${products.searchText}, ${query}) desc`)
    .limit(20);
  return rows;
}

async function createProduct(db: Executor, raw: RawListing): Promise<number> {
  const size = parseSize(raw.name);
  const [row] = await db
    .insert(products)
    .values({
      ean: canonicalEan(raw.ean),
      name: raw.name.trim(),
      brand: raw.brand?.trim() || null,
      sizeAmount: size?.amount ?? null,
      sizeUnit: size?.unit ?? null,
      imageUrl: raw.imageUrl ?? null,
      searchText: searchTextFor(raw.name, raw.brand),
    })
    .returning({ id: products.id });
  return row!.id;
}

type MatchOutcome = Pick<
  typeof listings.$inferInsert,
  "productId" | "matchStatus" | "matchCandidateId" | "matchScore"
>;

/** Decide a qué producto del catálogo corresponde un listado nuevo, o crea uno. */
async function resolveProduct(db: Executor, raw: RawListing): Promise<MatchOutcome> {
  const result = matchProduct(raw, await findCandidates(db, raw));
  switch (result.kind) {
    case "ean":
      return { productId: result.productId, matchStatus: "ean", matchScore: 1, matchCandidateId: null };
    case "auto": {
      // Si el producto del catálogo no tenía EAN y este listado sí, lo completamos.
      const ean = canonicalEan(raw.ean);
      if (ean) {
        await db
          .update(products)
          .set({ ean })
          .where(sql`${products.id} = ${result.productId} and ${products.ean} is null`);
      }
      return { productId: result.productId, matchStatus: "auto", matchScore: result.score, matchCandidateId: null };
    }
    case "review":
      // Hasta que alguien lo revise, queda como producto propio para que igual aparezca en la búsqueda.
      return {
        productId: await createProduct(db, raw),
        matchStatus: "review",
        matchScore: result.score,
        matchCandidateId: result.productId,
      };
    case "none":
      return { productId: await createProduct(db, raw), matchStatus: "new", matchScore: result.score, matchCandidateId: null };
  }
}

/** Guarda los listados de una cadena y el precio del día de cada uno. */
export async function ingestListings(
  db: Db,
  chain: ChainInfo,
  items: Iterable<RawListing> | AsyncIterable<RawListing>,
  date = todayInUruguay(),
): Promise<IngestStats> {
  const chainId = await upsertChain(db, chain);
  const stats: IngestStats = { listings: 0, matchedByEan: 0, matchedAuto: 0, needsReview: 0, newProducts: 0 };

  for await (const raw of items) {
    await db.transaction(async (tx) => {
      const [listing] = await tx
        .insert(listings)
        .values({
          chainId,
          externalId: raw.externalId,
          url: raw.url,
          name: raw.name,
          brand: raw.brand ?? null,
          ean: canonicalEan(raw.ean),
          imageUrl: raw.imageUrl ?? null,
        })
        .onConflictDoUpdate({
          target: [listings.chainId, listings.externalId],
          set: {
            url: raw.url,
            name: raw.name,
            brand: raw.brand ?? null,
            ean: canonicalEan(raw.ean),
            imageUrl: raw.imageUrl ?? null,
            lastSeenAt: new Date(),
          },
        })
        .returning({ id: listings.id, productId: listings.productId });

      if (listing!.productId == null) {
        const outcome = await resolveProduct(tx, raw);
        await tx.update(listings).set(outcome).where(eq(listings.id, listing!.id));
        if (outcome.matchStatus === "ean") stats.matchedByEan++;
        else if (outcome.matchStatus === "auto") stats.matchedAuto++;
        else if (outcome.matchStatus === "review") stats.needsReview++;
        else stats.newProducts++;
      }

      const sale = raw.salePrice != null && raw.salePrice < raw.listPrice ? raw.salePrice : null;
      const price = {
        listPrice: raw.listPrice,
        salePrice: sale,
        promoText: raw.promoText ?? null,
        available: raw.available,
        scrapedAt: new Date(),
      };
      await tx
        .insert(prices)
        .values({ listingId: listing!.id, date, ...price })
        .onConflictDoUpdate({ target: [prices.listingId, prices.date], set: price });
    });
    stats.listings++;
  }

  return stats;
}
