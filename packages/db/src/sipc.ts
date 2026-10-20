/**
 * Datos abiertos del Sistema de Información de Precios al Consumidor (SIPC, MEF / Defensa del Consumidor).
 * Publica precios diarios de unos 380 productos de referencia en unos 900 locales, con unos meses de atraso.
 * Sirve para tener precios de las cadenas que no scrapeamos (Ta-Ta, Tienda Inglesa, Kinko, ...).
 *
 * Archivos del dataset de cada año (https://catalogodatos.gub.uy):
 *   establecimiento.csv  ";" y latin1: id.establecimientos, nombre.sucursal, cadena, depto, ...
 *   productos.csv        ";" y latin1: id.producto, producto, marca, especificacion, nombre (sin EAN)
 *   precios_AAAA.csv     "," (≈1 GB): ID_PrecioDiario, Fecha, Oferta, Precio, Establecimiento, Feria_id, Presentacion_Producto
 */
import { normalizeText } from "@precios/matching";
import type { ChainInfo, RawListing } from "./ingest";

export const CKAN_API = "https://catalogodatos.gub.uy/api/3/action";
export const datasetName = (year: number) =>
  `defensa-del-consumidor-sistema-de-informacion-de-precios-al-consumidor-${year}`;
export const datasetUrl = (year: number) => `https://catalogodatos.gub.uy/dataset/${datasetName(year)}`;

// ---------------------------------------------------------------- CSV

/** Separa una línea de CSV respetando comillas ("" es una comilla escapada). "\N" se lee como null. */
export function parseCsvLine(line: string, delimiter: string): (string | null)[] {
  const out: (string | null)[] = [];
  let i = 0;
  const n = line.endsWith("\r") ? line.length - 1 : line.length;
  while (i <= n) {
    let value = "";
    if (line[i] === '"') {
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += line[i++];
      }
      while (i < n && line[i] !== delimiter) i++;
    } else {
      const end = line.indexOf(delimiter, i);
      const stop = end === -1 || end > n ? n : end;
      value = line.slice(i, stop);
      i = stop;
    }
    out.push(value === "\\N" ? null : value);
    i++; // salta el separador
  }
  return out;
}

/** Lee un CSV chico entero y devuelve una fila por objeto, con los nombres de columna del encabezado. */
export function parseCsv(text: string, delimiter: string): Record<string, string | null>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = parseCsvLine(lines[0] ?? "", delimiter).map((h) => (h ?? "").trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    return Object.fromEntries(header.map((h, i) => [h, values[i]?.trim() ?? null]));
  });
}

// ---------------------------------------------------------------- Establecimientos y productos

export interface SipcStore {
  id: number;
  name: string;
  /** Cadena tal como la escribe el SIPC ("Ta - Ta", "Sin Cadena", ...). */
  chain: string;
  department: string | null;
}

export interface SipcProduct {
  id: number;
  product: string;
  brand: string;
  spec: string;
  /** Columna "nombre": a veces trae detalles que no están en las otras ("Jabón de Tocador Dove Blanco"). */
  fullName?: string;
}

export function parseStores(text: string): SipcStore[] {
  return parseCsv(text, ";")
    .map((r) => ({
      id: Number(r["id.establecimientos"]),
      name: r["nombre.sucursal"] ?? "",
      chain: (r["cadena"] ?? "").trim(),
      department: r["depto"] ?? null,
    }))
    .filter((s) => Number.isInteger(s.id) && s.id > 0);
}

export function parseProducts(text: string): SipcProduct[] {
  return parseCsv(text, ";")
    .map((r) => ({
      id: Number(r["id.producto"]),
      product: r["producto"] ?? "",
      brand: r["marca"] ?? "",
      spec: r["especificacion"] ?? "",
      fullName: r["nombre"] ?? "",
    }))
    .filter((p) => Number.isInteger(p.id) && p.id > 0 && p.product !== "");
}

// ---------------------------------------------------------------- Cadenas

const SIPC_DATASET_WEBSITE = "https://catalogodatos.gub.uy/organization/mef";

/**
 * Cadenas del SIPC → cadenas nuestras. Las que ya scrapeamos usan el mismo slug y nombre que el scraper,
 * así sus listados del SIPC quedan en la misma cadena (con source "sipc"). null = no se importa.
 */
const KNOWN_CHAINS: Record<string, ChainInfo | null> = {
  "sin cadena": null, // almacenes sueltos sin nada en común: no tiene sentido una mediana entre ellos
  disco: { slug: "disco", name: "Disco", website: "https://www.disco.com.uy" },
  devoto: { slug: "devoto", name: "Devoto", website: "https://www.devoto.com.uy" },
  geant: { slug: "geant", name: "Geant", website: "https://www.geant.com.uy" },
  "el dorado": { slug: "eldorado", name: "El Dorado", website: "https://www.eldorado.com.uy" },
  "ta ta": { slug: "tata", name: "Ta-Ta", website: "https://www.tata.com.uy" },
  "tienda inglesa": { slug: "tienda-inglesa", name: "Tienda Inglesa", website: "https://www.tiendainglesa.com.uy" },
  "devoto express": { slug: "devoto-express", name: "Devoto Express", website: "https://www.devoto.com.uy" },
  kinko: { slug: "kinko", name: "Kinko", website: "https://www.kinko.com.uy" },
  "san roque": { slug: "san-roque", name: "San Roque", website: "https://www.sanroque.com.uy" },
  "macromercado mayorista": { slug: "macromercado", name: "Macromercado", website: "https://www.macromercado.com.uy" },
  farmashop: { slug: "farmashop", name: "Farmashop", website: "https://www.farmashop.com.uy" },
  pedidosya: { slug: "pedidosya-market", name: "PedidosYa Market", website: "https://www.pedidosya.com.uy" },
};

/** La cadena nuestra para una "cadena" del SIPC, o null si no se importa. */
export function chainFor(sipcChain: string): ChainInfo | null {
  const key = normalizeText(sipcChain);
  if (!key) return null;
  if (key in KNOWN_CHAINS) return KNOWN_CHAINS[key]!;
  return { slug: key.replace(/[^a-z0-9]+/g, "-"), name: sipcChain.trim(), website: SIPC_DATASET_WEBSITE };
}

// ---------------------------------------------------------------- Nombres

/** Envases que el SIPC antepone al tamaño ("Envase 900 cc", "Paquete1 kg."). */
const PACKAGING = /\b(envase|paquete|bolsa|botella|lata|unidad|caja|sachet|atado)\s*(?=\d|aprox)/gi;

/** Lleva la especificación del SIPC a algo que parseSize entienda: "Caja 10 us." → "10 un", "Envase 1/2 docena" → "6 un". */
export function cleanSpec(spec: string): string {
  return spec
    .replace(PACKAGING, "")
    .replace(/\b(envase|paquete|bolsa|botella|lata|caja|sachet)\b/gi, "")
    .replace(/\b1\/2\s*docena\b/gi, "6 un")
    .replace(/\bdocena\b/gi, "12 un")
    .replace(/(\d)\s*us\b\.?/gi, "$1 un")
    .replace(/(\d)\s*unidad(es)?\b/gi, "$1 un")
    .replace(/\bkilogramos?\b/gi, "kg")
    .replace(/\b(mililitros?|milimetros?|milímetros?)\b/gi, "ml")
    .replace(/\bgs\b\.?/gi, "g")
    .replace(/(\d)\.(?=[a-z])/gi, "$1 ") // "2,25.lt." → "2,25 lt."
    .replace(/(\d+)\.0\b/g, "$1") // "12.0 unidades"
    .replace(/aprox\s*(?=\d)/gi, "aprox ")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s+/g, " ");
}

/** "Con Hueso", "sueltos", "bifes de merluz": partes de la marca del SIPC que describen el producto, no la marca. */
function isDescriptor(segment: string): boolean {
  return /^[a-zà-ÿ]/.test(segment) || /^(con|sin|tipo)\b/i.test(segment) || /^sin marca$/i.test(segment);
}

/**
 * Nombres genéricos del SIPC → como los escriben las tiendas. Las palabras que las tiendas no usan ("común",
 * "secos", "de mesa") bajan la similitud y dejan cruces buenos en revisión. Lo que distingue productos
 * ("hoja simple", "con gas", "0000") se mantiene.
 */
const PRODUCT_NAMES: Record<string, string> = {
  "agua de mesa con gas": "Agua con gas",
  "agua de mesa sin gas": "Agua sin gas",
  "agua en bidon": "Agua bidón",
  "arroz blanco": "Arroz",
  "arvejas en conserva": "Arvejas",
  "azucar blanco": "Azúcar",
  "cafe envasado": "Café",
  champu: "Shampoo",
  "desodorante en aerosol": "Desodorante aerosol",
  "detergente para vajilla": "Detergente",
  "fideos secos al huevo": "Fideos al huevo",
  "fideos secos semolados": "Fideos semolados",
  "frankfurters cortos": "Frankfurters",
  "galletitas al agua": "Galleta al agua",
  "gaseosa tipo cola": "Refresco",
  "hamburguesas carne vacun": "Hamburguesas de carne",
  "harina trigo comun 000": "Harina 000",
  "harina trigo comun 0000": "Harina 0000",
  "helado familiar": "Helado",
  "jabon en polvo maquina": "Jabón en polvo",
  "jabon para ropa en barra": "Jabón en barra",
  "jamon cocido no artesanal": "Jamón cocido",
  "mayonesa comun": "Mayonesa",
  "pescado fresco": "Pescado",
  "pollo entero fresco con menudos": "Pollo entero con menudos",
  "sal fina yodada fluorada": "Sal fina",
  "te negro en saquitos": "Té negro",
  "vino tinto comun tetrabrick": "Vino tinto",
  "yerba mate comun": "Yerba mate",
};

/** Palabras de "nombre" que no son detalle del producto (unidades, envases, conectores). */
const NOT_DETAIL =
  /^(mineral|\d.*|de|del|la|el|x|y|gramos?|grs?|kilogramos?|kg|mililitros?|milimetros?|ml|cc|cm3|lt|litros?|unidad(es)?|un|us|hojas?|envase|paquete|bolsa|botella|lata|caja|sachet|atado|pack|block)$/;

/** Palabras que en la marca del SIPC ya no son marca: "Deterjane limón", "Doriana nueva", "Aruba tipo Patna". */
const BRAND_DESCRIPTORS = /^(limon|nueva|nuevo|tipo|original|clasico|clasica|light|sin|con|plus|extra)$/;

const tidy = (s: string) => s.replace(/\([^)]*\)/g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();

/**
 * Nombre y marca de un producto del SIPC al estilo de las tiendas ("Aceite de girasol Óptimo 900 cc").
 * `knownBrands` son marcas del catálogo (normalizadas): si la marca del SIPC empieza con una de ellas, se recorta
 * a esa ("Conaprole sin sal" → marca "Conaprole", y "sin sal" pasa al nombre).
 */
export function listingName(p: SipcProduct, knownBrands: ReadonlySet<string> = new Set()): { name: string; brand: string | null } {
  const segments = tidy(p.brand)
    .split(/\s+-\s*|\s*-\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^sin marca$/i.test(s));

  let brand: string | null = null;
  const descriptors: string[] = [];
  for (const segment of segments) {
    if (brand || isDescriptor(segment)) {
      descriptors.push(segment);
      continue;
    }
    const words = segment.split(" ");
    // La marca conocida más larga que sea prefijo (por palabras) del segmento.
    // Si no hay una marca conocida, la marca termina antes de la primera palabra que describe ("Deterjane limón").
    const descriptor = words.findIndex((w, i) => i > 0 && BRAND_DESCRIPTORS.test(normalizeText(w)));
    let cut = descriptor === -1 ? words.length : descriptor;
    for (let k = words.length; k >= 1; k--) {
      if (knownBrands.has(normalizeText(words.slice(0, k).join(" ")))) {
        cut = k;
        break;
      }
    }
    brand = words.slice(0, cut).join(" ");
    if (cut < words.length) descriptors.push(words.slice(cut).join(" "));
  }

  const product = tidy(p.product);
  const base = PRODUCT_NAMES[normalizeText(product)] ?? product;

  // Detalles que solo aparecen en "nombre" (y no son tamaño ni envase), con su grafía original.
  const words = (text: string) => tidy(text).split(/[\s,;]+/).map((w) => w.replace(/[.,]+$/, "")).filter(Boolean);
  const known = new Set(words(`${p.product} ${p.brand} ${p.spec}`).map(normalizeText));
  const seen = new Set<string>();
  for (const word of words((p.fullName ?? "").replace(/\bsin marca\b/gi, " "))) {
    const key = normalizeText(word);
    if (!key || known.has(key) || seen.has(key) || NOT_DETAIL.test(key)) continue;
    seen.add(key);
    descriptors.push(word);
  }

  const name = [base, brand, ...descriptors, cleanSpec(tidy(p.spec))]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { name, brand };
}

// ---------------------------------------------------------------- Precios

export interface Observation {
  /** ID_PrecioDiario: a igual fecha gana el más nuevo. */
  id: number;
  date: string;
  price: number;
  offer: boolean;
}

/** Último precio de cada producto en cada local: clave `${local}:${producto}`. */
export type LatestPrices = Map<string, Observation>;

export interface ReadPricesStats {
  rows: number;
  skipped: number;
  maxDate: string | null;
}

/**
 * Recorre precios_AAAA.csv línea por línea y se queda con el último precio de cada producto en cada local.
 * Se descartan los precios de ferias (Feria_id) y los de público específico (Publico, por ejemplo mayoristas).
 */
export async function readLatestPrices(
  lines: AsyncIterable<string> | Iterable<string>,
  storeIds: ReadonlySet<number>,
): Promise<{ latest: LatestPrices; stats: ReadPricesStats }> {
  const latest: LatestPrices = new Map();
  const stats: ReadPricesStats = { rows: 0, skipped: 0, maxDate: null };
  let col: Record<string, number> | null = null;

  for await (const line of lines) {
    if (!line.trim()) continue;
    const values = parseCsvLine(line, ",");
    if (!col) {
      col = Object.fromEntries(values.map((h, i) => [(h ?? "").trim(), i]));
      for (const required of ["ID_PrecioDiario", "Fecha", "Oferta", "Precio", "Establecimiento", "Presentacion_Producto"]) {
        if (!(required in col)) throw new Error(`precios: falta la columna ${required}`);
      }
      continue;
    }
    stats.rows++;
    const store = Number(values[col.Establecimiento!]);
    const product = Number(values[col.Presentacion_Producto!]);
    const price = Number(values[col.Precio!]);
    const date = values[col.Fecha!]?.slice(0, 10);
    const feria = col.Feria_id != null ? values[col.Feria_id] : null;
    const publico = col.Publico != null ? values[col.Publico] : null;
    if (
      !storeIds.has(store) ||
      !Number.isInteger(product) ||
      !(price > 0) ||
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      (feria != null && feria !== "" && feria !== "NA") ||
      (publico != null && publico !== "" && publico !== "NA")
    ) {
      stats.skipped++;
      continue;
    }
    const obs: Observation = { id: Number(values[col.ID_PrecioDiario!]), date, price, offer: values[col.Oferta!] === "1" };
    const key = `${store}:${product}`;
    const prev = latest.get(key);
    if (!prev || obs.date > prev.date || (obs.date === prev.date && obs.id > prev.id)) latest.set(key, obs);
    if (!stats.maxDate || date > stats.maxDate) stats.maxDate = date;
  }
  return { latest, stats };
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const m = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(m * 100) / 100;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export interface ChainPrice {
  productId: number;
  date: string;
  listPrice: number;
  salePrice: number | null;
  stores: number;
  offerStores: number;
}

export interface AggregateOptions {
  /** Locales cuyo último dato tiene más de estos días de atraso respecto del más nuevo de la cadena no cuentan. */
  storeWindowDays?: number;
  /** Fecha de corte (YYYY-MM-DD): los precios anteriores se ignoran (productos que ya no se relevan). */
  minDate?: string;
}

/**
 * Un precio por cadena y producto: la mediana del último precio de cada local de la cadena.
 * El precio de lista sale de los locales sin oferta; si en alguno había oferta, su mediana es el precio de oferta.
 */
export function aggregateByChain(
  latest: LatestPrices,
  chainOfStore: ReadonlyMap<number, string>,
  { storeWindowDays = 7, minDate }: AggregateOptions = {},
): Map<string, ChainPrice[]> {
  const groups = new Map<string, Map<number, Observation[]>>();
  for (const [key, obs] of latest) {
    if (minDate && obs.date < minDate) continue;
    const [store, product] = key.split(":").map(Number) as [number, number];
    const chain = chainOfStore.get(store);
    if (!chain) continue;
    const byProduct = groups.get(chain) ?? new Map<number, Observation[]>();
    const list = byProduct.get(product) ?? [];
    list.push(obs);
    byProduct.set(product, list);
    groups.set(chain, byProduct);
  }

  const result = new Map<string, ChainPrice[]>();
  for (const [chain, byProduct] of groups) {
    const prices: ChainPrice[] = [];
    for (const [productId, all] of byProduct) {
      const newest = all.reduce((d, o) => (o.date > d ? o.date : d), all[0]!.date);
      const recent = all.filter((o) => daysBetween(o.date, newest) <= storeWindowDays);
      const regular = recent.filter((o) => !o.offer).map((o) => o.price);
      const offers = recent.filter((o) => o.offer).map((o) => o.price);
      const listPrice = median(regular.length ? regular : offers);
      const sale = regular.length && offers.length ? median(offers) : null;
      prices.push({
        productId,
        date: newest,
        listPrice,
        salePrice: sale != null && sale < listPrice ? sale : null,
        stores: recent.length,
        offerStores: offers.length,
      });
    }
    result.set(chain, prices.sort((a, b) => a.productId - b.productId));
  }
  return result;
}

/** El listado que se guarda para un producto del SIPC en una cadena. */
export function toRawListing(
  product: SipcProduct,
  price: ChainPrice,
  year: number,
  knownBrands?: ReadonlySet<string>,
): RawListing {
  const { name, brand } = listingName(product, knownBrands);
  const allOffers = price.offerStores === price.stores;
  return {
    externalId: `sipc-${product.id}`,
    url: datasetUrl(year),
    name,
    brand,
    ean: null,
    imageUrl: null,
    listPrice: price.listPrice,
    salePrice: price.salePrice,
    promoText:
      price.offerStores === 0
        ? null
        : allOffers
          ? "Precio de oferta"
          : `Oferta en ${price.offerStores} de ${price.stores} locales`,
    available: true,
    source: "sipc",
    date: price.date,
  };
}

// ---------------------------------------------------------------- CKAN

export interface SipcResources {
  year: number;
  stores: string;
  products: string;
  prices: string;
}

interface CkanResource {
  url: string;
  name?: string;
}

/** Busca en la API de CKAN las URLs de los CSV del año (o del anterior, si el del año todavía no salió). */
export async function findResources(year: number, fetchImpl: typeof fetch = fetch): Promise<SipcResources> {
  for (const y of [year, year - 1]) {
    const res = await fetchImpl(`${CKAN_API}/package_show?id=${datasetName(y)}`);
    if (!res.ok) continue;
    const body = (await res.json()) as { success: boolean; result?: { resources: CkanResource[] } };
    if (!body.success || !body.result) continue;
    const files = body.result.resources.map((r) => r.url);
    const pick = (re: RegExp) => files.find((u) => re.test(u.split("/").pop() ?? ""));
    const stores = pick(/^establecimientos?\.csv$/i);
    const products = pick(/^productos\.csv$/i);
    const prices = pick(new RegExp(`^precios_${y}\\.csv$`, "i")) ?? pick(/^precios.*\.csv$/i);
    if (stores && products && prices) return { year: y, stores, products, prices };
    throw new Error(`SIPC ${y}: faltan archivos en el dataset (${files.join(", ")})`);
  }
  throw new Error(`No se encontró el dataset del SIPC de ${year} ni de ${year - 1}`);
}
