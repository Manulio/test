import { CATEGORIES, normalizeText, unitPrice } from "@precios/matching";
import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
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
  /** "scraper": precio de hoy en la tienda online; "sipc": dato abierto del MEF, con meses de atraso (ver `date`). */
  source: "scraper" | "sipc";
}

export interface ProductWithOffers {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  sizeAmount: number | null;
  sizeUnit: "g" | "ml" | "un" | null;
  imageUrl: string | null;
  category: string;
  /** Ofertas ordenadas de la más barata a la más cara. */
  offers: Offer[];
}

/** Precios scrapeados con más días que esto no se muestran, porque probablemente el producto ya no se vende. */
export const MAX_PRICE_AGE_DAYS = 7;
/** El SIPC (datos abiertos del MEF) se publica con meses de atraso: se muestra con su fecha hasta esta antigüedad. */
const SIPC_MAX_AGE_DAYS = 200;

/** Precio vigente para mostrar: scrapeado reciente, o del SIPC aunque tenga meses (necesita `l` = listings y `p` = prices). */
const isCurrentPrice = (p: ReturnType<typeof sql.raw>) => sql`(
  ${p}.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
  or (l.source = 'sipc' and ${p}.date >= current_date - ${SIPC_MAX_AGE_DAYS}::int)
)`;

export interface ProductRow extends Record<string, unknown> {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  size_amount: number | null;
  size_unit: "g" | "ml" | "un" | null;
  image_url: string | null;
  category: string;
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
  source: "scraper" | "sipc";
}

/** Completa filas de productos con la mejor oferta vigente de cada cadena. */
export async function offersFor(db: Db, rows: ProductRow[]): Promise<ProductWithOffers[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const offerRows = await db.execute<OfferRow>(sql`
    select distinct on (l.id)
      l.product_id, c.slug as chain_slug, c.name as chain_name, l.url,
      p.list_price, p.sale_price, p.promo_text, p.available, p.date::text as date, l.source
    from listings l
    join chains c on c.id = l.chain_id
    join prices p on p.listing_id = l.id
    where l.product_id in ${ids} and ${fromActiveChain()}
      and ${isCurrentPrice(sql.raw("p"))}
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
      source: o.source,
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
    category: r.category,
    offers: bestPerChain(byProduct.get(r.id) ?? []),
  }));
}

/**
 * Primero los precios de hoy y después los del SIPC (aunque sean más baratos, son de hace meses);
 * dentro de cada grupo, los disponibles y de más barato a más caro.
 */
const byPreference = (a: Offer, b: Offer) =>
  Number(a.source === "sipc") - Number(b.source === "sipc") ||
  Number(b.available) - Number(a.available) ||
  a.price - b.price;

/**
 * Una oferta por cadena (si vende el mismo producto con dos SKUs, gana el disponible y más barato;
 * si tiene precio scrapeado y del SIPC, gana el scrapeado), ordenadas.
 */
function bestPerChain(offers: Offer[]): Offer[] {
  const best = new Map<string, Offer>();
  for (const offer of [...offers].sort(byPreference)) {
    if (!best.has(offer.chainSlug)) best.set(offer.chainSlug, offer);
  }
  return [...best.values()];
}

/** Palabras de al menos este largo se aceptan con errores de tipeo en la búsqueda tolerante. */
const FUZZY_MIN_WORD = 4;
/** Parecido mínimo (word_similarity de pg_trgm) de una palabra mal escrita: "yerva" → "yerba" da 0,5 y "aseite" → "aceite" 0,43. */
const FUZZY_WORD_SIMILARITY = 0.4;

/**
 * Filtro de texto: cada palabra tiene que aparecer en el nombre o la marca, o el texto se parece por trigramas.
 * Con `fuzzy`, cada palabra larga puede estar mal escrita; es más lento y trae más ruido, por eso es la segunda pasada.
 */
function textMatch(query: string, fuzzy = false) {
  const q = normalizeText(query);
  if (q.length < 2) return null;
  const words = q.split(" ").filter(Boolean);
  const allWords = sql.join(
    words.map((w) => sql`p.search_text like ${`%${w}%`}`),
    sql` and `,
  );
  // Señales de relevancia: buscar "leche" tiene que traer leche antes que dulce de leche, y "pan" pan antes que pañales.
  const startsWithFirst = sql`p.search_text like ${`${words[0]}%`}`;
  const wholeWords = sql.join(
    words.map((w) => sql`p.search_text ~ ${`\\m${w.replace(/\./g, "\\.")}\\M`}`),
    sql` and `,
  );
  const fuzzyWords = sql.join(
    words.map((w) =>
      w.length >= FUZZY_MIN_WORD
        ? sql`(p.search_text like ${`%${w}%`} or word_similarity(${w}, p.search_text) >= ${FUZZY_WORD_SIMILARITY})`
        : sql`p.search_text like ${`%${w}%`}`,
    ),
    sql` and `,
  );
  return {
    q,
    where: fuzzy ? sql`(${fuzzyWords})` : sql`((${allWords}) or ${q} <% p.search_text)`,
    rank: fuzzy
      ? sql`word_similarity(${q}, p.search_text) desc`
      : sql`(${allWords}) desc, (${startsWithFirst}) desc, (${wholeWords}) desc`,
  };
}

/**
 * Busca productos por texto. Cada palabra tiene que aparecer en el nombre o la marca
 * (sin importar tildes ni orden); además se toleran errores de tipeo vía pg_trgm.
 * Primero aparecen los productos que están en más cadenas.
 */
export async function searchProducts(db: Db, query: string, limit = 24): Promise<ProductWithOffers[]> {
  return (await listCatalog(db, { q: query, pageSize: limit })).products;
}

export type CatalogSort = "relevancia" | "precio" | "precio-unidad" | "nombre";

export interface CatalogQuery {
  category?: string;
  q?: string;
  /** Tolerar errores de tipeo en cada palabra. Si no se pide y la búsqueda no encuentra nada, se reintenta así. */
  fuzzy?: boolean;
  sort?: CatalogSort;
  /** Slug de una cadena: solo productos con precio de hoy ahí, ordenados y mostrados con ese precio. */
  chain?: string;
  /** Empieza en 1. */
  page?: number;
  pageSize?: number;
}

export interface CatalogPage {
  products: ProductWithOffers[];
  /** Los resultados salieron de la búsqueda tolerante a errores de tipeo (la exacta no encontró nada). */
  fuzzy: boolean;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Último precio de cada listado con precio reciente, resumido por producto: en cuántas cadenas está y cuánto sale
 * lo más barato. Con `chain`, `min_price` es el precio de hoy en esa cadena (null si no lo vende o no hay stock).
 */
const productStats = (chain?: string) => sql`
  product_stats as (
    select product_id, count(distinct chain_id)::int as chains,
      ${
        chain
          ? sql`min(price) filter (where available and source = 'scraper' and chain_slug = ${chain})`
          : sql`coalesce(
        min(price) filter (where available and source = 'scraper'),
        min(price) filter (where available)
      )`
      } as min_price
    from (
      select distinct on (l.id) l.product_id, l.chain_id, c.slug as chain_slug,
        coalesce(pr.sale_price, pr.list_price) as price, pr.available, l.source
      from listings l join prices pr on pr.listing_id = l.id join chains c on c.id = l.chain_id
      where l.product_id is not null and ${fromActiveChain()} and ${isCurrentPrice(sql.raw("pr"))}
      order by l.id, pr.date desc
    ) latest
    group by product_id
  )
`;

/** Precio por kg, litro o unidad, como `unitPrice` de @precios/matching; null sin tamaño. */
const unitPriceSql = sql`(s.min_price / nullif(case when p.size_unit = 'un' then p.size_amount else p.size_amount / 1000.0 end, 0))`;

const categoryOrder = `{${CATEGORIES.map((c) => c.slug).join(",")}}`;

/** Productos con precio reciente, filtrados por categoría y texto, de a una página. */
export async function listCatalog(db: Db, query: CatalogQuery = {}): Promise<CatalogPage> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 100);
  const page = Math.max(Math.floor(query.page ?? 1), 1);
  const text = query.q ? textMatch(query.q, query.fuzzy) : null;
  if (query.q && !text) return { products: [], total: 0, page, pageSize, fuzzy: false };

  const filters = [
    query.category ? sql`p.category = ${query.category}` : null,
    text?.where ?? null,
    query.chain ? sql`s.min_price is not null` : null,
  ].filter((f) => f !== null);
  const where = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``;

  const byChains = sql`s.chains desc`;
  const order =
    query.sort === "precio"
      ? sql`s.min_price asc nulls last, p.name`
      : query.sort === "precio-unidad"
        ? // Primero $/kg y $/L, después $/unidad (no se comparan entre sí) y al final los productos sin tamaño.
          sql`(${unitPriceSql} is null), (p.size_unit = 'un'), ${unitPriceSql} asc, p.name`
      : query.sort === "nombre"
        ? sql`p.name`
        : text
          ? sql`${text.rank}, ${byChains}, word_similarity(${text.q}, p.search_text) desc, p.name`
          : // Sin búsqueda, "relevancia" sigue el orden de las categorías (primero la comida) y dentro de cada una
            // muestra primero lo que se puede comparar y lo que tiene foto.
            sql`array_position(${categoryOrder}::text[], p.category), ${byChains}, (p.image_url is null), p.name`;

  const rows = await db.execute<ProductRow & { total: number }>(sql`
    with ${productStats(query.chain)}
    select p.id, p.name, p.brand, p.ean, p.size_amount, p.size_unit, p.image_url, p.category, count(*) over ()::int as total
    from products p join product_stats s on s.product_id = p.id
    ${where}
    order by ${order}, p.id
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `);
  const list = [...rows];
  const total = list[0]?.total ?? (page > 1 ? await countCatalog(db, where, query.chain) : 0);
  if (total === 0 && text && query.fuzzy === undefined) return listCatalog(db, { ...query, fuzzy: true });
  return { products: await offersFor(db, list), total, page, pageSize, fuzzy: query.fuzzy === true && total > 0 };
}

/** Total cuando la página pedida quedó vacía (por ejemplo, una página que ya no existe). */
async function countCatalog(db: Db, where: ReturnType<typeof sql>, chain?: string): Promise<number> {
  const [row] = await db.execute<{ total: number }>(sql`
    with ${productStats(chain)}
    select count(*)::int as total from products p join product_stats s on s.product_id = p.id ${where}
  `);
  return row?.total ?? 0;
}

/** Cuántos productos con precio reciente hay en cada categoría (con `chain`, con precio de hoy en esa cadena). */
export async function categoryCounts(db: Db, chain?: string): Promise<Record<string, number>> {
  const rows = await db.execute<{ category: string; count: number }>(sql`
    with ${productStats(chain)}
    select p.category, count(*)::int as count
    from products p join product_stats s on s.product_id = p.id
    ${chain ? sql`where s.min_price is not null` : sql``}
    group by p.category
  `);
  return Object.fromEntries([...rows].map((r) => [r.category, r.count]));
}

/** Cadenas con precio de hoy, con cuántos productos (de la categoría, si se pide) vende cada una: para el filtro "Comprar en…". */
export async function catalogChains(db: Db, category?: string): Promise<{ slug: string; name: string; count: number }[]> {
  const rows = await db.execute<{ slug: string; name: string; count: number }>(sql`
    select c.slug, c.name, count(distinct l.product_id)::int as count
    from (
      select distinct on (l.id) l.id, l.product_id, l.chain_id, pr.available
      from listings l join prices pr on pr.listing_id = l.id
      where l.product_id is not null and l.source = 'scraper' and ${fromActiveChain()} and ${isCurrentPrice(sql.raw("pr"))}
      order by l.id, pr.date desc
    ) l
    join chains c on c.id = l.chain_id
    join products p on p.id = l.product_id
    where l.available ${category ? sql`and p.category = ${category}` : sql``}
    group by c.slug, c.name
    order by count desc, c.name
  `);
  return [...rows];
}

export async function getProduct(db: Db, id: number): Promise<ProductWithOffers | null> {
  const rows = await db.execute<ProductRow>(sql`
    select id, name, brand, ean, size_amount, size_unit, image_url, category from products where id = ${id}
  `);
  const [product] = await offersFor(db, [...rows]);
  return product ?? null;
}

/** Varios productos con sus ofertas, en el orden de los ids pedidos (los que no existen se omiten). */
export async function getProducts(db: Db, ids: number[]): Promise<ProductWithOffers[]> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return [];
  const rows = await db.execute<ProductRow>(sql`
    select id, name, brand, ean, size_amount, size_unit, image_url, category from products where id in ${unique}
  `);
  const products = await offersFor(db, [...rows]);
  return unique.flatMap((id) => products.find((p) => p.id === id) ?? []);
}

/**
 * Producto por código de barras, del producto o de alguno de sus listados. Compara sin ceros a la izquierda,
 * porque el mismo código aparece como UPC-A (12 dígitos), EAN-13 o GTIN-14 según la tienda.
 * Si hay más de uno, gana el que está en más cadenas.
 */
export async function findProductByEan(db: Db, code: string): Promise<number | null> {
  const digits = code.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 6) return null;
  const [row] = await db.execute<{ id: number }>(sql`
    select p.id
    from products p left join listings l on l.product_id = p.id
    where ltrim(p.ean, '0') = ${digits}
       or p.id in (select product_id from listings where ltrim(ean, '0') = ${digits} and product_id is not null)
    group by p.id
    order by count(distinct l.chain_id) desc, p.id
    limit 1
  `);
  return row?.id ?? null;
}
