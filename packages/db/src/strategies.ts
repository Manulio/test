import { normalizeText, unitPrice } from "@precios/matching";
import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import { MIN_SAVING, sameKind, sameVariant } from "./alternatives";
import { optimizeBasket, type BasketItem, type BasketPlan } from "./basket";
import type { Db } from "./client";
import { buildReport, currentChainPrices, listChains, MIN_SAMPLE, type ComparisonReport } from "./compare";
import { INDEX_BASKET, type IndexItem } from "./price-index";
import { getProducts, MAX_PRICE_AGE_DAYS } from "./queries";

/** Diferencias de nivel menores a esto se toman como empate (Disco y Devoto empatan en casi todo). */
const TIE = 0.005;
/** Una categoría cuenta como cara para una cadena si está al menos esto por encima de la más barata. */
const MIN_GAP = 0.02;
/** Como en la comparación: si la marca propia sale menos de la mitad, casi seguro es otro producto. */
const MAX_OWN_SAVING = 0.5;
/** Un rival que venden al menos estas cadenas cuenta como "de los más vendidos": entre esos gana el más parecido. */
const WIDELY_SOLD = 3;
/** Rivales por producto de marca propia que se traen de la base (el primero que pase `sameVariant` gana). */
const RIVALS_PER_PRODUCT = 6;

/**
 * Marcas propias conocidas por cadena (normalizadas con `brandKey`). Además cuenta como propia la marca
 * con el nombre de la cadena, y como exclusiva la que solo vende esa cadena.
 */
export const OWN_BRANDS: Record<string, string[]> = {
  disco: ["preciolider", "disco"],
  devoto: ["preciolider", "devoto"],
  geant: ["preciolider", "geant"],
  tata: ["tata"],
  eldorado: ["eldorado"],
};

/** "Precio Líder" → "preciolider"; "TaTa" y "Ta-Ta" → "tata". */
export function brandKey(brand: string): string {
  return normalizeText(brand).replace(/[^a-z0-9]/g, "");
}

/** Lo mismo en SQL, sobre una expresión de texto. */
const brandKeySql = (expr: ReturnType<typeof sql.raw>) =>
  sql`regexp_replace(translate(lower(${expr}), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]', '', 'g')`;

function ownKeys(slug: string, name: string): string[] {
  return [...new Set([...(OWN_BRANDS[slug] ?? []), brandKey(name), brandKey(slug)])];
}

// --- 1. Categorías donde cada cadena es la más barata y las más caras ---------------------------------

export interface CategoryEdge {
  category: string;
  name: string;
  /** Cuánto más cara que la más barata está esta cadena en la categoría (0 si es la más barata). */
  over: number;
  /** Si es la más barata: cuánto más cara está la siguiente cadena que no empata. */
  lead: number | null;
  /** Cadena más barata de la categoría. */
  best: string;
  /** Productos en común de la categoría. */
  compared: number;
}

export interface ChainCategoryAdvice {
  slug: string;
  name: string;
  /** Nivel general de precios (100 = la más barata), como en /comparar. */
  index: number | null;
  /** Categorías donde es la más barata (o empata), de la mayor ventaja a la menor. */
  cheapest: CategoryEdge[];
  /** Categorías donde más cara está respecto de la más barata, de la peor a la menos mala. */
  dearest: CategoryEdge[];
}

/** Para cada cadena, sus categorías más baratas y más caras sobre productos en común. Es pura. */
export function categoryAdvice(report: ComparisonReport, limit = 3): ChainCategoryAdvice[] {
  const advice = new Map<string, ChainCategoryAdvice>(
    report.chains.map((c) => [c.slug, { slug: c.slug, name: c.name, index: c.index, cheapest: [], dearest: [] }]),
  );
  for (const cat of report.categories) {
    if (cat.compared < MIN_SAMPLE) continue;
    const reliable = Object.entries(cat.byChain)
      .filter(([, v]) => v.index != null && v.compared >= MIN_SAMPLE)
      .map(([slug, v]) => ({ slug, index: v.index! }))
      .sort((a, b) => a.index - b.index);
    if (reliable.length < 2) continue;
    const min = reliable[0]!.index;
    for (const { slug, index } of reliable) {
      const entry = advice.get(slug);
      if (!entry) continue;
      const over = index / min - 1;
      const edge = { category: cat.category, name: cat.name, over, best: reliable[0]!.slug, compared: cat.compared };
      if (over < TIE) {
        const next = reliable.find((r) => r.index / index - 1 >= TIE);
        entry.cheapest.push({ ...edge, over: 0, lead: next ? next.index / index - 1 : null });
      } else if (over >= MIN_GAP) {
        entry.dearest.push({ ...edge, lead: null });
      }
    }
  }
  return [...advice.values()].map((a) => ({
    ...a,
    cheapest: a.cheapest.sort((x, y) => (y.lead ?? 0) - (x.lead ?? 0)).slice(0, limit),
    dearest: a.dearest.sort((x, y) => y.over - x.over).slice(0, limit),
  }));
}

// --- 2. Marcas propias que más ahorran -----------------------------------------------------------

export interface PricedProduct {
  id: number;
  name: string;
  brand: string | null;
  price: number;
  unitPrice: number;
}

export interface OwnBrandSaving {
  chainSlug: string;
  /** "propia": marca de la cadena; "exclusiva": una marca que solo vende esa cadena. */
  kind: "propia" | "exclusiva";
  own: PricedProduct;
  /** El equivalente de marca que venden más cadenas, en la misma cadena. */
  rival: PricedProduct & { chains: number };
  /** Entre 0 y 1: cuánto más barata sale la marca propia por kg, litro o unidad. */
  saving: number;
  /** Lo que se ahorra en pesos por cada paquete de la marca propia (al precio por unidad del rival). */
  savingPesos: number;
}

interface RivalRow extends Record<string, unknown> {
  chain_slug: string;
  own_id: number;
  own_name: string;
  own_brand: string | null;
  own_text: string;
  own_price: string;
  own_amount: number;
  own_unit: "g" | "ml" | "un";
  house: boolean;
  rival_id: number;
  rival_name: string;
  rival_brand: string | null;
  rival_text: string;
  rival_price: string;
  rival_amount: number;
  rival_unit: "g" | "ml" | "un";
  rival_chains: number;
}

/**
 * Elige, para cada producto de marca propia, el primer rival de la misma variante (vienen ordenados por
 * cantidad de cadenas y similitud) y se queda con los `limit` que más ahorran por cadena: primero las marcas
 * de la cadena y, si no alcanzan, las exclusivas. Es pura.
 */
export function pickOwnBrandSavings(rows: RivalRow[], limit = 5): Record<string, OwnBrandSaving[]> {
  const best = new Map<string, OwnBrandSaving>();
  for (const r of rows) {
    const key = `${r.chain_slug}:${r.own_id}`;
    if (best.has(key) || !sameVariant(r.own_text, r.rival_text)) continue;
    const ownUnit = unitPrice(Number(r.own_price), { amount: r.own_amount, unit: r.own_unit });
    const rivalUnit = unitPrice(Number(r.rival_price), { amount: r.rival_amount, unit: r.rival_unit });
    if (ownUnit == null || rivalUnit == null) continue;
    const saving = 1 - ownUnit / rivalUnit;
    // El rival más vendido es la comparación justa: si no conviene contra ese, no se sigue buscando otro.
    best.set(key, {
      chainSlug: r.chain_slug,
      kind: r.house ? "propia" : "exclusiva",
      own: { id: r.own_id, name: r.own_name, brand: r.own_brand, price: Number(r.own_price), unitPrice: ownUnit },
      rival: { id: r.rival_id, name: r.rival_name, brand: r.rival_brand, price: Number(r.rival_price), unitPrice: rivalUnit, chains: r.rival_chains },
      saving,
      savingPesos: Math.round(Number(r.own_price) * (rivalUnit / ownUnit - 1) * 100) / 100,
    });
  }
  const byChain: Record<string, OwnBrandSaving[]> = {};
  for (const s of best.values()) {
    if (s.saving < MIN_SAVING || s.saving > MAX_OWN_SAVING) continue;
    (byChain[s.chainSlug] ??= []).push(s);
  }
  for (const [slug, list] of Object.entries(byChain)) {
    // Cada rival una sola vez: dos aromas del mismo desodorante contra el mismo Florex no son dos consejos.
    const rivals = new Set<number>();
    byChain[slug] = list
      .sort((a, b) => Number(b.kind === "propia") - Number(a.kind === "propia") || b.saving - a.saving)
      .filter((s) => !rivals.has(s.rival.id) && rivals.add(s.rival.id))
      .slice(0, limit)
      .sort((a, b) => b.saving - a.saving);
  }
  return byChain;
}

/** Productos de marca propia o exclusiva con precio de hoy en su cadena, y sus rivales de marca en esa misma cadena. */
async function ownBrandRivals(db: Db, chains: { slug: string; name: string }[]): Promise<RivalRow[]> {
  if (chains.length === 0) return [];
  const house = chains.flatMap((c) => ownKeys(c.slug, c.name).map((k) => sql`(${c.slug}, ${k})`));
  const slugs = chains.map((c) => c.slug);
  const rows = await db.execute<RivalRow>(sql`
    with cp as materialized (
      select product_id, chain_id, min(price) as price
      from (
        select distinct on (l.id) l.product_id, l.chain_id, coalesce(p.sale_price, p.list_price) as price, p.available
        from listings l join prices p on p.listing_id = l.id
        where l.product_id is not null and l.source = 'scraper' and ${fromActiveChain()}
          and p.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
        order by l.id, p.date desc
      ) latest
      where available
      group by product_id, chain_id
    ),
    brands as (
      select l.chain_id, l.product_id, ${brandKeySql(sql.raw("coalesce(l.brand, pr.brand)"))} as bkey
      from listings l join products pr on pr.id = l.product_id
      where l.source = 'scraper' and ${fromActiveChain()} and coalesce(l.brand, pr.brand) is not null
    ),
    spread as (select bkey, count(distinct chain_id) as chains from brands where bkey <> '' group by bkey),
    house(slug, bkey) as (values ${sql.join(house, sql`, `)}),
    own as materialized (
      select distinct on (b.product_id, c.id) b.product_id, c.id as chain_id, c.slug, h.bkey is not null as house
      from brands b
      join chains c on c.id = b.chain_id
      join spread s on s.bkey = b.bkey
      left join house h on h.slug = c.slug and h.bkey = b.bkey
      where c.slug in ${slugs} and (h.bkey is not null or s.chains = 1)
      order by b.product_id, c.id, (h.bkey is not null) desc
    ),
    -- Marcas que no sirven de rival: las propias de alguna cadena y las que vende una sola.
    excluded as (select bkey from spread where chains = 1 union select bkey from house),
    reach as (select product_id, count(*)::int as chains from cp group by product_id),
    ranked as (
      select o.slug as chain_slug, t.id as own_id, t.name as own_name, t.brand as own_brand, t.search_text as own_text,
        oc.price as own_price, t.size_amount as own_amount, t.size_unit as own_unit, o.house,
        p.id as rival_id, p.name as rival_name, p.brand as rival_brand, p.search_text as rival_text,
        rc.price as rival_price, p.size_amount as rival_amount, p.size_unit as rival_unit, rr.chains as rival_chains,
        row_number() over (
          partition by o.chain_id, t.id
          order by least(rr.chains, ${WIDELY_SOLD}) desc, similarity(p.search_text, t.search_text) desc
        ) as rank
      from own o
      join cp oc on oc.product_id = o.product_id and oc.chain_id = o.chain_id
      join products t on t.id = o.product_id and t.size_amount > 0
      join products p on p.id <> t.id and p.brand is not null and ${sameKind("p", "t")}
      join cp rc on rc.product_id = p.id and rc.chain_id = o.chain_id
      join reach rr on rr.product_id = p.id
      where ${brandKeySql(sql.raw("p.brand"))} not in (select bkey from excluded)
    )
    select * from ranked where rank <= ${RIVALS_PER_PRODUCT}
    order by chain_slug, own_id, rank
  `);
  return [...rows].map((r) => ({ ...r, own_id: Number(r.own_id), rival_id: Number(r.rival_id), rival_chains: Number(r.rival_chains) }));
}

// --- 3. Estrategia de dos súper -------------------------------------------------------------------

export interface PartnerAdvice {
  slug: string;
  name: string;
  /** Lo que cuesta en esta cadena la parte de la canasta que vende. */
  alone: number;
  /** Productos de la canasta que vende. */
  items: number;
  /** La mejor segunda cadena para sumar, si ahorra algo. */
  partner: { slug: string; name: string; total: number; saving: number; share: number; moved: number } | null;
}

export interface TwoStoreStrategy {
  /** Productos de la canasta sobre los que se calcula: los que vende la mejor cadena sola. */
  items: number;
  /** La canasta en cada cadena, sola. Las que no venden todo figuran con sus faltantes. */
  singles: BasketPlan[];
  /** La mejor cadena sola. */
  single: BasketPlan;
  /** La mejor combinación de dos cadenas, si ahorra. */
  pair: BasketPlan | null;
  saving: number;
  /** saving / single.total */
  share: number;
  /** Para cada cadena: con qué otra conviene complementarla. */
  partners: PartnerAdvice[];
}

const round = (n: number) => Math.round(n * 100) / 100;

function onlyChains(items: BasketItem[], slugs: string[]): BasketItem[] {
  return items.map((i) => ({ ...i, product: { ...i.product, offers: i.product.offers.filter((o) => slugs.includes(o.chainSlug)) } }));
}

/**
 * Cuánto cuesta la canasta en el mejor súper solo contra repartirla entre las dos mejores cadenas,
 * y para cada cadena con cuál conviene complementarla. Es pura.
 */
export function twoStoreStrategy(items: BasketItem[]): TwoStoreStrategy | null {
  const all = optimizeBasket(items);
  const best = all.singles[0];
  if (!best || best.lines.length === 0) return null;
  // Se compara sobre lo que vende la mejor cadena, así los dos totales tienen los mismos productos.
  const covered = new Set(best.lines.map((l) => l.productId));
  const basket = items.filter((i) => covered.has(i.product.id));
  const { singles, bestPair } = optimizeBasket(basket);
  const single = singles[0]!;
  const pair = bestPair && bestPair.missing.length === 0 ? bestPair : null;
  const saving = pair ? round(single.total - pair.total) : 0;

  const slugs = all.singles.map((s) => s.chains[0]?.slug).filter((s): s is string => !!s);
  const partners: PartnerAdvice[] = all.singles.flatMap((plan) => {
    const slug = plan.chains[0]?.slug;
    if (!slug) return [];
    // La parte de la canasta que vende esta cadena, y con qué otra conviene repartirla.
    const own = new Set(plan.lines.map((l) => l.productId));
    const mine = items.filter((i) => own.has(i.product.id));
    let partner: PartnerAdvice["partner"] = null;
    for (const other of slugs) {
      if (other === slug) continue;
      const pairPlan = optimizeBasket(onlyChains(mine, [slug, other])).bestPair;
      if (!pairPlan || pairPlan.missing.length > 0) continue;
      const pairSaving = round(plan.total - pairPlan.total);
      if (pairSaving > 0 && (!partner || pairSaving > partner.saving)) {
        partner = {
          slug: other,
          name: pairPlan.chains.find((c) => c.slug === other)!.name,
          total: pairPlan.total,
          saving: pairSaving,
          share: pairSaving / plan.total,
          moved: pairPlan.lines.filter((l) => l.chainSlug === other).length,
        };
      }
    }
    return [{ slug, name: plan.chains[0]!.name, alone: plan.total, items: plan.lines.length, partner }];
  });

  return { items: basket.length, singles: all.singles, single, pair, saving, share: single.total > 0 ? saving / single.total : 0, partners };
}

// --- 4. Resumen en lenguaje simple ----------------------------------------------------------------

/** Cómo se nombra cada categoría dentro de una oración. */
const SPOKEN: Record<string, string> = {
  almacen: "el almacén",
  bebidas: "las bebidas",
  lacteos: "los lácteos",
  carnes: "la carne y el pescado",
  fiambres: "los fiambres",
  "frutas-y-verduras": "las frutas y verduras",
  panaderia: "la panadería",
  congelados: "los congelados",
  limpieza: "la limpieza",
  perfumeria: "la perfumería",
  bebes: "lo de bebés",
  mascotas: "lo de mascotas",
  hogar: "el bazar",
  electro: "la electrónica",
  ropa: "la ropa",
  jugueteria: "la juguetería",
  otros: "otros productos",
};

export function spokenCategory(slug: string, fallback: string): string {
  return SPOKEN[slug] ?? fallback.toLowerCase();
}

/** "a", "a y b", "a, b y c". */
export function joinSpanish(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

/** "PRECIO LÍDER" → "Precio Líder"; las marcas que no vienen todo en mayúsculas quedan como están. */
export function displayBrand(brand: string): string {
  if (brand !== brand.toUpperCase()) return brand;
  return brand.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-UY")}`;

export interface ChainSummaryLine {
  slug: string;
  name: string;
  /** Oraciones cortas, en el orden en que se muestran. */
  sentences: string[];
}

/** Arma el consejo de cada cadena en lenguaje simple. Es pura. */
export function summarize(
  categories: ChainCategoryAdvice[],
  ownBrands: Record<string, OwnBrandSaving[]>,
  twoStore: TwoStoreStrategy | null,
): ChainSummaryLine[] {
  const names = Object.fromEntries(categories.map((c) => [c.slug, c.name]));
  return categories.map((c) => {
    const sentences: string[] = [];
    // Las categorías caras, agrupadas por la cadena donde convienen.
    const elsewhere = new Map<string, string[]>();
    for (const d of c.dearest) {
      const list = elsewhere.get(d.best) ?? [];
      list.push(spokenCategory(d.category, d.name));
      elsewhere.set(d.best, list);
    }
    const moves = [...elsewhere].map(([slug, cats]) => `${joinSpanish(cats)} en ${names[slug] ?? slug}`);
    if (moves.length > 0) sentences.push(`Si comprás en ${c.name}, conviene llevar ${joinSpanish(moves)}.`);
    if (c.cheapest.length > 0) {
      sentences.push(`Donde ${c.name} es la más barata: ${joinSpanish(c.cheapest.map((e) => spokenCategory(e.category, e.name)))}.`);
    }
    const top = ownBrands[c.slug]?.[0];
    if (top) {
      sentences.push(
        `Probá ${top.own.brand ? displayBrand(top.own.brand) : "su marca propia"}: ${top.own.name} sale ${pct(top.saving)} menos por ${unitWord(top.own.name)} que ${top.rival.brand ? displayBrand(top.rival.brand) : top.rival.name}.`,
      );
    }
    const partner = twoStore?.partners.find((p) => p.slug === c.slug)?.partner;
    if (partner && partner.share >= 0.01) {
      sentences.push(`Sumando ${partner.name} para ${partner.moved} productos de la canasta ahorrás ${pesos(partner.saving)} (${pct(partner.share)}).`);
    }
    return { slug: c.slug, name: c.name, sentences };
  });
}

function unitWord(name: string): string {
  const n = normalizeText(name);
  if (/\d\s*(ml|cc|l|lt|litros?)\b/.test(n)) return "litro";
  if (/\d\s*(g|gr|kg|grs?)\b/.test(n)) return "kilo";
  return "unidad";
}

// --- Todo junto -------------------------------------------------------------------------------------

export interface ShoppingStrategies {
  report: ComparisonReport;
  categories: ChainCategoryAdvice[];
  ownBrands: Record<string, OwnBrandSaving[]>;
  twoStore: TwoStoreStrategy | null;
  summary: ChainSummaryLine[];
  /** Productos de la canasta que no están en el catálogo. */
  basketMissing: IndexItem[];
}

export interface StrategiesQuery {
  /** Cadenas a considerar; si no se pasa, las que tienen precios scrapeados de hoy. */
  chains?: string[];
  basket?: IndexItem[];
}

/** Consejos de compra por cadena con los precios de hoy (solo scrapeados). */
export async function shoppingStrategies(db: Db, query: StrategiesQuery = {}): Promise<ShoppingStrategies> {
  const basket = query.basket ?? INDEX_BASKET;
  const digits = basket.map((i) => i.ean.replace(/^0+/, ""));
  const [allChains, prices, found] = await Promise.all([
    listChains(db),
    currentChainPrices(db, { chains: query.chains }),
    basket.length
      ? db.execute<{ id: number; digits: string }>(sql`select id, ltrim(ean, '0') as digits from products where ltrim(ean, '0') in ${digits}`)
      : [],
  ]);
  const priced = new Set(prices.map((p) => p.chainSlug));
  const chains = allChains.filter((c) => priced.has(c.slug) && (!query.chains?.length || query.chains.includes(c.slug)));
  const slugs = chains.map((c) => c.slug);
  const idByDigits = new Map(found.map((r) => [r.digits, Number(r.id)]));
  // Las consultas arrancan antes del reporte, que es puro cálculo y tarda.
  const pending = Promise.all([ownBrandRivals(db, chains), getProducts(db, [...idByDigits.values()])]);
  const report = buildReport(prices, Object.fromEntries(chains.map((c) => [c.slug, c.name])));
  const categories = categoryAdvice(report);
  const [rivals, products] = await pending;
  const ownBrands = pickOwnBrandSavings(rivals);
  // Solo precios scrapeados de las cadenas consideradas.
  const items = products.map((product) => ({
    quantity: 1,
    product: { ...product, offers: product.offers.filter((o) => o.source === "scraper" && slugs.includes(o.chainSlug)) },
  }));
  const twoStore = twoStoreStrategy(items);
  return {
    report,
    categories,
    ownBrands,
    twoStore,
    summary: summarize(categories, ownBrands, twoStore),
    basketMissing: basket.filter((_, i) => !idByDigits.has(digits[i]!)),
  };
}
