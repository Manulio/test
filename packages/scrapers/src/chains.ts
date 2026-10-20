import { createGduScraper } from "./gdu/scraper";
import { createTataScraper } from "./tata/scraper";
import type { Scraper } from "./types";
import { createVtexScraper } from "./vtex/scraper";

/**
 * Cadenas soportadas. Disco, Devoto y Geant son del mismo grupo (GDU) y comparten tienda online.
 * El Dorado usa VTEX, con su API pública de catálogo. Ta-Ta es VTEX con FastStore: usamos su GraphQL.
 * Para sumar una cadena con otra plataforma, se escribe un Scraper nuevo y se agrega acá.
 */
export const scrapers: Record<string, () => Scraper> = {
  disco: () => createGduScraper({ chain: { slug: "disco", name: "Disco", website: "https://www.disco.com.uy" } }),
  devoto: () => createGduScraper({ chain: { slug: "devoto", name: "Devoto", website: "https://www.devoto.com.uy" } }),
  geant: () => createGduScraper({ chain: { slug: "geant", name: "Geant", website: "https://www.geant.com.uy" } }),
  eldorado: () =>
    createVtexScraper({ chain: { slug: "eldorado", name: "El Dorado", website: "https://www.eldorado.com.uy" } }),
  tata: () => createTataScraper({ chain: { slug: "tata", name: "Ta-Ta", website: "https://www.tata.com.uy" } }),
};
