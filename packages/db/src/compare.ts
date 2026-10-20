import { categoryName } from "@precios/matching";
import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import type { Db } from "./client";

/** Precios con más días que esto no entran en la comparación. */
const MAX_PRICE_AGE_DAYS = 7;
/**
 * Diferencias de más del doble casi siempre son dos productos distintos que el matching juntó
 * (otro tamaño, un pack contra una unidad), así que no se cuentan.
 */
const MAX_RATIO = 2;
/** Debajo de esta cantidad de productos en común, un resultado es poco confiable. */
export const MIN_SAMPLE = 10;

export interface CompareQuery {
  /** Slugs de las cadenas a comparar; si no se pasa, todas. */
  chains?: string[];
  /** Categorías a incluir; si no se pasa, todas. */
  categories?: string[];
}

/** Precio actual de un producto en una cadena (el más barato si la cadena lo vende con varios SKUs). */
export interface ChainPrice {
  productId: number;
  productName: string;
  brand: string | null;
  category: string;
  chainSlug: string;
  price: number;
  onSale: boolean;
}

export interface ChainSummary {
  slug: string;
  name: string;
  /** Productos con precio actual en esta cadena. */
  products: number;
  /** De esos, cuántos se venden en alguna otra cadena comparada (la base del índice). */
  compared: number;
  /** Nivel de precios controlando por producto: 100 = la cadena más barata; 108 = 8% más cara que esa en los mismos productos. */
  index: number | null;
  /** Parte de los productos comparados en los que esta cadena tiene el menor precio (empates cuentan para todas). */
  cheapestShare: number | null;
  /** Parte de sus productos con precio de oferta. */
  onSaleShare: number;
}

export interface PairComparison {
  a: string;
  b: string;
  shared: number;
  aCheaper: number;
  bCheaper: number;
  ties: number;
  /** Cuánto más caro (positivo) o más barato (negativo) es A que B en promedio, en proporción: 0.05 = 5% más caro. */
  aVsB: number | null;
}

export interface CategoryComparison {
  category: string;
  name: string;
  /** Productos de la categoría que se venden en al menos dos cadenas. */
  compared: number;
  byChain: Record<string, { index: number | null; compared: number }>;
  /** Cadena con el menor índice, si hay datos suficientes. */
  best: string | null;
}

export interface PriceGap {
  productId: number;
  name: string;
  brand: string | null;
  cheapest: { chain: string; price: number };
  priciest: { chain: string; price: number };
  saving: number;
  /** priciest / cheapest - 1 */
  gap: number;
}

export interface ComparisonReport {
  chains: ChainSummary[];
  pairs: PairComparison[];
  categories: CategoryComparison[];
  gaps: PriceGap[];
  /** Productos que se venden en al menos dos de las cadenas comparadas. */
  compared: number;
  /** Productos descartados por diferencias sospechosas (ver MAX_RATIO). */
  excluded: number;
}

/** Precios actuales por producto y cadena, solo de las tiendas online (los datos del SIPC vienen con meses de atraso). */
export async function currentChainPrices(db: Db, query: CompareQuery = {}): Promise<ChainPrice[]> {
  const chainFilter = query.chains?.length ? sql`and c.slug in ${query.chains}` : sql``;
  const categoryFilter = query.categories?.length ? sql`and pr.category in ${query.categories}` : sql``;
  const rows = await db.execute<{
    product_id: number;
    product_name: string;
    brand: string | null;
    category: string;
    chain_slug: string;
    price: string;
    on_sale: boolean;
  }>(sql`
    with latest as (
      select distinct on (l.id) l.product_id, l.chain_id, coalesce(p.sale_price, p.list_price) as price,
        p.sale_price is not null as on_sale
      from listings l join prices p on p.listing_id = l.id
      where l.product_id is not null and l.source = 'scraper' and ${fromActiveChain()} and p.available
        and p.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
      order by l.id, p.date desc
    )
    select distinct on (pr.id, c.slug)
      pr.id as product_id, pr.name as product_name, pr.brand, pr.category, c.slug as chain_slug,
      latest.price, latest.on_sale
    from latest
    join products pr on pr.id = latest.product_id
    join chains c on c.id = latest.chain_id
    where true ${chainFilter} ${categoryFilter}
    order by pr.id, c.slug, latest.price
  `);
  return [...rows].map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    brand: r.brand,
    category: r.category,
    chainSlug: r.chain_slug,
    price: Number(r.price),
    onSale: r.on_sale,
  }));
}

/** Promedio sin la fracción `trim` de valores más bajos ni la de más altos. */
function trimmedMean(values: number[], trim: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * trim);
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Media geométrica: la forma correcta de promediar proporciones (un 2x y un 0.5x se compensan). */
function geomean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
}

/**
 * Nivel de precios de cada cadena, controlando por producto: ajusta log(precio) = producto + cadena
 * alternando promedios hasta converger. Así una cadena que solo comparte productos con la más cara
 * no queda mal parada. Para cada cadena se recorta el 10% de cada extremo, así unos pocos productos
 * mal emparejados no mueven el resultado (la mediana no sirve: Disco y Devoto empatan en casi todo).
 * Devuelve índices con la cadena más barata en 100.
 */
function indexByChain(products: Map<string, number>[], chains: string[]) {
  const level = new Map<string, number>(chains.map((c) => [c, 0]));
  const compared = new Map<string, number>(chains.map((c) => [c, 0]));
  const wins = new Map<string, number>(chains.map((c) => [c, 0]));
  const logs = products.map((prices) => [...prices].map(([chain, price]) => [chain, Math.log(price)] as const));

  for (const prices of products) {
    const min = Math.min(...prices.values());
    for (const [chain, price] of prices) {
      compared.set(chain, (compared.get(chain) ?? 0) + 1);
      if (price === min) wins.set(chain, (wins.get(chain) ?? 0) + 1);
    }
  }

  for (let iteration = 0; iteration < 200; iteration++) {
    // Valor de cada producto dado el nivel actual de las cadenas...
    const productLevel = logs.map((entries) => entries.reduce((sum, [c, lp]) => sum + lp - level.get(c)!, 0) / entries.length);
    // ...y nivel de cada cadena dado el valor de los productos.
    const residuals = new Map<string, number[]>();
    logs.forEach((entries, i) => {
      for (const [c, lp] of entries) {
        const list = residuals.get(c) ?? [];
        list.push(lp - productLevel[i]!);
        residuals.set(c, list);
      }
    });
    let change = 0;
    for (const [c, values] of residuals) {
      const next = trimmedMean(values, 0.1);
      change = Math.max(change, Math.abs(next - level.get(c)!));
      level.set(c, next);
    }
    if (change < 1e-9) break;
  }

  const present = chains.filter((c) => compared.get(c)! > 0);
  const base = Math.min(...present.map((c) => level.get(c)!));
  return new Map(
    chains.map((c) => [
      c,
      {
        index: compared.get(c)! > 0 ? Math.exp(level.get(c)! - base) * 100 : null,
        compared: compared.get(c)!,
        wins: wins.get(c)!,
      },
    ]),
  );
}

/** Arma el reporte comparativo a partir de los precios actuales. Es puro: se puede probar sin base. */
export function buildReport(rows: ChainPrice[], chainNames: Record<string, string>): ComparisonReport {
  const chains = Object.keys(chainNames);
  const byProduct = new Map<number, { info: ChainPrice; prices: Map<string, number> }>();
  const perChain = new Map<string, { products: number; onSale: number }>(chains.map((c) => [c, { products: 0, onSale: 0 }]));

  for (const row of rows) {
    const stats = perChain.get(row.chainSlug);
    if (!stats) continue;
    stats.products++;
    if (row.onSale) stats.onSale++;
    const entry = byProduct.get(row.productId) ?? { info: row, prices: new Map() };
    entry.prices.set(row.chainSlug, row.price);
    byProduct.set(row.productId, entry);
  }

  let excluded = 0;
  const comparable = [...byProduct.values()].filter(({ prices }) => {
    if (prices.size < 2) return false;
    const values = [...prices.values()];
    if (Math.max(...values) / Math.min(...values) > MAX_RATIO) {
      excluded++;
      return false;
    }
    return true;
  });

  const overall = indexByChain(comparable.map((p) => p.prices), chains);
  const summaries: ChainSummary[] = chains
    .map((slug) => {
      const o = overall.get(slug)!;
      const s = perChain.get(slug)!;
      return {
        slug,
        name: chainNames[slug]!,
        products: s.products,
        compared: o.compared,
        index: o.index,
        cheapestShare: o.compared > 0 ? o.wins / o.compared : null,
        onSaleShare: s.products > 0 ? s.onSale / s.products : 0,
      };
    })
    .filter((s) => s.products > 0)
    .sort((x, y) => (x.index ?? Infinity) - (y.index ?? Infinity));

  const pairs: PairComparison[] = [];
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      const a = summaries[i]!.slug;
      const b = summaries[j]!.slug;
      const ratios: number[] = [];
      let aCheaper = 0;
      let bCheaper = 0;
      for (const { prices } of comparable) {
        const pa = prices.get(a);
        const pb = prices.get(b);
        if (pa == null || pb == null) continue;
        ratios.push(pa / pb);
        if (pa < pb) aCheaper++;
        else if (pb < pa) bCheaper++;
      }
      const g = geomean(ratios);
      pairs.push({ a, b, shared: ratios.length, aCheaper, bCheaper, ties: ratios.length - aCheaper - bCheaper, aVsB: g == null ? null : g - 1 });
    }
  }

  const categorySlugs = [...new Set(comparable.map((p) => p.info.category))];
  const categories: CategoryComparison[] = categorySlugs
    .map((category) => {
      const inCategory = comparable.filter((p) => p.info.category === category);
      const idx = indexByChain(inCategory.map((p) => p.prices), summaries.map((s) => s.slug));
      const byChain = Object.fromEntries([...idx].map(([c, v]) => [c, { index: v.index, compared: v.compared }]));
      const reliable = [...idx].filter(([, v]) => v.index != null && v.compared >= MIN_SAMPLE);
      const best = reliable.length >= 2 ? reliable.sort((x, y) => x[1].index! - y[1].index!)[0]![0] : null;
      return { category, name: categoryName(category) ?? category, compared: inCategory.length, byChain, best };
    })
    .sort((x, y) => y.compared - x.compared);

  const gaps: PriceGap[] = comparable
    .map(({ info, prices }) => {
      const sorted = [...prices].sort((x, y) => x[1] - y[1]);
      const [cheapChain, cheap] = sorted[0]!;
      const [dearChain, dear] = sorted.at(-1)!;
      return {
        productId: info.productId,
        name: info.productName,
        brand: info.brand,
        cheapest: { chain: cheapChain, price: cheap },
        priciest: { chain: dearChain, price: dear },
        saving: dear - cheap,
        gap: dear / cheap - 1,
      };
    })
    .filter((g) => g.saving > 0)
    .sort((x, y) => y.saving - x.saving)
    .slice(0, 15);

  return { chains: summaries, pairs, categories, gaps, compared: comparable.length, excluded };
}

export async function compareChains(db: Db, query: CompareQuery = {}): Promise<ComparisonReport> {
  const selected = (await listChains(db)).filter((c) => !query.chains?.length || query.chains.includes(c.slug));
  const names = Object.fromEntries(selected.map((c) => [c.slug, c.name]));
  return buildReport(await currentChainPrices(db, query), names);
}

/** Todas las cadenas, para el selector del reporte. */
export async function listChains(db: Db): Promise<{ slug: string; name: string }[]> {
  return [...(await db.execute<{ slug: string; name: string }>(sql`select slug, name from chains where active order by name`))];
}
