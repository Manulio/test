import { sql } from "drizzle-orm";
import type { Db } from "./client";

/**
 * Cadenas que se muestran en la web, se scrapean por defecto y se importan del SIPC: los supermercados
 * grandes de Montevideo. Se puede cambiar sin tocar el código con PRECIOS_CHAINS=disco,tata,...
 * Las demás quedan en la base (con active = false) pero no aparecen en ningún lado.
 */
export const ACTIVE_CHAINS: readonly string[] = process.env.PRECIOS_CHAINS
  ? process.env.PRECIOS_CHAINS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["disco", "devoto", "geant", "tata", "tienda-inglesa", "macromercado"];

/** Departamentos cuyos locales se usan para las medianas del SIPC. */
export const SIPC_DEPARTMENTS: readonly string[] = process.env.PRECIOS_DEPARTMENTS
  ? process.env.PRECIOS_DEPARTMENTS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["Montevideo"];

export const isActiveChain = (slug: string) => ACTIVE_CHAINS.includes(slug);

/** Marca como activas solo las cadenas de ACTIVE_CHAINS. Devuelve cuántas quedaron activas. */
export async function syncActiveChains(db: Db): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    with updated as (
      update chains set active = (slug in ${ACTIVE_CHAINS}) returning active
    )
    select count(*) filter (where active)::int as n from updated
  `);
  return rows[0]?.n ?? 0;
}

/** Condición SQL: el listado `alias` (por defecto "l") es de una cadena activa. */
export const fromActiveChain = (alias = "l") =>
  sql`${sql.raw(alias)}.chain_id in (select id from chains where active)`;
