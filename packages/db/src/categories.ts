import { categorize, parseSize } from "@precios/matching";
import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Vuelve a calcular la categoría de todos los productos y guarda solo las que cambiaron.
 * Corre después de cada migración, así un cambio en las reglas de categorías llega solo a la base.
 */
export async function recategorizeProducts(db: Db, batchSize = 1000): Promise<number> {
  const rows = await db.execute<{ id: number; name: string; brand: string | null; category: string }>(
    sql`select id, name, brand, category from products`,
  );
  const changed = [...rows]
    .map((r) => ({ id: r.id, category: categorize(r.name, r.brand), old: r.category }))
    .filter((r) => r.category !== r.old);

  for (let i = 0; i < changed.length; i += batchSize) {
    const values = sql.join(
      changed.slice(i, i + batchSize).map((r) => sql`(${r.id}::int, ${r.category}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      update products p set category = v.category
      from (values ${values}) as v(id, category)
      where p.id = v.id
    `);
  }
  return changed.length;
}

/** Vuelve a calcular el tamaño de cada producto a partir del nombre, por si cambiaron las reglas (packs, promos). */
export async function refreshProductSizes(db: Db, batchSize = 1000): Promise<number> {
  const rows = await db.execute<{ id: number; name: string; size_amount: number | null; size_unit: string | null }>(
    sql`select id, name, size_amount, size_unit from products`,
  );
  const changed = [...rows]
    .map((r) => ({ id: r.id, size: parseSize(r.name), old: r }))
    .filter(({ size, old }) => (size?.amount ?? null) !== old.size_amount || (size?.unit ?? null) !== old.size_unit);

  for (let i = 0; i < changed.length; i += batchSize) {
    const values = sql.join(
      changed
        .slice(i, i + batchSize)
        .map((r) => sql`(${r.id}::int, ${r.size?.amount ?? null}::real, ${r.size?.unit ?? null}::size_unit)`),
      sql`, `,
    );
    await db.execute(sql`
      update products p set size_amount = v.amount, size_unit = v.unit
      from (values ${values}) as v(id, amount, unit)
      where p.id = v.id
    `);
  }
  return changed.length;
}
