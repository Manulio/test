import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { getProducts, type ProductWithOffers } from "./queries";
import { mergeDuplicateProducts } from "./rematch";

/** Un listado que el matching dejó en duda, con el producto que sugirió. */
export interface ReviewItem {
  listing: {
    id: number;
    name: string;
    brand: string | null;
    ean: string | null;
    imageUrl: string | null;
    url: string;
    chainName: string;
    /** Último precio cargado (el de oferta si hay). */
    price: number | null;
    listPrice: number | null;
    date: string | null;
    /** Producto propio que se le creó mientras se revisa. */
    productId: number;
    /** Cuántos otros listados (de otras cadenas) ya cayeron en ese producto propio. */
    siblings: number;
  };
  score: number;
  candidate: ProductWithOffers;
}

export interface ReviewPage {
  items: ReviewItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface ReviewRow extends Record<string, unknown> {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  image_url: string | null;
  url: string;
  chain_name: string;
  product_id: number;
  candidate_id: number;
  score: number;
  list_price: string | null;
  sale_price: string | null;
  date: string | null;
  siblings: number;
  total: number;
}

const pending = sql`l.match_status = 'review' and l.match_candidate_id is not null`;

/** Casos dudosos del matching, del más probable al menos probable. */
export async function listReviewQueue(db: Db, { page = 1, pageSize = 20 } = {}): Promise<ReviewPage> {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = await db.execute<ReviewRow>(sql`
    select l.id, l.name, l.brand, l.ean, l.image_url, l.url, c.name as chain_name,
      l.product_id, l.match_candidate_id as candidate_id, coalesce(l.match_score, 0) as score,
      pr.list_price, pr.sale_price, pr.date::text as date,
      (select count(*)::int from listings o where o.product_id = l.product_id and o.id <> l.id) as siblings,
      count(*) over ()::int as total
    from listings l
    join chains c on c.id = l.chain_id
    left join lateral (
      select list_price, sale_price, date from prices where listing_id = l.id order by date desc limit 1
    ) pr on true
    where ${pending}
    order by l.match_score desc nulls last, l.id
    limit ${pageSize} offset ${offset}
  `);

  const candidates = await getProducts(db, rows.map((r) => r.candidate_id));
  const items = rows.flatMap((r): ReviewItem[] => {
    const candidate = candidates.find((p) => p.id === r.candidate_id);
    if (!candidate) return [];
    const listPrice = r.list_price == null ? null : Number(r.list_price);
    const salePrice = r.sale_price == null ? null : Number(r.sale_price);
    return [
      {
        listing: {
          id: r.id,
          name: r.name,
          brand: r.brand,
          ean: r.ean,
          imageUrl: r.image_url,
          url: r.url,
          chainName: r.chain_name,
          price: salePrice ?? listPrice,
          listPrice,
          date: r.date,
          productId: r.product_id,
          siblings: r.siblings,
        },
        score: r.score,
        candidate,
      },
    ];
  });

  // Si la página quedó vacía (por ejemplo, se revisó la última), el total sale aparte.
  const total = rows[0]?.total ?? (await countReviewQueue(db));
  return { items, total, page, pageSize };
}

export async function countReviewQueue(db: Db): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from listings l where ${pending}`);
  return row?.n ?? 0;
}

export type ReviewOutcome = "merged" | "moved" | "clash" | "not-found";

/**
 * "Es el mismo": el listado pasa al producto sugerido. Si su producto propio no tiene otros listados, se junta
 * entero con el sugerido (y se borra) con la misma lógica que rematch; si tiene, se mueve solo este listado.
 * No hace nada ("clash") si la misma cadena ya vende el producto sugerido por separado.
 */
export async function confirmReviewMatch(db: Db, listingId: number): Promise<ReviewOutcome> {
  const [row] = await db.execute<{ product_id: number; candidate_id: number; chain_id: number; source: string; siblings: number }>(sql`
    select l.product_id, l.match_candidate_id as candidate_id, l.chain_id, l.source,
      (select count(*)::int from listings o where o.product_id = l.product_id and o.id <> l.id) as siblings
    from listings l where l.id = ${listingId} and ${pending}
  `);
  if (!row) return "not-found";

  const [clash] = await db.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from listings where product_id = ${row.candidate_id} and chain_id = ${row.chain_id} and source = ${row.source}
    ) as found
  `);
  if (clash?.found) return "clash";

  if (row.siblings === 0) {
    const info = (id: number) => ({ id, name: "", brand: null, ean: null, sizeAmount: null, sizeUnit: null, listings: 0 });
    const merged = await mergeDuplicateProducts(db, [{ keep: info(row.candidate_id), merge: info(row.product_id), score: 1 }]);
    if (merged === 0) return "clash";
    await db.execute(sql`update listings set match_status = 'manual' where id = ${listingId}`);
    return "merged";
  }

  await db.execute(sql`
    update listings set product_id = ${row.candidate_id}, match_status = 'manual', match_candidate_id = null
    where id = ${listingId}
  `);
  return "moved";
}

/** "Son distintos": queda en su producto propio y no vuelve a aparecer en la revisión. */
export async function rejectReviewMatch(db: Db, listingId: number): Promise<boolean> {
  const rows = await db.execute(sql`
    update listings l set match_status = 'manual', match_candidate_id = null
    where l.id = ${listingId} and ${pending}
    returning l.id
  `);
  return rows.length > 0;
}
