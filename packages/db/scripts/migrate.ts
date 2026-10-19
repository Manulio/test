import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/client";

const db = createDb();
await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
console.log("Migraciones aplicadas");
await db.$client.end();
