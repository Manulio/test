import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import type { Db } from "./client";
import { MAX_PRICE_AGE_DAYS, offersFor, type ProductRow, type ProductWithOffers } from "./queries";

/** Descuentos menores no son ofertas que valga la pena mostrar. */
const MIN_DISCOUNT = 0.05;
/** Descuentos mayores casi siempre son errores de carga de la tienda (precio de lista inflado). */
const MAX_DISCOUNT = 0.8;

export interface DealQuery {
  category?: string;
  chain?: string;
  /** Empieza en 1. */
  page?: number;
  pageSize?: number;
}

export interface Deal {
  product: ProductWithOffers;
  /** Cadena con el mayor descuento sobre este producto. */
  chainSlug: string;
  /** Entre 0 y 1: 0,25 es 25 % menos que el precio de lista. */
  discount: number;
}

export interface DealPage {
  deals: Deal[];
  total: number;
  page: number;
  pageSize: number;
}

/** Último precio scrapeado de cada listado en oferta, con su descuento (necesita `chainFilter`). */
const currentSales = (chainFilter: ReturnType<typeof sql>) => sql`
  sales as (
    select distinct on (product_id) product_id, chain_slug, chain_name, discount
    from (
      select distinct on (l.id) l.product_id, c.slug as chain_slug, c.name as chain_name, pr.available,
        pr.sale_price, pr.list_price, 1 - pr.sale_price / pr.list_price as discount
      from listings l
      join chains c on c.id = l.chain_id
      join prices pr on pr.listing_id = l.id
      where l.product_id is not null and l.source = 'scraper' and ${fromActiveChain()}
        and pr.date >= current_date - ${MAX_PRICE_AGE_DAYS}::int
        ${chainFilter}
      order by l.id, pr.date desc
    ) latest
    where available and sale_price is not null and list_price > 0
      and discount >= ${MIN_DISCOUNT} and discount <= ${MAX_DISCOUNT}
    order by product_id, discount desc
  )
`;

/** Productos en oferta hoy, del mayor descuento al menor. Una fila por producto, con la cadena que más lo rebaja. */
export async function listDeals(db: Db, query: DealQuery = {}): Promise<DealPage> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 100);
  const page = Math.max(Math.floor(query.page ?? 1), 1);
  const chainFilter = query.chain ? sql`and c.slug = ${query.chain}` : sql``;
  const categoryFilter = query.category ? sql`where p.category = ${query.category}` : sql``;

  const rows = await db.execute<ProductRow & { chain_slug: string; discount: number; total: number }>(sql`
    with ${currentSales(chainFilter)}
    select p.id, p.name, p.brand, p.ean, p.size_amount, p.size_unit, p.image_url, p.category,
      s.chain_slug, s.discount::float8 as discount, count(*) over ()::int as total
    from sales s join products p on p.id = s.product_id
    ${categoryFilter}
    order by s.discount desc, (p.image_url is null), p.id
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `);
  const list = [...rows];
  const products = await offersFor(db, list);
  return {
    deals: list.map((r, i) => ({ product: products[i]!, chainSlug: r.chain_slug, discount: Number(r.discount) })),
    total: list[0]?.total ?? 0,
    page,
    pageSize,
  };
}

/** Cuántos productos tiene en oferta cada cadena, para los filtros. */
export async function dealChains(db: Db): Promise<{ slug: string; name: string; count: number }[]> {
  const rows = await db.execute<{ slug: string; name: string; count: number }>(sql`
    with ${currentSales(sql``)}
    select chain_slug as slug, chain_name as name, count(*)::int as count from sales group by 1, 2 order by 3 desc
  `);
  return [...rows];
}
