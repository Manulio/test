import { normalizeText, unitPrice } from "@precios/matching";
import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import { VARIANT_WORDS } from "./alternatives";
import type { Db } from "./client";
import { MAX_PRICE_AGE_DAYS } from "./queries";

/** Tope de productos que se comparan: alcanza para cualquier tipo de producto del súper. */
const MAX_PRODUCTS = 1500;

export interface BrandOption {
  productId: number;
  name: string;
  imageUrl: string | null;
  sizeAmount: number;
  /** Precio más barato de hoy entre las cadenas activas. */
  price: number;
  chainName: string;
  /** Precio por kg, L o unidad. */
  unitPrice: number;
}

export interface BrandRank {
  /** Como la escribe la mayoría de las tiendas. */
  brand: string;
  /** La opción más barata por unidad de medida. */
  best: BrandOption;
  /** El resto de los productos de la marca (otros tamaños o variantes), del más barato por unidad al más caro. */
  others: BrandOption[];
}

export interface BrandRanking {
  /** Unidad en la que se compara: "g" → $/kg, "ml" → $/L, "un" → $/unidad. */
  unit: "g" | "ml" | "un";
  brands: BrandRank[];
  /** Palabras que separan variantes ("girasol", "oliva"...), con cuántos productos la tienen: para afinar la búsqueda. */
  variants: { word: string; count: number }[];
  /** Productos comparados (los que tienen tamaño y precio de hoy). */
  compared: number;
}

interface Row extends Record<string, unknown> {
  id: number;
  name: string;
  brand: string | null;
  image_url: string | null;
  size_amount: number;
  size_unit: "g" | "ml" | "un";
  search_text: string;
  price: string;
  chain_name: string;
}

/** Marca para agrupar: sin tildes ni mayúsculas ("SARA" y "Sara" son la misma). */
const brandKey = (brand: string) => normalizeText(brand);

/** "LA SELVA" → "La Selva"; las que ya vienen con minúsculas se dejan como están. */
function displayBrand(spellings: string[]): string {
  const counts = new Map<string, number>();
  for (const s of spellings) counts.set(s, (counts.get(s) ?? 0) + 1);
  const mixed = [...counts.keys()].filter((s) => s !== s.toUpperCase());
  const pick = (mixed.length > 0 ? mixed : [...counts.keys()]).sort((a, b) => counts.get(b)! - counts.get(a)!)[0]!;
  return pick === pick.toUpperCase() && pick.length > 3
    ? pick.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    : pick;
}

/**
 * Para un tipo de producto ("yerba", "aceite girasol", "leche entera"), la opción más barata por kg, litro
 * o unidad de cada marca con precio de hoy, de la marca más conveniente a la menos. Considera los productos
 * cuyo nombre empieza con la primera palabra buscada (el tipo de producto) y tienen todas las demás.
 */
export async function brandRanking(db: Db, query: string, category?: string): Promise<BrandRanking | null> {
  const q = normalizeText(query);
  const words = q.split(" ").filter((w) => w.length > 0);
  if (words.length === 0 || q.length < 2) return null;

  const rows = [
    ...(await db.execute<Row>(sql`
      with best as (
        select distinct on (product_id) product_id, price, chain_name
        from (
          select distinct on (l.id) l.product_id, coalesce(pr.sale_price, pr.list_price) as price, pr.available, c.name as chain_name
          from listings l join prices pr on pr.listing_id = l.id join chains c on c.id = l.chain_id
          where l.product_id is not null and l.source = 'scraper' and ${fromActiveChain()}
            and pr.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
          order by l.id, pr.date desc
        ) latest
        where available
        order by product_id, price
      )
      select p.id, p.name, p.brand, p.image_url, p.size_amount, p.size_unit, p.search_text, b.price, b.chain_name
      from products p join best b on b.product_id = p.id
      where p.size_amount > 0 and p.brand is not null
        and p.search_text like ${`${words[0]}%`}
        ${sql.join(words.slice(1).map((w) => sql`and p.search_text like ${`%${w}%`}`), sql` `)}
        ${category ? sql`and p.category = ${category}` : sql``}
      limit ${MAX_PRODUCTS}
    `)),
  ];
  if (rows.length === 0) return null;

  // Se compara en la unidad más común: "yerba" mezcla paquetes en gramos con algún pack por unidad.
  const unitCounts = new Map<Row["size_unit"], number>();
  for (const r of rows) unitCounts.set(r.size_unit, (unitCounts.get(r.size_unit) ?? 0) + 1);
  const unit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  const byBrand = new Map<string, { spellings: string[]; options: BrandOption[] }>();
  const variantCounts = new Map<string, number>();
  let compared = 0;
  for (const r of rows) {
    if (r.size_unit !== unit) continue;
    const price = Number(r.price);
    const perUnit = unitPrice(price, { amount: r.size_amount, unit: r.size_unit });
    if (perUnit == null) continue;
    compared++;
    const key = brandKey(r.brand!);
    if (!key) continue;
    const entry = byBrand.get(key) ?? { spellings: [], options: [] };
    entry.spellings.push(r.brand!.trim());
    entry.options.push({
      productId: r.id,
      name: r.name,
      imageUrl: r.image_url,
      sizeAmount: r.size_amount,
      price,
      chainName: r.chain_name,
      unitPrice: perUnit,
    });
    byBrand.set(key, entry);
    for (const w of new Set(r.search_text.split(" "))) {
      if (VARIANT_WORDS.has(w) && !words.includes(w)) variantCounts.set(w, (variantCounts.get(w) ?? 0) + 1);
    }
  }

  const brands = [...byBrand.values()]
    .map(({ spellings, options }) => {
      const sorted = options.sort((a, b) => a.unitPrice - b.unitPrice);
      return { brand: displayBrand(spellings), best: sorted[0]!, others: sorted.slice(1) };
    })
    .sort((a, b) => a.best.unitPrice - b.best.unitPrice);

  const variants = [...variantCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return { unit, brands, variants, compared };
}
