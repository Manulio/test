import { normalizeText, unitPrice } from "@precios/matching";
import { sql } from "drizzle-orm";
import type { Db } from "./client";

export interface Offer {
  chainSlug: string;
  chainName: string;
  url: string;
  listPrice: number;
  salePrice: number | null;
  /** Precio que paga el cliente: el de oferta si hay, si no el de lista. */
  price: number;
  /** Precio por kg, litro o unidad. */
  unitPrice: number | null;
  promoText: string | null;
  available: boolean;
  date: string;
}

export interface ProductWithOffers {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  sizeAmount: number | null;
  sizeUnit: "g" | "ml" | "un" | null;
  imageUrl: string | null;
  /** Ofertas ordenadas de la más barata a la más cara. */
  offers: Offer[];
}

/** Precios con más días que esto no se muestran, porque probablemente el producto ya no se vende. */
const MAX_PRICE_AGE_DAYS = 7;

interface ProductRow extends Record<string, unknown> {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  size_amount: number | null;
  size_unit: "g" | "ml" | "un" | null;
  image_url: string | null;
}

interface OfferRow extends Record<string, unknown> {
  product_id: number;
  chain_slug: string;
  chain_name: string;
  url: string;
  list_price: string;
  sale_price: string | null;
  promo_text: string | null;
  available: boolean;
  date: string;
}

async function offersFor(db: Db, rows: ProductRow[]): Promise<ProductWithOffers[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const offerRows = await db.execute<OfferRow>(sql`
    select distinct on (l.id)
      l.product_id, c.slug as chain_slug, c.name as chain_name, l.url,
      p.list_price, p.sale_price, p.promo_text, p.available, p.date::text as date
    from listings l
    join chains c on c.id = l.chain_id
    join prices p on p.listing_id = l.id
    where l.product_id in ${ids}
      and p.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
    order by l.id, p.date desc
  `);

  const byProduct = new Map<number, Offer[]>();
  for (const o of offerRows) {
    const row = rows.find((r) => r.id === o.product_id)!;
    const size = row.size_amount != null && row.size_unit ? { amount: row.size_amount, unit: row.size_unit } : null;
    const listPrice = Number(o.list_price);
    const salePrice = o.sale_price == null ? null : Number(o.sale_price);
    const price = salePrice ?? listPrice;
    const list = byProduct.get(o.product_id) ?? [];
    list.push({
      chainSlug: o.chain_slug,
      chainName: o.chain_name,
      url: o.url,
      listPrice,
      salePrice,
      price,
      unitPrice: unitPrice(price, size),
      promoText: o.promo_text,
      available: o.available,
      date: o.date,
    });
    byProduct.set(o.product_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    brand: r.brand,
    ean: r.ean,
    sizeAmount: r.size_amount,
    sizeUnit: r.size_unit,
    imageUrl: r.image_url,
    offers: bestPerChain(byProduct.get(r.id) ?? []),
  }));
}

const byPreference = (a: Offer, b: Offer) => Number(b.available) - Number(a.available) || a.price - b.price;

/** Una oferta por cadena (si vende el mismo producto con dos SKUs, gana el disponible y más barato), ordenadas. */
function bestPerChain(offers: Offer[]): Offer[] {
  const best = new Map<string, Offer>();
  for (const offer of [...offers].sort(byPreference)) {
    if (!best.has(offer.chainSlug)) best.set(offer.chainSlug, offer);
  }
  return [...best.values()];
}

/**
 * Busca productos por texto. Cada palabra tiene que aparecer en el nombre o la marca
 * (sin importar tildes ni orden); además se toleran errores de tipeo vía pg_trgm.
 * Primero aparecen los productos que están en más cadenas.
 */
export async function searchProducts(db: Db, query: string, limit = 24): Promise<ProductWithOffers[]> {
  const q = normalizeText(query);
  if (q.length < 2) return [];
  const words = q.split(" ").filter(Boolean);
  const allWords = sql.join(
    words.map((w) => sql`p.search_text like ${`%${w}%`}`),
    sql` and `,
  );

  const rows = await db.execute<ProductRow>(sql`
    select p.id, p.name, p.brand, p.ean, p.size_amount, p.size_unit, p.image_url
    from products p
    where ((${allWords}) or ${q} <% p.search_text)
      and exists (
        select 1 from listings l join prices pr on pr.listing_id = l.id
        where l.product_id = p.id and pr.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
      )
    order by
      (${allWords}) desc,
      (select count(distinct l.chain_id) from listings l where l.product_id = p.id) desc,
      word_similarity(${q}, p.search_text) desc,
      p.name
    limit ${limit}
  `);
  return offersFor(db, [...rows]);
}

export async function getProduct(db: Db, id: number): Promise<ProductWithOffers | null> {
  const rows = await db.execute<ProductRow>(sql`
    select id, name, brand, ean, size_amount, size_unit, image_url from products where id = ${id}
  `);
  const [product] = await offersFor(db, [...rows]);
  return product ?? null;
}

/** Varios productos con sus ofertas, en el orden de los ids pedidos (los que no existen se omiten). */
export async function getProducts(db: Db, ids: number[]): Promise<ProductWithOffers[]> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return [];
  const rows = await db.execute<ProductRow>(sql`
    select id, name, brand, ean, size_amount, size_unit, image_url from products where id in ${unique}
  `);
  const products = await offersFor(db, [...rows]);
  return unique.flatMap((id) => products.find((p) => p.id === id) ?? []);
}
