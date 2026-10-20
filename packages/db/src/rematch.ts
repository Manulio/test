import { AUTO_MATCH_THRESHOLD, normalizeText, scoreCandidate } from "@precios/matching";
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

/** Los números de un nombre ("130 x 225 cm", "x 2 10,5 W"), normalizados y ordenados. */
function numbersIn(name: string): string {
  return (normalizeText(name).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", ".")))).sort().join(" ");
}

const sameNumbers = (a: string, b: string) => numbersIn(a) === numbersIn(b);

/** Cadenas que comparten tienda online y números de producto: el mismo SKU es el mismo producto. */
export const SHARED_CATALOGS: readonly (readonly string[])[] = [["disco", "devoto", "geant"]];

interface ExactRow extends Record<string, unknown> {
  kind: "sku" | "name";
  keep_id: number; keep_name: string; keep_ean: string | null; keep_listings: number;
  merge_id: number; merge_name: string; merge_ean: string | null; merge_listings: number;
}

/**
 * Duplicados seguros, que no dependen de parecidos: el mismo SKU en cadenas que comparten tienda (Disco,
 * Devoto y Geant), y productos con exactamente el mismo nombre y tamaño (el mismo artículo con dos códigos
 * de barras, por ejemplo por un cambio de envase). Se juntan aunque una cadena venda los dos: para quien
 * compra son el mismo, y en la ficha se muestra el más barato de esa cadena.
 */
export async function findExactDuplicates(db: Db): Promise<DuplicatePair[]> {
  const groups = sql.join(
    SHARED_CATALOGS.map((slugs, i) => sql`select ${i}::int as grp, unnest(array[${sql.join(slugs.map((s) => sql`${s}`), sql`, `)}]::text[]) as slug`),
    sql` union all `,
  );
  const rows = await db.execute<ExactRow>(sql`
    with counts as (select product_id, count(*)::int as n from listings where product_id is not null group by product_id),
    info as (
      select p.id, p.name, p.ean, coalesce(c.n, 0) as listings,
        -- Queda el que tiene EAN; si no, el que tiene más listados; si no, el más viejo.
        row_number() over (order by (p.ean is null), coalesce(c.n, 0) desc, p.id) as pref
      from products p left join counts c on c.product_id = p.id
    ),
    shared as (${groups}),
    by_sku as (
      select distinct a.product_id as x, b.product_id as y, 'sku' as kind
      from listings a join chains ca on ca.id = a.chain_id join shared sa on sa.slug = ca.slug
      join listings b on b.external_id = a.external_id and b.product_id <> a.product_id and b.source = a.source
      join chains cb on cb.id = b.chain_id join shared sb on sb.slug = cb.slug and sb.grp = sa.grp
      where a.source = 'scraper' and a.product_id is not null and b.product_id is not null
    ),
    by_name as (
      select a.id as x, b.id as y, 'name' as kind
      from products a join products b
        on b.search_text = a.search_text and b.size_amount = a.size_amount and b.size_unit = a.size_unit and b.id <> a.id
      where a.size_amount is not null
    ),
    pairs as (select x, y, kind from by_sku union select x, y, kind from by_name)
    select distinct on (k.id, m.id) pairs.kind, k.id as keep_id, k.name as keep_name, k.ean as keep_ean, k.listings as keep_listings,
      m.id as merge_id, m.name as merge_name, m.ean as merge_ean, m.listings as merge_listings
    from pairs join info k on k.id = pairs.x join info m on m.id = pairs.y
    where k.pref < m.pref
    order by k.id, m.id, pairs.kind = 'name' desc
  `);
  const product = (id: number, name: string, ean: string | null, listings: number): ProductInfo => ({
    id, name, brand: null, ean, sizeAmount: null, sizeUnit: null, listings,
  });
  return [...rows]
    // El mismo SKU casi siempre es el mismo producto, pero no siempre ("Cortina 130 x 225 cm" y otra de 135 x 240
    // compartían número): se exige que los números del nombre coincidan y que no tengan EAN distintos.
    .filter((r) => r.kind === "name" || (sameNumbers(r.keep_name, r.merge_name) && !(r.keep_ean && r.merge_ean && r.keep_ean !== r.merge_ean)))
    .sort((a, b) => a.keep_id - b.keep_id || a.merge_id - b.merge_id)
    .map((r) => ({
    keep: product(r.keep_id, r.keep_name, r.keep_ean, r.keep_listings),
    merge: product(r.merge_id, r.merge_name, r.merge_ean, r.merge_listings),
    score: 1,
  }));
}

/**
 * Junta cada par moviendo los listados al producto que queda y borrando el otro. Si un producto aparece en
 * varios pares, se sigue la cadena (A ← B ← C termina todo en A). Devuelve cuántos productos se juntaron.
 * Salvo con `allowSameChain` (para duplicados seguros), no junta dos productos que una misma cadena vende.
 */
export async function mergeDuplicateProducts(
  db: Db,
  pairs: DuplicatePair[],
  { allowSameChain = false }: { allowSameChain?: boolean } = {},
): Promise<number> {
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
    if (!allowSameChain) {
      const [clash] = await db.execute<{ found: boolean }>(sql`
        select exists (
          select 1 from listings la join listings lb on lb.chain_id = la.chain_id and lb.source = la.source
          where la.product_id = ${into} and lb.product_id = ${from}
        ) as found
      `);
      if (clash?.found) continue;
    }
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
