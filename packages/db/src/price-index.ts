import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import type { Db } from "./client";

/** Un producto de la canasta del índice, identificado por su código de barras. */
export interface IndexItem {
  ean: string;
  /** Cómo se muestra en la página (los nombres de las fichas varían según la cadena que las creó). */
  label: string;
}

/**
 * Canasta fija del índice: básicos de marca que venden casi todas las cadenas scrapeadas
 * (elegidos en octubre de 2026 entre los productos con listados en 4 o 5 de ellas).
 * Si alguno deja de existir en el catálogo, el índice sigue con los demás y lo informa en `missing`.
 */
export const INDEX_BASKET: IndexItem[] = [
  { ean: "7730105001321", label: "Leche ultra entera Conaprole 1 L" },
  { ean: "7730114000155", label: "Arroz parboiled Blue Patna 1 kg" },
  { ean: "7730132001165", label: "Aceite de girasol Óptimo 900 ml" },
  { ean: "7730241003654", label: "Yerba Canarias 1 kg" },
  { ean: "7730251000018", label: "Azúcar Azucarlito 1 kg" },
  { ean: "7730354001820", label: "Fideos tirabuzón Puritas 1 kg" },
  { ean: "7730213000650", label: "Fideos tallarín Cololo 500 g" },
  { ean: "7730411011052", label: "Pan de molde Vintelux 500 g" },
  { ean: "7730239000030", label: "Huevos colorados Prodhin x 12" },
  { ean: "7730354007310", label: "Harina Puritas 1 kg" },
  { ean: "7730109012323", label: "Café Chaná familiar 250 g" },
  { ean: "77306494", label: "Manteca Conaprole 100 g" },
  { ean: "7730105008832", label: "Queso rallado Conaprole 80 g" },
  { ean: "7730105022050", label: "Yogur natural Conaprole 500 g" },
  { ean: "7730213006911", label: "Pulpa de tomate Cololo 1 kg" },
  { ean: "7730205101181", label: "Atún al natural Río de la Plata 120 g" },
  { ean: "7730205081094", label: "Lentejas Río de la Plata 400 g" },
  { ean: "7622300226657", label: "Galletas al agua Famosa 420 g" },
  { ean: "7730219009954", label: "Papel higiénico Sublime x 12" },
  { ean: "7898422746759", label: "Jabón de tocador Dove 90 g" },
  { ean: "7730377059167", label: "Detergente Axion limón 1,35 L" },
  { ean: "7730494002008", label: "Lavandina Sello Rojo 2 L" },
  { ean: "7891024135020", label: "Pasta dental Colgate Total 90 g" },
  { ean: "7730105005114", label: "Dulce de leche Conaprole 500 g" },
  { ean: "7730132000779", label: "Mayonesa Uruguay 500 g" },
];

/** Una cadena entra al índice un día solo si ese día tiene precio de al menos esta parte de la canasta. */
export const MIN_COVERAGE = 0.8;
/** Un precio sigue valiendo hasta este número de días después de relevado (cubre scrapeos parciales o fallidos). */
export const CARRY_DAYS = 7;

export type PriceSource = "scraper" | "sipc";

export interface Observation {
  source: PriceSource;
  chainSlug: string;
  chainName: string;
  productId: number;
  /** "YYYY-MM-DD" */
  date: string;
  price: number;
}

export interface IndexPoint {
  date: string;
  /** Costo de la canasta completa: lo relevado más lo que falta estimado al nivel de precios de la cadena. */
  cost: number;
  /** Suma de los precios relevados (sin estimar los faltantes). */
  observed: number;
  /** Productos de la canasta con precio ese día. */
  items: number;
}

export interface IndexSeries {
  chainSlug: string;
  chainName: string;
  source: PriceSource;
  /** Ordenados por fecha; solo los días con cobertura suficiente. */
  points: IndexPoint[];
}

export interface BasketIndex {
  /** Productos de la canasta que existen en el catálogo (sobre los que se mide la cobertura). */
  items: (IndexItem & { productId: number })[];
  /** Productos de la canasta que no están en el catálogo. */
  missing: IndexItem[];
  /** Una serie por cadena y fuente: los precios del SIPC nunca se mezclan con los scrapeados. */
  series: IndexSeries[];
}

const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const DAY = 86_400_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Arma las series del índice a partir de los precios diarios (uno por cadena, fuente, producto y día).
 *
 * Para cada cadena y cada día con datos se toma el último precio de cada producto de los `CARRY_DAYS` días previos.
 * Los productos que la cadena no tiene se estiman con el precio de referencia del producto (la mediana de todos sus precios
 * en esa fuente) multiplicado por el nivel de la cadena (lo que cuesta lo que sí tiene, dividido lo que costaría a
 * precios de referencia). Así una cadena no sale más barata solo por no vender algún producto caro.
 */
export function buildIndex(
  productIds: number[],
  observations: Observation[],
  { minCoverage = MIN_COVERAGE, carryDays = CARRY_DAYS } = {},
): IndexSeries[] {
  const basket = new Set(productIds);
  const groups = new Map<string, { chainSlug: string; chainName: string; source: PriceSource; obs: Observation[] }>();
  for (const o of observations) {
    if (!basket.has(o.productId)) continue;
    const key = `${o.source}:${o.chainSlug}`;
    const group = groups.get(key) ?? { chainSlug: o.chainSlug, chainName: o.chainName, source: o.source, obs: [] };
    group.obs.push(o);
    groups.set(key, group);
  }

  const reference = new Map<string, number>();
  for (const source of ["scraper", "sipc"] as const) {
    for (const id of basket) {
      const prices = observations.filter((o) => o.source === source && o.productId === id).map((o) => o.price);
      if (prices.length > 0) reference.set(`${source}:${id}`, median(prices));
    }
  }

  const series: IndexSeries[] = [];
  for (const { chainSlug, chainName, source, obs } of groups.values()) {
    obs.sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(obs.map((o) => o.date))];
    const refTotal = [...basket].reduce((sum, id) => sum + (reference.get(`${source}:${id}`) ?? 0), 0);
    const points: IndexPoint[] = [];
    for (const date of dates) {
      const t = time(date);
      const latest = new Map<number, number>();
      for (const o of obs) {
        if (time(o.date) > t) break;
        if (t - time(o.date) <= carryDays * DAY) latest.set(o.productId, o.price);
      }
      if (latest.size < minCoverage * basket.size) continue;
      let observed = 0;
      let refCovered = 0;
      for (const [id, price] of latest) {
        observed += price;
        refCovered += reference.get(`${source}:${id}`)!;
      }
      const cost = refCovered > 0 ? observed * (refTotal / refCovered) : observed;
      points.push({ date, cost: Math.round(cost * 100) / 100, observed: Math.round(observed * 100) / 100, items: latest.size });
    }
    if (points.length > 0) series.push({ chainSlug, chainName, source, points });
  }
  return series;
}

/** Índice de la canasta fija en cada cadena durante los últimos `days` días. */
export async function basketIndex(
  db: Db,
  { basket = INDEX_BASKET, days = 365, minCoverage = MIN_COVERAGE } = {},
): Promise<BasketIndex> {
  const digits = basket.map((i) => i.ean.replace(/^0+/, ""));
  const found = await db.execute<{ id: number; digits: string }>(sql`
    select id, ltrim(ean, '0') as digits from products
    where ltrim(ean, '0') in (${sql.join(digits.map((d) => sql`${d}`), sql`, `)})
  `);
  const idByDigits = new Map(found.map((r) => [r.digits, Number(r.id)]));
  const items = basket.flatMap((item, i) => {
    const productId = idByDigits.get(digits[i]!);
    return productId == null ? [] : [{ ...item, productId }];
  });
  const missing = basket.filter((_, i) => !idByDigits.has(digits[i]!));
  if (items.length === 0) return { items, missing, series: [] };

  const ids = sql.join(items.map((i) => sql`${i.productId}`), sql`, `);
  // Si una cadena vende el producto con dos SKUs, el más barato; el precio de oferta si había.
  const rows = await db.execute<{ source: PriceSource; slug: string; name: string; product_id: number; date: string; price: string }>(sql`
    select distinct on (l.source, c.slug, l.product_id, p.date)
      l.source, c.slug, c.name, l.product_id, p.date::text as date, coalesce(p.sale_price, p.list_price) as price
    from listings l
    join chains c on c.id = l.chain_id
    join prices p on p.listing_id = l.id
    where l.product_id in (${ids}) and ${fromActiveChain()} and p.available and p.date >= current_date - ${days + CARRY_DAYS}::int
    order by l.source, c.slug, l.product_id, p.date, coalesce(p.sale_price, p.list_price)
  `);
  const observations = rows.map((r) => ({
    source: r.source,
    chainSlug: r.slug,
    chainName: r.name,
    productId: Number(r.product_id),
    date: r.date,
    price: Number(r.price),
  }));
  const cutoff = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const series = buildIndex(
    items.map((i) => i.productId),
    observations,
    { minCoverage },
  ).map((s) => ({ ...s, points: s.points.filter((p) => p.date >= cutoff) }));
  return { items, missing, series: series.filter((s) => s.points.length > 0) };
}
