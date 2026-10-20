import { sql } from "drizzle-orm";
import { fromActiveChain } from "./active-chains";
import type { Db } from "./client";

export interface PricePoint {
  date: string;
  /** Precio que pagaba el cliente ese día (el de oferta si había). */
  price: number;
}

export interface ChainHistory {
  chainSlug: string;
  chainName: string;
  source: "scraper" | "sipc";
  /** Ordenados por fecha. */
  points: PricePoint[];
}

/**
 * Precios de un producto en cada cadena durante los últimos `days` días. Si una cadena tiene precio
 * scrapeado y del SIPC el mismo día, gana el scrapeado; si vende el producto con dos SKUs, el más barato.
 */
export async function priceHistory(db: Db, productId: number, days = 180): Promise<ChainHistory[]> {
  const rows = await db.execute<{ slug: string; name: string; source: "scraper" | "sipc"; date: string; price: string }>(sql`
    select distinct on (c.slug, p.date)
      c.slug, c.name, l.source, p.date::text as date, coalesce(p.sale_price, p.list_price) as price
    from listings l
    join chains c on c.id = l.chain_id
    join prices p on p.listing_id = l.id
    where l.product_id = ${productId} and ${fromActiveChain()} and p.available and p.date >= current_date - ${days}::int
    order by c.slug, p.date, (l.source = 'sipc'), coalesce(p.sale_price, p.list_price)
  `);

  const byChain = new Map<string, ChainHistory>();
  for (const r of rows) {
    const chain = byChain.get(r.slug) ?? { chainSlug: r.slug, chainName: r.name, source: r.source, points: [] };
    if (r.source === "scraper") chain.source = "scraper";
    chain.points.push({ date: r.date, price: Number(r.price) });
    byChain.set(r.slug, chain);
  }
  return [...byChain.values()];
}
