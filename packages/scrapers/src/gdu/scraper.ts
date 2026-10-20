import { createHttp, type Http } from "../http";
import { isAllowedByRobots } from "../robots";
import type { ChainInfo, RawListing, ScrapeOptions, Scraper } from "../types";

/**
 * Disco, Devoto y Geant (Grupo GDU) usan una tienda propia hecha en Blazor Server.
 * No hay API pública y el listado de categorías se pagina por SignalR, así que
 * recorremos el sitemap y leemos el JSON-LD (schema.org/Product) de cada ficha.
 */
export interface GduConfig {
  chain: ChainInfo;
  /**
   * Fichas bajando a la vez. Con 2 y 1,2 s de pausa son ~0,8 por segundo. Las tres cadenas
   * comparten el límite del sitio: con ~2 por segundo en cada una empiezan los 403.
   */
  concurrency?: number;
  /** Pausa cuando fallan muchas fichas seguidas (el sitio nos está frenando). */
  cooldownMs?: number;
  /** Cuántas pausas tolerar antes de abandonar. */
  maxCooldowns?: number;
  /** Semilla del orden en que se recorren las fichas (por defecto, la fecha de hoy). */
  seed?: number;
  http?: Http;
}

/** Si fallan tantas fichas seguidas, el sitio nos está frenando o está caído. */
const MAX_CONSECUTIVE_FAILURES = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface JsonLdProduct {
  "@type"?: string;
  name?: string;
  image?: string | string[];
  sku?: string;
  gtin?: string;
  brand?: string | { name?: string };
  offers?: { price?: number | string; priceCurrency?: string; availability?: string };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** URLs <loc> de un sitemap (sirve tanto para el índice como para los hijos). */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => escapeLiteralPercents(decodeEntities(m[1]!)));
}

/**
 * El sitemap trae los "%" de los nombres sin codificar ("sabanas-100%-algodon") y el sitio responde 400
 * a esas URLs. Se codifican los que no forman un escape válido; "%18" en "32%180-g" tampoco lo es,
 * porque sería un carácter de control.
 */
export function escapeLiteralPercents(url: string): string {
  return url.replace(/%([0-9a-f]{2})?/gi, (match, hex?: string) => (hex && Number.parseInt(hex, 16) >= 0x20 ? match : `%25${hex ?? ""}`));
}

/**
 * El gtin viene como GTIN-14 con ceros adelante. Lo llevamos a EAN-13 y descartamos
 * los códigos de uso interno (prefijo 2, o EAN-8 que empieza con 0 o 2): son de cada
 * cadena y podrían coincidir por casualidad con los de otra.
 */
export function gtinToEan(gtin: string | null | undefined): string | null {
  const digits = (gtin ?? "").trim();
  if (!/^\d+$/.test(digits)) return null;
  const n = digits.replace(/^0+/, "");
  if (n.length === 8) return /^[02]/.test(n) ? null : n;
  if (n.length === 12 || n.length === 13) {
    const ean = n.padStart(13, "0");
    return ean.startsWith("2") ? null : ean;
  }
  return null;
}

function findProductJsonLd(html: string): JsonLdProduct | null {
  // El "+" del type viene escapado como entidad: application/ld&#x2B;json.
  const re = /<script[^>]*type="application\/ld(?:\+|&#x2B;|&#43;)json"[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const data = JSON.parse(m[1]!) as JsonLdProduct | JsonLdProduct[];
      const found = (Array.isArray(data) ? data : [data]).find((d) => d?.["@type"] === "Product");
      if (found) return found;
    } catch {
      // JSON-LD roto: probamos con el siguiente bloque.
    }
  }
  return null;
}

/** Bloque de precios y etiquetas de la ficha; el resto de la página tiene carruseles de otros productos. */
function detailSection(html: string): string {
  const start = html.search(/<div class="[^"]*\bdet-labels\b/);
  if (start < 0) return "";
  const end = html.indexOf('class="det-add', start);
  return html.slice(start, end < 0 ? start + 5000 : end);
}

/**
 * Promociones de la ficha: etiquetas ("2x1", "Edición limitada") y descuentos con
 * tarjeta ("Santander 25%OFF $ 27742"). Los descuentos con tarjeta no son el precio
 * para todos, así que van como texto y no como precio de oferta.
 */
export function promoTexts(html: string): string[] {
  const section = detailSection(html);
  const texts: string[] = [];
  for (const m of section.matchAll(/<span class="prod-label"[^>]*>([\s\S]*?)<\/span>/g)) {
    texts.push(stripTags(m[1]!));
  }
  const dcto = /<div class="price dcto[^"]*">[\s\S]*?<span class="val">([^<]*)<\/span>[\s\S]*?<div class="lbl-text">([\s\S]*?)<\/div>/g;
  for (const m of section.matchAll(dcto)) {
    const bank = [...m[2]!.matchAll(/alt="([^"]*)"/g)].map((a) => decodeEntities(a[1]!));
    const label = [...bank, stripTags(m[2]!)].filter(Boolean).join(" ");
    texts.push(`${label} $ ${stripTags(m[1]!)}`.trim());
  }
  return [...new Set(texts.filter(Boolean))];
}

/** "1.234,50" → 1234.5 (el sitio usa punto de miles y coma decimal). */
function parsePesos(text: string): number {
  return Number(stripTags(text).replace(/\./g, "").replace(",", "."));
}

/**
 * Precio anterior tachado de la ficha ("<div class="before">… $ 668"), cuando el producto está rebajado.
 * El JSON-LD trae solo el precio actual.
 */
export function beforePrice(html: string): number | null {
  const m = detailSection(html).match(/<div class="before"[^>]*>[\s\S]*?<span class="val">([^<]*)<\/span>/);
  const value = m ? parsePesos(m[1]!) : NaN;
  return value > 0 ? value : null;
}

/**
 * En lo que se vende al peso (fiambres, quesos: "Jamón crudo x 50 g"), el JSON-LD trae el precio por kilo
 * y la ficha muestra aparte el de la porción del nombre: "$ 2620 / kg" y "$ 131". Devuelve los dos.
 */
export function weighablePrices(html: string): { perKg: number; portion: number } | null {
  const section = detailSection(html);
  const m = section.match(
    /product-price-weighable[\s\S]*?<span class="val">([^<]*)<\/span>[\s\S]*?class="product-prices[^"]*"[\s\S]*?<span class="val">([^<]*)<\/span>/,
  );
  if (!m) return null;
  const perKg = parsePesos(m[1]!);
  const portion = parsePesos(m[2]!);
  return perKg > 0 && portion > 0 && portion < perKg ? { perKg, portion } : null;
}

/** Convierte una ficha de producto en un listado; null si no tiene datos o precio. */
export function parseProductPage(html: string, url: string): RawListing | null {
  const p = findProductJsonLd(html);
  if (!p?.sku || !p.name) return null;
  // Envases retornables y similares: figuran en el sitemap pero no se venden.
  if (/no comerciable/i.test(p.name)) return null;
  const jsonPrice = Number(p.offers?.price);
  if (!(jsonPrice > 0)) return null;
  // Al peso: se guarda el precio de la porción del nombre, que es el tamaño del producto (si no, un jamón
  // de "x 50 g" a $ 2620 el kilo parecía costar $ 52.400 el kilo).
  const weighable = weighablePrices(html);
  const factor = weighable ? weighable.portion / weighable.perKg : 1;
  const price = weighable ? weighable.portion : jsonPrice;
  if (p.offers?.priceCurrency && p.offers.priceCurrency !== "UYU") return null;

  const brandName = typeof p.brand === "string" ? p.brand : p.brand?.name;
  const brand = brandName && brandName.trim() !== "-" ? brandName.trim() : null;
  const image = Array.isArray(p.image) ? p.image[0] : p.image;
  const promos = promoTexts(html);
  const tachado = beforePrice(html);
  const before = tachado == null ? null : Math.round(tachado * factor * 100) / 100;

  return {
    externalId: String(p.sku),
    url,
    name: decodeEntities(p.name).trim(),
    brand,
    ean: gtinToEan(p.gtin),
    imageUrl: image ?? null,
    listPrice: before != null && before > price ? before : price,
    salePrice: before != null && before > price ? price : null,
    promoText: promos.length > 0 ? promos.join(" · ") : null,
    available: (p.offers?.availability ?? "").endsWith("InStock"),
  };
}

const todaySeed = () => Number(new Date().toISOString().slice(0, 10).replaceAll("-", ""));

/** Fisher-Yates con un generador simple (mulberry32), para que el orden dependa solo de la semilla. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** URLs de fichas del sitemap: el índice apunta a sitemaps hijos con las URLs reales. */
async function productUrls(http: Http, base: string): Promise<string[]> {
  const index = await http.getHtml(`${base}/sitemap.xml`);
  if (!index) throw new Error(`${base}/sitemap.xml no existe`);
  const children = index.includes("<sitemapindex") ? sitemapLocs(index) : [];
  const xmls = children.length > 0 ? [] : [index];
  for (const child of children) {
    const xml = await http.getHtml(child);
    if (xml) xmls.push(xml);
  }
  const urls = xmls.flatMap(sitemapLocs).filter((u) => new URL(u).pathname.startsWith("/product/"));
  return [...new Set(urls)];
}

export function createGduScraper(config: GduConfig): Scraper {
  const http = config.http ?? createHttp({ delayMs: 1200 });
  const base = config.chain.website.replace(/\/$/, "");
  const concurrency = Math.max(1, config.concurrency ?? 2);
  const cooldownMs = config.cooldownMs ?? 10 * 60_000;
  const maxCooldowns = config.maxCooldowns ?? 6;
  const name = config.chain.name;

  return {
    chain: config.chain,
    async *fetchCatalog({ limit = Infinity, signal }: ScrapeOptions = {}) {
      if (!isAllowedByRobots(await http.getText(`${base}/robots.txt`), "/product/")) {
        throw new Error(`${name}: robots.txt no permite /product/`);
      }
      // Mezclado (igual durante todo el día): el catálogo tiene de todo desde el principio,
      // y si una corrida no llega al final, la de otro día cubre otros productos.
      const queue = shuffled(await productUrls(http, base), config.seed ?? todaySeed());
      if (queue.length === 0) throw new Error(`${name}: el sitemap no tiene fichas de producto`);

      const seen = new Set<string>();
      const retried = new Set<string>();
      let nextIndex = 0;
      let count = 0;
      let consecutiveFailures = 0;
      let cooldowns = 0;

      // Cada worker baja una ficha a la vez; vamos entregando las que terminan primero.
      type Done = { slot: number; url: string; listing: RawListing | null; error?: unknown };
      const inFlight = new Map<number, Promise<Done>>();
      const start = (slot: number) => {
        if (nextIndex >= queue.length) return;
        const url = queue[nextIndex++]!;
        inFlight.set(
          slot,
          http.getHtml(url).then(
            (html) => ({ slot, url, listing: html ? parseProductPage(html, url) : null }),
            (error: unknown) => ({ slot, url, listing: null, error }),
          ),
        );
      };
      for (let slot = 0; slot < concurrency; slot++) start(slot);

      while (inFlight.size > 0) {
        signal?.throwIfAborted();
        const { slot, url, listing, error } = await Promise.race(inFlight.values());
        inFlight.delete(slot);

        if (error) {
          // La ficha se vuelve a intentar una vez, al final de la cola.
          if (!retried.has(url)) {
            retried.add(url);
            queue.push(url);
          }
          if (consecutiveFailures++ === 0) {
            console.warn(`${name}: no se pudo bajar una ficha`, error instanceof Error ? error.message : error);
          }
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            // Casi siempre es el sitio frenándonos (403/429): esperamos y seguimos más tarde.
            if (++cooldowns > maxCooldowns) {
              throw new Error(`${name}: ${consecutiveFailures} fichas seguidas fallaron`, { cause: error });
            }
            console.warn(`${name}: ${consecutiveFailures} fallas seguidas, pausa de ${Math.round(cooldownMs / 60_000)} min (${cooldowns}/${maxCooldowns})`);
            await sleep(cooldownMs);
            consecutiveFailures = 0;
          }
        } else {
          consecutiveFailures = 0;
        }

        if (listing && !seen.has(listing.externalId)) {
          seen.add(listing.externalId);
          yield listing;
          if (++count >= limit) return;
        }
        start(slot);
      }
    },
  };
}
