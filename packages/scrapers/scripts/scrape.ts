/**
 * Uso:
 *   pnpm scrape                      # las cadenas activas (ACTIVE_CHAINS de @precios/db), guarda en la base
 *   pnpm scrape disco --limit 100    # una cadena, primeros 100 productos
 *   pnpm scrape disco --dry-run      # imprime JSON sin tocar la base
 *
 * Las cadenas se bajan en paralelo (cada una es otro sitio), pero se guardan de a un
 * producto por vez: si dos cadenas crean el mismo producto a la vez, quedaría duplicado.
 */
import { parseArgs } from "node:util";
import {
  ACTIVE_CHAINS,
  createDb,
  failScrapeRun,
  findExactDuplicates,
  finishScrapeRun,
  ingestListings,
  mergeDuplicateProducts,
  startScrapeRun,
} from "@precios/db";
import { scrapers } from "../src/chains";
import type { RawListing } from "../src/types";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

// Sin argumentos, solo las cadenas que se muestran en la web; las demás se pueden pedir por nombre.
const slugs = positionals.length > 0 ? positionals : Object.keys(scrapers).filter((s) => ACTIVE_CHAINS.includes(s));
const unknown = slugs.filter((s) => !scrapers[s]);
if (unknown.length > 0) {
  console.error(`Cadenas desconocidas: ${unknown.join(", ")}. Disponibles: ${Object.keys(scrapers).join(", ")}`);
  process.exit(1);
}
const limit = values.limit ? Number(values.limit) : undefined;
const db = values["dry-run"] ? null : createDb();
const PROGRESS_EVERY = 1000;

/** Turno único para escribir en la base: se toma al entregar un producto y se suelta al pedir el siguiente. */
let queue = Promise.resolve();
async function* oneAtATime(
  items: AsyncIterable<RawListing>,
  name: string,
  progress = { saved: 0 },
): AsyncIterable<RawListing> {
  for await (const item of items) {
    let release!: () => void;
    const previous = queue;
    queue = new Promise((r) => (release = r));
    await previous;
    try {
      yield item;
    } finally {
      release();
    }
    // Se llega acá cuando ya se pidió el siguiente, o sea que este se guardó.
    if (++progress.saved % PROGRESS_EVERY === 0) console.log(`${name}: ${progress.saved} productos…`);
  }
}

async function run(slug: string): Promise<boolean> {
  const scraper = scrapers[slug]!();
  const started = Date.now();
  const progress = { saved: 0 };
  // Cada corrida queda en scrape_runs (se ve en /admin/estado), también cuando falla.
  let runId: number | undefined;
  try {
    if (!db) {
      for await (const listing of scraper.fetchCatalog({ limit })) console.log(JSON.stringify(listing));
      return true;
    }
    runId = await startScrapeRun(db, scraper.chain);
    const items = oneAtATime(scraper.fetchCatalog({ limit }), scraper.chain.name, progress);
    const stats = await ingestListings(db, scraper.chain, items);
    await finishScrapeRun(db, runId, stats);
    console.log(`${scraper.chain.name}: ${JSON.stringify(stats)} en ${Math.round((Date.now() - started) / 1000)}s`);
    return true;
  } catch (error) {
    // Si una cadena falla, las demás siguen y el proceso termina marcado como fallido.
    console.error(`${scraper.chain.name}: falló`, error);
    if (db && runId != null) {
      await failScrapeRun(db, runId, error, progress.saved).catch((e: unknown) =>
        console.error(`${scraper.chain.name}: no se pudo registrar la falla`, e),
      );
    }
    return false;
  }
}

const results = await Promise.all(slugs.map(run));
if (db) {
  // Lo que se cargó separado y es seguro que es lo mismo (mismo SKU en Disco/Devoto/Geant, o mismo nombre y
  // tamaño): se junta para que no aparezca dos veces en la web.
  const merged = await mergeDuplicateProducts(db, await findExactDuplicates(db), { allowSameChain: true });
  if (merged > 0) console.log(`Productos duplicados juntados: ${merged}`);
}
await db?.$client.end();
process.exit(results.every(Boolean) ? 0 : 1);
