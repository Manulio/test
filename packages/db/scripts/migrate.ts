import { migrate } from "drizzle-orm/postgres-js/migrator";
import { ACTIVE_CHAINS, syncActiveChains } from "../src/active-chains";
import { recategorizeProducts, refreshProductSizes } from "../src/categories";
import { createDb } from "../src/client";

const db = createDb();
await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
console.log("Migraciones aplicadas");
console.log(`Cadenas activas: ${await syncActiveChains(db)} (${ACTIVE_CHAINS.join(", ")})`);
console.log(`Categorías actualizadas: ${await recategorizeProducts(db)} productos`);
console.log(`Tamaños actualizados: ${await refreshProductSizes(db)} productos`);
await db.$client.end();
