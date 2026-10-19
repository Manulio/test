import type { Scraper } from "./types";
import { createVtexScraper } from "./vtex/scraper";

/**
 * Cadenas soportadas. Disco, Devoto y Geant son del mismo grupo y usan VTEX.
 * Para sumar una cadena con otra plataforma, se escribe un Scraper nuevo y se agrega acá.
 */
export const scrapers: Record<string, () => Scraper> = {
  disco: () => createVtexScraper({ chain: { slug: "disco", name: "Disco", website: "https://www.disco.com.uy" } }),
  devoto: () => createVtexScraper({ chain: { slug: "devoto", name: "Devoto", website: "https://www.devoto.com.uy" } }),
  geant: () => createVtexScraper({ chain: { slug: "geant", name: "Geant", website: "https://www.geant.com.uy" } }),
};
