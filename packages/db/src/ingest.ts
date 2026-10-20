import {
  canonicalEan,
  categorize,
  matchProduct,
  normalizeText,
  parseSize,
  type Candidate,
  type MatchResult,
} from "@precios/matching";
import { eq, sql } from "drizzle-orm";
import { isActiveChain } from "./active-chains";
import type { Db, Executor } from "./client";
import { SHARED_CATALOGS } from "./rematch";
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
  /** Por defecto "scraper". Los del SIPC son precios de hace meses y la web los muestra aparte. */
  source?: "scraper" | "sipc";
  /** Fecha real del precio (YYYY-MM-DD), si no es la del día del ingest. */
  date?: string;
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
    // Una cadena nueva se muestra solo si está entre las elegidas (ACTIVE_CHAINS).
    .values({ ...chain, active: isActiveChain(chain.slug) })
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

/**
 * Productos del catálogo que podrían ser este listado. Si se sabe la cadena, se descartan los que esa
 * misma cadena ya vende con otro listado: una tienda no publica dos veces el mismo producto, así que
 * "Auricular G335 Blanco" y "Auricular G335 Mint" de El Dorado son productos distintos aunque se parezcan.
 */
async function findCandidates(db: Executor, raw: RawListing, chainId?: number): Promise<Candidate[]> {
  const ean = canonicalEan(raw.ean);
  const query = searchTextFor(raw.name, raw.brand);
  const similar =
    chainId == null
      ? sql`${products.searchText} % ${query}`
      : sql`(${products.searchText} % ${query} and not exists (
          select 1 from listings other
          where other.product_id = ${products.id} and other.chain_id = ${chainId}
            and other.source = ${raw.source ?? "scraper"} and other.external_id <> ${raw.externalId}
        ))`;
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
      ean ? sql`${products.ean} = ${ean} or ${similar}` : similar,
    )
    // El del mismo EAN va primero: si no, con 20 productos de nombre parecido queda fuera del límite.
    .orderBy(...(ean ? [sql`${products.ean} = ${ean} desc nulls last`] : []), sql`similarity(${products.searchText}, ${query}) desc`)
    .limit(20);
  return rows;
}

async function createProduct(db: Executor, raw: RawListing): Promise<number> {
  const size = parseSize(raw.name);
  const ean = canonicalEan(raw.ean);
  const [row] = await db
    .insert(products)
    .values({
      ean,
      name: raw.name.trim(),
      brand: raw.brand?.trim() || null,
      sizeAmount: size?.amount ?? null,
      sizeUnit: size?.unit ?? null,
      imageUrl: raw.imageUrl ?? null,
      category: categorize(raw.name, raw.brand),
      searchText: searchTextFor(raw.name, raw.brand),
    })
    // Otro proceso (otra cadena scrapeando a la vez) pudo crear el mismo EAN recién: usamos ese.
    .onConflictDoNothing({ target: products.ean })
    .returning({ id: products.id });
  if (row) return row.id;
  const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.ean, ean!));
  return existing!.id;
}

/** Qué haría el matching con un listado nuevo, sin escribir nada (para revisar cruces antes de importar). */
export async function previewMatch(
  db: Executor,
  raw: RawListing,
): Promise<{ result: MatchResult; candidate: Candidate | null }> {
  const candidates = await findCandidates(db, raw);
  const result = matchProduct(raw, candidates);
  const candidate = "productId" in result ? (candidates.find((c) => c.id === result.productId) ?? null) : null;
  return { result, candidate };
}

type MatchOutcome = Pick<
  typeof listings.$inferInsert,
  "productId" | "matchStatus" | "matchCandidateId" | "matchScore"
>;

/** Decide a qué producto del catálogo corresponde un listado nuevo, o crea uno. */
/** Si otra cadena con la misma tienda online (Disco, Devoto, Geant) ya tiene este SKU, su producto. */
async function sharedCatalogProduct(db: Executor, raw: RawListing, chainId: number): Promise<number | null> {
  const [me] = await db.select({ slug: chains.slug }).from(chains).where(eq(chains.id, chainId));
  const group = SHARED_CATALOGS.find((g) => g.includes(me?.slug ?? ""));
  if (!group) return null;
  const [row] = await db.execute<{ product_id: number }>(sql`
    select l.product_id from listings l join chains c on c.id = l.chain_id
    where l.external_id = ${raw.externalId} and l.source = ${raw.source ?? "scraper"} and l.chain_id <> ${chainId}
      and l.product_id is not null and c.slug in ${[...group]}
    limit 1
  `);
  return row?.product_id ?? null;
}

async function resolveProduct(db: Executor, raw: RawListing, chainId: number): Promise<MatchOutcome> {
  const shared = await sharedCatalogProduct(db, raw, chainId);
  if (shared != null) return { productId: shared, matchStatus: "auto", matchScore: 1, matchCandidateId: null };

  const result = matchProduct(raw, await findCandidates(db, raw, chainId));
  switch (result.kind) {
    case "ean":
      return { productId: result.productId, matchStatus: "ean", matchScore: 1, matchCandidateId: null };
    case "auto": {
      // Si el producto del catálogo no tenía EAN y este listado sí, lo completamos.
      const ean = canonicalEan(raw.ean);
      // Si otro producto ya tiene ese EAN (por ejemplo, lo creó otra cadena que se está ingiriendo a la vez),
      // se deja como está: una violación de la clave única abortaría toda la ingesta de la cadena.
      if (ean) {
        await db
          .transaction((sp) =>
            sp
              .update(products)
              .set({ ean })
              .where(
                sql`${products.id} = ${result.productId} and ${products.ean} is null
                  and not exists (select 1 from products other where other.ean = ${ean})`,
              ),
          )
          .catch((err: unknown) => {
            if ((err as { cause?: { code?: string } }).cause?.code !== "23505") throw err;
          });
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
          source: raw.source ?? "scraper",
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
        const outcome = await resolveProduct(tx, raw, chainId);
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
        .values({ listingId: listing!.id, date: raw.date ?? date, ...price })
        .onConflictDoUpdate({ target: [prices.listingId, prices.date], set: price });
    });
    stats.listings++;
  }

  return stats;
}
