import type { ChainInfo, RawListing } from "../src/ingest";

/**
 * Datos de ejemplo para desarrollo local. Los precios son inventados, y los nombres
 * imitan cómo escribe cada cadena para poner a prueba el matching.
 */
export const demoData: { chain: ChainInfo; items: RawListing[] }[] = [
  {
    chain: { slug: "disco", name: "Disco", website: "https://www.disco.com.uy" },
    items: [
      item("d1", "Leche Entera Conaprole 1 L", "Conaprole", "7730900571104", 52),
      item("d2", "Arroz Blanco Saman 1 Kg", "Saman", null, 79, 69, "Precio especial"),
      item("d3", "Yerba Mate Canarias 1 Kg", "Canarias", "7790387000306", 289),
      item("d4", "Aceite de Girasol Óptimo 900 ml", "Óptimo", null, 115),
      item("d5", "Refresco Coca-Cola 1,5 L", "Coca-Cola", "7790895000997", 105, 89),
      item("d6", "Fideos Tallarín Adria 500 g", "Adria", null, 62),
      item("d7", "Huevos Colorados Prodhin x 12", "Prodhin", null, 185),
    ],
  },
  {
    chain: { slug: "tienda-inglesa", name: "Tienda Inglesa", website: "https://www.tiendainglesa.com.uy" },
    items: [
      item("t1", "LECHE CONAPROLE ENTERA 1LT", "CONAPROLE", "7730900571104", 54),
      item("t2", "ARROZ SAMAN BLANCO 1KG", "SAMAN", null, 75),
      item("t3", "YERBA CANARIAS 1KG", "CANARIAS", "7790387000306", 279),
      item("t4", "ACEITE OPTIMO GIRASOL 900ML", "OPTIMO", null, 109),
      item("t5", "COCA COLA 1.5 LT", "COCA COLA", "7790895000997", 99, null, "2da unidad 50% off"),
      item("t8", "DULCE DE LECHE CONAPROLE 1KG", "CONAPROLE", null, 189),
    ],
  },
  {
    chain: { slug: "tata", name: "Ta-Ta", website: "https://www.tata.com.uy" },
    items: [
      item("ta1", "Leche Conaprole Entera 1 Lt", "Conaprole", "7730900571104", 51),
      item("ta2", "Arroz Saman Blanco 1 kg", "Saman", null, 82),
      item("ta4", "Aceite Optimo de Girasol 900 cc", "Optimo", null, 119, 99),
      item("ta6", "Fideos Adria Tallarín 500 gr", "Adria", null, 58),
      item("ta7", "Huevos colorados Prodhin 12 un", "Prodhin", null, 179),
      item("ta9", "Detergente Nevex Limón 750 ml", "Nevex", null, 98),
    ],
  },
];

function item(
  externalId: string,
  name: string,
  brand: string,
  ean: string | null,
  listPrice: number,
  salePrice: number | null = null,
  promoText: string | null = null,
): RawListing {
  return {
    externalId,
    url: `https://example.com/demo/${externalId}`,
    name,
    brand,
    ean,
    listPrice,
    salePrice,
    promoText,
    available: true,
  };
}
