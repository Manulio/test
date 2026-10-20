import type { ChainInfo, RawListing } from "@precios/db";

export type { ChainInfo, RawListing };

export interface ScrapeOptions {
  /** Corta después de esta cantidad de productos (útil para probar). */
  limit?: number;
  signal?: AbortSignal;
}

/** Cada cadena implementa esta interfaz; el resto del sistema no sabe cómo se obtienen los datos. */
export interface Scraper {
  chain: ChainInfo;
  fetchCatalog(options?: ScrapeOptions): AsyncIterable<RawListing>;
}
