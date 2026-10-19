/**
 * Uso:
 *   pnpm scrape                      # todas las cadenas, guarda en la base
 *   pnpm scrape disco --limit 100    # una cadena, primeros 100 productos
 *   pnpm scrape disco --dry-run      # imprime JSON sin tocar la base
 */
import { parseArgs } from "node:util";
import { createDb, ingestListings } from "@precios/db";
import { scrapers } from "../src/chains";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const slugs = positionals.length > 0 ? positionals : Object.keys(scrapers);
const unknown = slugs.filter((s) => !scrapers[s]);
if (unknown.length > 0) {
  console.error(`Cadenas desconocidas: ${unknown.join(", ")}. Disponibles: ${Object.keys(scrapers).join(", ")}`);
  process.exit(1);
}
const limit = values.limit ? Number(values.limit) : undefined;
const db = values["dry-run"] ? null : createDb();
let failed = false;

for (const slug of slugs) {
  const scraper = scrapers[slug]!();
  const started = Date.now();
  try {
    if (!db) {
      for await (const listing of scraper.fetchCatalog({ limit })) console.log(JSON.stringify(listing));
      continue;
    }
    const stats = await ingestListings(db, scraper.chain, scraper.fetchCatalog({ limit }));
    console.log(`${scraper.chain.name}: ${JSON.stringify(stats)} en ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    // Si una cadena falla, seguimos con las demás y marcamos el proceso como fallido al final.
    failed = true;
    console.error(`${scraper.chain.name}: falló`, error);
  }
}

await db?.$client.end();
process.exit(failed ? 1 : 0);
