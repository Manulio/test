import { AUTO_MATCH_THRESHOLD, scoreCandidate } from "@precios/matching";
import { sql } from "drizzle-orm";
import type { Db } from "./client";

interface ProductInfo {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  sizeAmount: number | null;
  sizeUnit: "g" | "ml" | "un" | null;
  listings: number;
}

export interface DuplicatePair {
  keep: ProductInfo;
  merge: ProductInfo;
  score: number;
}

interface PairRow extends Record<string, unknown> {
  a_id: number; a_name: string; a_brand: string | null; a_ean: string | null; a_listings: number;
  b_id: number; b_name: string; b_brand: string | null; b_ean: string | null; b_listings: number;
}

/**
 * Busca productos del catálogo que son el mismo con otro nombre ("Yerba Mate Baldo 1 Kg" / "Yerba Baldo 1Kg"),
 * con las mismas reglas que el matching al cargar. No junta dos productos con EAN distinto ni dos que una misma
 * cadena vende por separado.
 */
export async function findDuplicateProducts(db: Db): Promise<DuplicatePair[]> {
  // El lateral va directo sobre products para que use el índice de trigramas.
  const rows = await db.execute<PairRow>(sql`
    with counts as (select product_id, count(*)::int as n from listings group by product_id)
    select a.id as a_id, a.name as a_name, a.brand as a_brand, a.ean as a_ean,
      coalesce(ca.n, 0) as a_listings,
      b.id as b_id, b.name as b_name, b.brand as b_brand, b.ean as b_ean,
      coalesce(cb.n, 0) as b_listings
    from products a
    cross join lateral (
      select b.id, b.name, b.brand, b.ean from products b
      where b.search_text % a.search_text and b.id > a.id and (a.ean is null or b.ean is null)
      order by similarity(b.search_text, a.search_text) desc
      limit 10
    ) b
    left join counts ca on ca.product_id = a.id
    left join counts cb on cb.product_id = b.id
    where not exists (
      select 1 from listings la join listings lb on lb.chain_id = la.chain_id and lb.source = la.source
      where la.product_id = a.id and lb.product_id = b.id
    )
  `);

  const info = (r: PairRow, side: "a" | "b"): ProductInfo => ({
    id: r[`${side}_id`],
    name: r[`${side}_name`],
    brand: r[`${side}_brand`],
    ean: r[`${side}_ean`],
    // El tamaño se vuelve a leer del nombre: el guardado pudo calcularse con una versión anterior.
    sizeAmount: null,
    sizeUnit: null,
    listings: r[`${side}_listings`],
  });

  const pairs: DuplicatePair[] = [];
  for (const row of rows) {
    const a = info(row, "a");
    const b = info(row, "b");
    const score = scoreCandidate(a, b);
    if (score < AUTO_MATCH_THRESHOLD) continue;
    // Queda el que tiene EAN; si no, el que tiene más listados; si no, el más viejo.
    const aFirst = Boolean(a.ean) !== Boolean(b.ean) ? Boolean(a.ean) : a.listings !== b.listings ? a.listings > b.listings : a.id < b.id;
    pairs.push(aFirst ? { keep: a, merge: b, score } : { keep: b, merge: a, score });
  }
  return pairs.sort((x, y) => y.score - x.score);
}

/**
 * Junta cada par moviendo los listados al producto que queda y borrando el otro. Si un producto aparece en
 * varios pares, se sigue la cadena (A ← B ← C termina todo en A). Devuelve cuántos productos se juntaron.
 */
export async function mergeDuplicateProducts(db: Db, pairs: DuplicatePair[]): Promise<number> {
  const target = new Map<number, number>();
  const resolve = (id: number): number => {
    let current = id;
    while (target.has(current)) current = target.get(current)!;
    return current;
  };

  let merged = 0;
  for (const { keep, merge } of pairs) {
    const into = resolve(keep.id);
    const from = resolve(merge.id);
    if (into === from) continue;
    // Después de juntar otros pares, los dos productos pueden haber sumado listados de una misma cadena
    // (A ← C y después B ← C, con A y B de la misma tienda): ahí ya no son el mismo producto.
    const [clash] = await db.execute<{ found: boolean }>(sql`
      select exists (
        select 1 from listings la join listings lb on lb.chain_id = la.chain_id and lb.source = la.source
        where la.product_id = ${into} and lb.product_id = ${from}
      ) as found
    `);
    if (clash?.found) continue;
    await db.transaction(async (tx) => {
      // Si el que se borra tiene EAN y el que queda no, se lo pasamos (primero se libera: el EAN es único).
      const [old] = await tx.execute<{ ean: string | null }>(sql`select ean from products where id = ${from}`);
      if (old?.ean) {
        await tx.execute(sql`update products set ean = null where id = ${from}`);
        await tx.execute(sql`update products set ean = ${old.ean} where id = ${into} and ean is null`);
      }
      await tx.execute(sql`
        update listings set product_id = ${into}, match_status = 'auto', match_candidate_id = null
        where product_id = ${from}
      `);
      await tx.execute(sql`update listings set match_candidate_id = null where match_candidate_id = ${from}`);
      await tx.execute(sql`delete from products where id = ${from}`);
    });
    target.set(from, into);
    merged++;
  }
  return merged;
}
