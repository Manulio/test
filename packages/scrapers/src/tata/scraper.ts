import { gtinToEan } from "../gdu/scraper";
import { createHttp, type Http } from "../http";
import { isAllowedByRobots } from "../robots";
import type { ChainInfo, RawListing, ScrapeOptions, Scraper } from "../types";

/**
 * Ta-Ta usa FastStore (Gatsby) sobre VTEX. La API de catálogo de VTEX solo responde en
 * tatauy.vtexcommercestable.com.br, cuyo robots.txt prohíbe todo, así que usamos lo mismo que
 * la web: las consultas GraphQL persistidas de www.tata.com.uy. ProductsQuery lista por
 * categoría (sin EAN) y BrowserProductQuery trae la ficha con el EAN.
 * Los precios dependen de la región (cada departamento es un seller): por defecto, Montevideo.
 */
export interface TataConfig {
  chain: ChainInfo;
  /** Seller de la región cuyos precios se toman (tatauymontevideo, tatauycanelones, …). */
  regionSeller?: string;
  http?: Http;
}

const SALES_CHANNEL = "4";
const PAGE_SIZE = 50;
/** La búsqueda de VTEX no deja pasar del producto 2500 de un mismo listado. */
const MAX_OFFSET = 2500;
/** Si fallan tantas fichas seguidas, el sitio nos está frenando o está caído. */
const MAX_CONSECUTIVE_FAILURES = 20;

export interface TataCategory {
  name: string;
  link: string;
  children?: TataCategory[];
}

interface TataOffer {
  availability?: string;
  price?: number;
  listPrice?: number;
}

/** Lo que usamos de un producto, igual en ProductsQuery y en BrowserProductQuery. */
export interface TataProduct {
  sku: string;
  slug: string;
  name: string;
  ean?: string | null;
  brand?: { name?: string } | null;
  image?: { url: string }[];
  offers?: { offers?: TataOffer[] };
  /** En lo que se vende al peso, kg por paquete (0.22 para 220 g); 1 en lo demás. */
  unitMultiplier?: number;
}

interface GraphQlResponse<T> {
  data?: T | null;
  errors?: { message?: string }[];
}

/** Algunos nombres vienen con UTF-8 leído como Latin-1 ("CaÃ±uelas"); los reparamos. */
export function fixMojibake(s: string): string {
  if (!/[ÃÂ][\u0080-¿]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

/** El regionId de VTEX es el seller de la región en base64 con el prefijo "SW#". */
export function channelFor(regionSeller: string): string {
  const regionId = Buffer.from(`SW#${regionSeller}`).toString("base64");
  return JSON.stringify({ salesChannel: SALES_CHANNEL, regionId });
}

/** Árbol de categorías del menú de la web (la búsqueda de la tienda no devuelve facetas). */
export function menuCategories(staticQuery: unknown): TataCategory[] | null {
  const sections = (staticQuery as { data?: { cmsMenu?: { sections?: { data?: { categories?: TataCategory[] } }[] } } })
    ?.data?.cmsMenu?.sections;
  const categories = sections?.flatMap((s) => s.data?.categories ?? []) ?? [];
  return categories.length > 0 ? categories : null;
}

/** "/frescos/lacteos" → facetas category-1=frescos, category-2=lacteos. */
export function categoryFacets(link: string): { key: string; value: string }[] {
  return link
    .split(/[?#]/)[0]!
    .split("/")
    .filter(Boolean)
    .map((value, i) => ({ key: `category-${i + 1}`, value: value.toLowerCase() }));
}

/** Convierte un producto de la API en un listado; null si no tiene precio. */
export function toRawListing(p: TataProduct, base: string): RawListing | null {
  const offer = p.offers?.offers?.[0];
  const price = Number(offer?.price);
  if (!p.sku || !p.name || !(price > 0)) return null;
  // En lo que se vende al peso, `price` es el del paquete pero `listPrice` es el del kilo: sin
  // llevarlo al paquete, un queso de 220 g parece rebajado un 78 %.
  const multiplier = Number(p.unitMultiplier) > 0 ? Number(p.unitMultiplier) : 1;
  const packageListPrice = Math.round((Number(offer?.listPrice) || 0) * multiplier * 100) / 100;
  const listPrice = Math.max(packageListPrice, price);
  const brand = p.brand?.name?.trim();
  return {
    externalId: String(p.sku),
    url: `${base}/${encodeURIComponent(p.slug)}/p`,
    name: fixMojibake(p.name).trim(),
    brand: brand ? fixMojibake(brand) : null,
    ean: gtinToEan(p.ean),
    imageUrl: p.image?.[0]?.url ?? null,
    listPrice,
    salePrice: price < listPrice ? price : null,
    promoText: null,
    available: (offer?.availability ?? "").endsWith("InStock"),
  };
}

export function createTataScraper(config: TataConfig): Scraper {
  const http = config.http ?? createHttp({ delayMs: 1000 });
  const base = config.chain.website.replace(/\/$/, "");
  const channel = channelFor(config.regionSeller ?? "tatauymontevideo");
  const scope = [
    { key: "channel", value: channel },
    { key: "locale", value: "es-UY" },
  ];
  const name = config.chain.name;

  async function graphql<T>(operationName: string, variables: unknown): Promise<T> {
    const params = new URLSearchParams({ operationName, variables: JSON.stringify(variables) });
    const res = await http.getJson<GraphQlResponse<T>>(`${base}/api/graphql?${params}`);
    if (res.errors?.length || !res.data) {
      throw new Error(`${name}: ${operationName} → ${res.errors?.[0]?.message ?? "sin datos"}`);
    }
    return res.data;
  }

  async function productsPage(link: string, from: number, sort: string) {
    const data = await graphql<{
      search: { products: { pageInfo: { totalCount: number }; edges: { node: TataProduct }[] } };
    }>("ProductsQuery", {
      first: PAGE_SIZE,
      after: String(from),
      sort,
      term: "",
      selectedFacets: [...categoryFacets(link), ...scope],
    });
    const { pageInfo, edges } = data.search.products;
    return { total: pageInfo.totalCount, products: edges.map((e) => e.node) };
  }

  /** La ficha con EAN; null si ya no existe. */
  async function productDetail(sku: string): Promise<TataProduct | null> {
    const data = await graphql<{ product: TataProduct | null }>("BrowserProductQuery", {
      locator: [{ key: "id", value: sku }, ...scope],
    });
    return data.product;
  }

  /**
   * Productos de una categoría. Si tiene más de los que deja paginar la búsqueda,
   * bajamos a las subcategorías; si es una hoja, la recorremos de las dos puntas por precio.
   */
  async function* categoryProducts(category: TataCategory, signal?: AbortSignal): AsyncGenerator<TataProduct> {
    const first = await productsPage(category.link, 0, "score_desc");
    const children = category.children ?? [];
    if (first.total > MAX_OFFSET && children.length > 0) {
      for (const child of children) yield* categoryProducts(child, signal);
      return;
    }
    const sorts = first.total > MAX_OFFSET ? ["price_asc", "price_desc"] : ["score_desc"];
    if (first.total > 2 * MAX_OFFSET) {
      console.warn(`${name}: ${category.link} tiene ${first.total} productos, solo se leen ${2 * MAX_OFFSET}`);
    }
    for (const sort of sorts) {
      for (let from = 0; from < Math.min(first.total, MAX_OFFSET); from += PAGE_SIZE) {
        signal?.throwIfAborted();
        const page = sort === "score_desc" && from === 0 ? first : await productsPage(category.link, from, sort);
        yield* page.products;
        if (page.products.length < PAGE_SIZE) break;
      }
    }
  }

  return {
    chain: config.chain,
    async *fetchCatalog({ limit = Infinity, signal }: ScrapeOptions = {}) {
      const robots = await http.getText(`${base}/robots.txt`);
      for (const path of ["/api/graphql", "/page-data/"]) {
        if (!isAllowedByRobots(robots, path)) throw new Error(`${name}: robots.txt no permite ${path}`);
      }

      // El menú es una consulta estática de Gatsby; su hash cambia con cada deploy.
      const home = await http.getJson<{ staticQueryHashes?: string[] }>(`${base}/page-data/index/page-data.json`);
      let categories: TataCategory[] | null = null;
      for (const hash of home.staticQueryHashes ?? []) {
        categories = menuCategories(await http.getJson<unknown>(`${base}/page-data/sq/d/${hash}.json`));
        if (categories) break;
      }
      if (!categories) throw new Error(`${name}: no se encontró el menú de categorías`);

      const seen = new Set<string>();
      let count = 0;
      let consecutiveFailures = 0;

      for (const category of categories) {
        for await (const item of categoryProducts(category, signal)) {
          // Un producto puede estar en varias categorías.
          if (seen.has(item.sku)) continue;
          seen.add(item.sku);

          let detail: TataProduct | null = item;
          try {
            detail = await productDetail(item.sku);
            consecutiveFailures = 0;
          } catch (error) {
            // Sin la ficha nos quedamos con lo del listado, que tiene todo menos el EAN.
            if (consecutiveFailures++ === 0) {
              console.warn(`${name}: no se pudo bajar la ficha ${item.sku}`, error instanceof Error ? error.message : error);
            }
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              throw new Error(`${name}: ${consecutiveFailures} fichas seguidas fallaron`, { cause: error });
            }
          }

          const listing = detail ? toRawListing(detail, base) : null;
          if (!listing) continue;
          yield listing;
          if (++count >= limit) return;
        }
      }
    },
  };
}
