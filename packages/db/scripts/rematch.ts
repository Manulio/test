/**
 * Junta productos del catálogo que son el mismo con otro nombre ("Yerba Mate Baldo 1 Kg" / "Yerba Baldo 1Kg").
 *   pnpm --filter @precios/db rematch           # muestra los pares, no cambia nada
 *   pnpm --filter @precios/db rematch --apply   # los junta
 */
import { createDb } from "../src/client";
import { findDuplicateProducts, mergeDuplicateProducts } from "../src/rematch";

const apply = process.argv.includes("--apply");
const db = createDb();
const pairs = await findDuplicateProducts(db);

for (const { keep, merge, score } of pairs) {
  console.log(`${score.toFixed(2)}  ${merge.name}  →  ${keep.name}`);
}
console.log(`\n${pairs.length} pares de productos duplicados.`);

if (apply) {
  console.log(`Productos juntados: ${await mergeDuplicateProducts(db, pairs)}`);
} else if (pairs.length > 0) {
  console.log("Para juntarlos: pnpm --filter @precios/db rematch --apply");
}
await db.$client.end();
