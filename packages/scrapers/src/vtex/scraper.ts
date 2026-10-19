import { createHttp, type Http } from "../http";
import { isAllowedByRobots } from "../robots";
import type { ChainInfo, RawListing, ScrapeOptions, Scraper } from "../types";
import type { VtexCategory, VtexItem, VtexProduct } from "./types";

export interface VtexConfig {
  chain: ChainInfo;
  /** Canal de venta (parámetro sc) cuando la tienda tiene precios distintos por región. */
  salesChannel?: string;
  /** Profundidad del árbol de categorías a recorrer. */
  categoryDepth?: number;
  http?: Http;
}

/** La API devuelve como máximo 50 productos por página y no deja pasar del producto 2500. */
const PAGE_SIZE = 50;
const MAX_OFFSET = 2500;

/** Categorías hoja con su ruta de ids, por ejemplo "/1/23/456/". */
export function leafCategoryPaths(tree: VtexCategory[], prefix = "/"): string[] {
  return tree.flatMap((c) => {
    const path = `${prefix}${c.id}/`;
    return c.hasChildren && c.children.length > 0 ? leafCategoryPaths(c.children, path) : [path];
  });
}

function promoText(item: VtexItem): string | null {
  const offer = defaultOffer(item);
  if (!offer) return null;
  const names = [
    ...(offer.PromotionTeasers ?? []).map((t) => t.Name),
    ...(offer.Teasers ?? []).map((t) => t.Name ?? t["<Name>k__BackingField"]),
  ].filter((n): n is string => Boolean(n));
  return names.length > 0 ? [...new Set(names)].join(" · ") : null;
}

function defaultOffer(item: VtexItem) {
  return (item.sellers.find((s) => s.sellerDefault) ?? item.sellers[0])?.commertialOffer;
}

/** Convierte un producto de VTEX en un listado por cada SKU con precio. */
export function toRawListings(product: VtexProduct): RawListing[] {
  return product.items.flatMap((item) => {
    const offer = defaultOffer(item);
    if (!offer || !(offer.Price > 0)) return [];
    const listPrice = Math.max(offer.ListPrice || 0, offer.PriceWithoutDiscount || 0, offer.Price);
    const name =
      product.items.length > 1 ? (item.nameComplete ?? `${product.productName} ${item.name}`) : product.productName;
    return [
      {
        externalId: item.itemId,
        url: product.link,
        name: name.trim(),
        brand: product.brand ?? null,
        ean: item.ean || null,
        imageUrl: item.images?.[0]?.imageUrl ?? null,
        listPrice,
        salePrice: offer.Price < listPrice ? offer.Price : null,
        promoText: promoText(item),
        available: offer.IsAvailable ?? offer.AvailableQuantity > 0,
      },
    ];
  });
}

export function createVtexScraper(config: VtexConfig): Scraper {
  const http = config.http ?? createHttp();
  const base = config.chain.website.replace(/\/$/, "");
  const sc = config.salesChannel ? `&sc=${encodeURIComponent(config.salesChannel)}` : "";

  return {
    chain: config.chain,
    async *fetchCatalog({ limit = Infinity, signal }: ScrapeOptions = {}) {
      const searchPath = "/api/catalog_system/pub/products/search";
      if (!isAllowedByRobots(await http.getText(`${base}/robots.txt`), searchPath)) {
        throw new Error(`${config.chain.name}: robots.txt no permite ${searchPath}`);
      }

      const tree = await http.getJson<VtexCategory[]>(
        `${base}/api/catalog_system/pub/category/tree/${config.categoryDepth ?? 3}`,
      );
      const seen = new Set<string>();
      let count = 0;

      for (const path of leafCategoryPaths(tree)) {
        for (let from = 0; from < MAX_OFFSET; from += PAGE_SIZE) {
          signal?.throwIfAborted();
          const url = `${base}${searchPath}?fq=C:${encodeURIComponent(path)}&_from=${from}&_to=${from + PAGE_SIZE - 1}${sc}`;
          const page = await http.getJson<VtexProduct[]>(url);

          for (const product of page) {
            for (const listing of toRawListings(product)) {
              // Un producto puede estar en varias categorías.
              if (seen.has(listing.externalId)) continue;
              seen.add(listing.externalId);
              yield listing;
              if (++count >= limit) return;
            }
          }
          if (page.length < PAGE_SIZE) break;
        }
      }
    },
  };
}
