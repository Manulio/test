// Prepara la base de las e2e. Se corre con tsx desde e2e/server.mjs: `tsx e2e/db.mts reset|history`.
import { createDb } from "@precios/db";

const db = createDb();
const sql = db.$client;

if (process.argv[2] === "reset") {
  // Los tests de integración de packages/db vacían esta misma base: cada corrida arranca de cero.
  await sql`truncate scrape_runs, prices, listings, products, chains restart identity cascade`;
} else if (process.argv[2] === "history") {
  // El seed carga un solo precio por listado; se agregan precios viejos para que la ficha dibuje el historial.
  await sql`
    insert into prices (listing_id, date, list_price, sale_price, available)
    select listing_id, date - d, list_price + 4 * d / 7, null, true
    from prices, unnest(array[7, 14, 21]) as d
    on conflict do nothing
  `;
}
await sql.end();
