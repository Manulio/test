import { createDb } from "../src/client";
import { ingestListings } from "../src/ingest";
import { demoData } from "./demo-data";

const db = createDb();
for (const { chain, items } of demoData) {
  const stats = await ingestListings(db, chain, items);
  console.log(chain.name, stats);
}
await db.$client.end();
