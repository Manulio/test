import { unitPrice } from "@precios/matching";
import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import type { Db } from "./client";
import { MAX_PRICE_AGE_DAYS, offersFor, type ProductRow, type ProductWithOffers } from "./queries";

/**
 * Palabras que cambian qué producto es: un aceite de girasol no reemplaza a uno de oliva, ni una leche
 * descremada a una entera. Si una de las dos tiene alguna de estas, la otra tiene que tener las mismas.
 */
export const VARIANT_WORDS = new Set([
  // Aceites
  "girasol", "soja", "canola", "oliva", "maiz", "mezcla", "arroz",
  // Lácteos
  "entera", "descremada", "semidescremada", "deslactosada", "chocolatada", "condensada", "polvo", "cultivada",
  "natural", "frutilla", "vainilla", "light", "zero", "diet",
  // Almacén
  "integral", "parboiled", "yamani", "arborio", "compuesta", "hierbas", "organica", "suave", "barbacuá",
  "molida", "grano", "instantaneo", "descafeinado", "sin", "tacc", "gluten",
  // Papel y limpieza
  "doble", "simple",
  // Bebidas
  "gas", "lima", "limon", "naranja", "pomelo", "cola", "tinto", "rosado",
]);

/** Similitud mínima de nombres para considerar dos productos del mismo tipo. */
const MIN_SIMILARITY = 0.2;
/** Tiene que salir al menos esto más barato por kg, litro o unidad para que valga la pena sugerirlo. */
export const MIN_SAVING = 0.05;

/**
 * Condición SQL de "mismo tipo de producto" entre `p` y `t` (alias de products): misma categoría, unidad y
 * primera palabra del nombre, tamaño parecido y nombre similar. Falta además comparar las variantes con `sameVariant`.
 */
export const sameKind = (p: string, t: string) => sql.raw(`(
  ${p}.category = ${t}.category and ${p}.size_unit = ${t}.size_unit
  and ${p}.size_amount between ${t}.size_amount * 0.5 and ${t}.size_amount * 2
  and split_part(${p}.search_text, ' ', 1) = split_part(${t}.search_text, ' ', 1)
  and similarity(${p}.search_text, ${t}.search_text) >= ${MIN_SIMILARITY}
)`);

export interface Alternative {
  product: ProductWithOffers;
  /** Precio por kg, L o unidad del más barato hoy. */
  unitPrice: number;
  /** Entre 0 y 1: cuánto más barato sale por unidad de medida que el producto consultado. */
  saving: number;
}

function variantWords(searchText: string, first: string): string[] {
  return searchText.split(" ").filter((w) => w !== first && VARIANT_WORDS.has(w));
}

/** Si una palabra de variante aparece en uno y no en el otro, no son intercambiables. */
export function sameVariant(a: string, b: string): boolean {
  const first = a.split(" ")[0]!;
  const va = new Set(variantWords(a, first));
  const vb = new Set(variantWords(b, first));
  return va.size === vb.size && [...va].every((w) => vb.has(w));
}

/**
 * Productos del mismo tipo (misma categoría, unidad y primera palabra del nombre, tamaño parecido y
 * nombre similar) que hoy salen más baratos por kg, litro o unidad: otra marca, la marca propia de una
 * cadena u otro tamaño. Ordenados del más barato al menos barato.
 */
export async function cheaperAlternatives(db: Db, productId: number, limit = 4): Promise<Alternative[]> {
  const rows = await db.execute<ProductRow & { search_text: string; price: string; sim: number; target: boolean }>(sql`
    with best as (
      select product_id, min(price) as price
      from (
        select distinct on (l.id) l.product_id, coalesce(pr.sale_price, pr.list_price) as price, pr.available
        from listings l join prices pr on pr.listing_id = l.id
        where l.product_id is not null and l.source = 'scraper' and ${fromActiveChain()} and pr.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
        order by l.id, pr.date desc
      ) latest
      where available
      group by product_id
    ),
    t as (select * from products where id = ${productId} and size_amount > 0)
    select p.id, p.name, p.brand, p.ean, p.size_amount, p.size_unit, p.image_url, p.category, p.search_text,
      b.price, similarity(p.search_text, t.search_text)::float8 as sim, p.id = t.id as target
    from t
    join products p on p.id = t.id or ${sameKind("p", "t")}
    join best b on b.product_id = p.id
    order by target desc, sim desc
    limit 60
  `);

  const all = [...rows];
  const target = all.find((r) => r.target);
  const size = (r: ProductRow) => (r.size_amount != null && r.size_unit ? { amount: r.size_amount, unit: r.size_unit } : null);
  const targetUnit = target ? unitPrice(Number(target.price), size(target)) : null;
  if (!target || targetUnit == null) return [];

  const cheaper = all
    .filter((r) => !r.target && sameVariant(target.search_text, r.search_text))
    .map((r) => ({ row: r, unit: unitPrice(Number(r.price), size(r))! }))
    .filter((c) => c.unit != null && c.unit <= targetUnit * (1 - MIN_SAVING))
    .sort((a, b) => a.unit - b.unit)
    .slice(0, limit);

  const products = await offersFor(db, cheaper.map((c) => c.row));
  return cheaper.map((c, i) => ({ product: products[i]!, unitPrice: c.unit, saving: 1 - c.unit / targetUnit }));
}
