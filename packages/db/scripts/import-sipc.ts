/**
 * Importa los precios de los datos abiertos del SIPC (MEF / Defensa del Consumidor).
 *
 * Uso:
 *   pnpm import:sipc                          # baja los CSV del año en curso y guarda en la base (cadenas activas, locales de Montevideo)
 *   pnpm import:sipc --dry-run                # muestra cómo se cruzaría cada producto, sin escribir
 *   pnpm import:sipc --dir ./sipc             # usa CSV ya bajados (establecimiento.csv, productos.csv, precios_AAAA.csv)
 *   pnpm import:sipc --chains tata,kinko      # esas cadenas en vez de las activas (slugs nuestros)
 *   pnpm import:sipc --departments Montevideo,Canelones  # locales de esos departamentos
 *   pnpm import:sipc --year 2025 --max-age-days 60
 *
 * De cada producto se toma el último precio de cada local y se guarda, por cadena, la mediana entre locales,
 * con la fecha real del dato (el SIPC se publica con meses de atraso). Los listados quedan con source "sipc".
 */
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { normalizeText } from "@precios/matching";
import { sql } from "drizzle-orm";
import { ACTIVE_CHAINS, createDb, ingestListings, previewMatch, SIPC_DEPARTMENTS } from "../src";
import {
  aggregateByChain,
  chainFor,
  findResources,
  parseProducts,
  parseStores,
  readLatestPrices,
  toRawListing,
  type SipcResources,
} from "../src/sipc";

const { values } = parseArgs({
  options: {
    year: { type: "string" },
    dir: { type: "string" },
    chains: { type: "string" },
    departments: { type: "string" },
    "max-age-days": { type: "string", default: "90" },
    "dry-run": { type: "boolean", default: false },
  },
});

const year = Number(values.year ?? new Date().getFullYear());
const maxAgeDays = Number(values["max-age-days"]);
// Por defecto, solo las cadenas activas y los locales de Montevideo (ver active-chains.ts).
const onlyChains = new Set(values.chains ? values.chains.split(",").map((s) => s.trim()) : ACTIVE_CHAINS);
const departments = new Set(
  (values.departments ? values.departments.split(",") : SIPC_DEPARTMENTS).map((d) => normalizeText(d)),
);

const latin1 = new TextDecoder("windows-1252");

async function readSmall(source: string): Promise<string> {
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
    return latin1.decode(await res.arrayBuffer());
  }
  return latin1.decode(await readFile(source));
}

/** Líneas de un CSV grande, bajándolo o leyéndolo de a pedazos (nunca entero en memoria). */
async function streamLines(source: string): Promise<AsyncIterable<string>> {
  let input: Readable;
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok || !res.body) throw new Error(`${source}: HTTP ${res.status}`);
    input = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  } else {
    input = createReadStream(source);
  }
  input.setEncoding("latin1");
  return createInterface({ input, crlfDelay: Infinity });
}

async function resources(): Promise<SipcResources> {
  if (!values.dir) return findResources(year);
  const dir = values.dir;
  return {
    year,
    stores: join(dir, "establecimiento.csv"),
    products: join(dir, "productos.csv"),
    prices: join(dir, `precios_${year}.csv`),
  };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

const res = await resources();
console.log(`SIPC ${res.year}: ${res.prices}`);
const stores = parseStores(await readSmall(res.stores));
const sipcProducts = new Map(parseProducts(await readSmall(res.products)).map((p) => [p.id, p]));

// Local → slug de nuestra cadena (los "Sin Cadena" y los filtrados por --chains quedan afuera).
const chainBySlug = new Map<string, NonNullable<ReturnType<typeof chainFor>>>();
const chainOfStore = new Map<number, string>();
for (const store of stores) {
  const chain = chainFor(store.chain);
  if (!chain || !onlyChains.has(chain.slug)) continue;
  if (!departments.has(normalizeText(store.department ?? ""))) continue;
  chainBySlug.set(chain.slug, chain);
  chainOfStore.set(store.id, chain.slug);
}
console.log(
  `${stores.length} locales (${chainOfStore.size} en ${chainBySlug.size} cadenas, en ${[...departments].join(", ")}), ${sipcProducts.size} productos`,
);

const started = Date.now();
const { latest, stats } = await readLatestPrices(await streamLines(res.prices), new Set(chainOfStore.keys()));
console.log(
  `${stats.rows} precios leídos en ${Math.round((Date.now() - started) / 1000)} s (${stats.skipped} descartados), último dato: ${stats.maxDate}`,
);
if (!stats.maxDate) throw new Error("El archivo de precios no tiene datos");

const minDate = addDays(stats.maxDate, -maxAgeDays);
const byChain = aggregateByChain(latest, chainOfStore, { minDate });

const db = createDb();
try {
  const brandRows = await db.execute<{ brand: string }>(sql`select distinct brand from products where brand is not null`);
  const knownBrands = new Set(brandRows.map((r) => normalizeText(r.brand)));

  if (values["dry-run"]) {
    // Los productos son los mismos en todas las cadenas: alcanza con mirar cada uno una vez.
    const seen = new Map<number, Parameters<typeof toRawListing>[1]>();
    for (const prices of byChain.values()) for (const p of prices) if (!seen.has(p.productId)) seen.set(p.productId, p);
    const rows: string[] = [];
    for (const [id, price] of [...seen].sort((a, b) => a[0] - b[0])) {
      const product = sipcProducts.get(id);
      if (!product) continue;
      const raw = toRawListing(product, price, res.year, knownBrands);
      const { result, candidate } = await previewMatch(db, raw);
      rows.push(
        [id, result.kind, result.score.toFixed(3), `${raw.name} [${raw.brand ?? "-"}]`, candidate ? `${candidate.name} [${candidate.brand ?? "-"}]` : ""].join("\t"),
      );
    }
    console.log(["id", "match", "score", "sipc", "catálogo"].join("\t"));
    for (const row of rows) console.log(row);
    for (const [slug, prices] of byChain) console.log(`${slug}: ${prices.length} productos, último dato ${prices.reduce((d, p) => (p.date > d ? p.date : d), "")}`);
  } else {
    for (const [slug, prices] of [...byChain].sort((a, b) => a[0].localeCompare(b[0]))) {
      const items = prices.flatMap((p) => {
        const product = sipcProducts.get(p.productId);
        return product ? [toRawListing(product, p, res.year, knownBrands)] : [];
      });
      const result = await ingestListings(db, chainBySlug.get(slug)!, items);
      console.log(`${slug}: ${JSON.stringify(result)}`);
    }
  }
} finally {
  await db.$client.end();
}
