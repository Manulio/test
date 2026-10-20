import { readFileSync } from "node:fs";
import { parseSize } from "@precios/matching";
import { describe, expect, it } from "vitest";
import {
  aggregateByChain,
  chainFor,
  cleanSpec,
  findResources,
  listingName,
  parseCsvLine,
  parseProducts,
  parseStores,
  readLatestPrices,
  toRawListing,
} from "./sipc";

const fixture = (name: string) => new URL(`../test/fixtures/sipc/${name}`, import.meta.url);
const latin1 = (name: string) => new TextDecoder("windows-1252").decode(readFileSync(fixture(name)));

const stores = parseStores(latin1("establecimiento.csv"));
const products = new Map(parseProducts(latin1("productos.csv")).map((p) => [p.id, p]));
const chainOfStore = new Map(stores.flatMap((s) => (chainFor(s.chain) ? [[s.id, chainFor(s.chain)!.slug] as const] : [])));

async function load() {
  const lines = readFileSync(fixture("precios_2026.csv"), "utf8").split("\n");
  return readLatestPrices(lines, new Set(chainOfStore.keys()));
}

describe("CSV del SIPC", () => {
  it("separa comillas, vacíos y \\N", () => {
    expect(parseCsvLine('1,"\\N",0,"a ""b"", c",,x\r', ",")).toEqual(["1", null, "0", 'a "b", c', "", "x"]);
    expect(parseCsvLine("1;Disco;", ";")).toEqual(["1", "Disco", ""]);
  });

  it("lee locales y productos en latin1", () => {
    expect(stores).toHaveLength(6);
    expect(stores.find((s) => s.id === 11)).toMatchObject({ chain: "Ta - Ta", department: "Paysandú" });
    expect(products.get(1)).toMatchObject({ product: "Aceite de girasol", brand: "Óptimo", spec: "Envase 900 cc" });
  });
});

describe("cadenas", () => {
  it("usa los slugs de las cadenas que ya conocemos y saltea los locales sin cadena", () => {
    expect(chainFor("Ta - Ta")).toMatchObject({ slug: "tata", name: "Ta-Ta" });
    expect(chainFor("Géant")).toMatchObject({ slug: "geant", name: "Geant" });
    expect(chainFor("El Dorado")?.slug).toBe("eldorado");
    expect(chainFor("Sin Cadena")).toBeNull();
    expect(chainFor("Planeta ")).toMatchObject({ slug: "planeta", name: "Planeta" });
    expect(chainFor("Supermercados 5 estrellas")?.slug).toBe("supermercados-5-estrellas");
  });
});

describe("nombres", () => {
  it("deja la especificación en un tamaño que parseSize entiende", () => {
    const size = (spec: string) => parseSize(`x ${cleanSpec(spec)}`);
    expect(cleanSpec("Envase 900 cc")).toBe("900 cc");
    expect(size("Botella 2,25.lt.")).toEqual({ amount: 2250, unit: "ml" });
    expect(size("Envase 1.250 lt.")).toEqual({ amount: 1250, unit: "ml" });
    expect(size("Paquete1 kg.")).toEqual({ amount: 1000, unit: "g" });
    expect(size("Caja 10 us.")).toEqual({ amount: 10, unit: "un" });
    expect(size("Envase 1/2 docena")).toEqual({ amount: 6, unit: "un" });
    expect(size("Paquete2 unidades")).toEqual({ amount: 2, unit: "un" });
    expect(size("1 unidad")).toEqual({ amount: 1, unit: "un" });
    expect(size(" 1.0 kilogramos")).toEqual({ amount: 1000, unit: "g" });
    expect(size("250 milimetros  ")).toEqual({ amount: 250, unit: "ml" });
    expect(size("Unidad aprox215 grs.")).toEqual({ amount: 215, unit: "g" });
  });

  it("separa la marca de lo que describe al producto", () => {
    expect(listingName(products.get(1)!)).toEqual({ name: "Aceite de girasol Óptimo 900 cc", brand: "Óptimo" });
    expect(listingName(products.get(14)!)).toEqual({ name: "Aguja vacuna Sin Hueso 1 kg", brand: null });
    expect(listingName(products.get(37)!)).toEqual({ name: "Chorizos mezcla Cattivelli sueltos Extra 1 kg", brand: "Cattivelli" });
    expect(listingName(products.get(66)!)).toEqual({ name: "Refresco Coca Cola 2,25 lt", brand: "Coca Cola" });
    expect(listingName(products.get(76)!)).toEqual({ name: "Huevos colorados El Jefe 6 un", brand: "El Jefe" });
  });

  it("suma los detalles que solo están en la columna nombre", () => {
    expect(listingName(products.get(338)!)).toEqual({ name: "Jabón de tocador Dove Blanco 90 grs", brand: "Dove" });
  });

  it("sin marca conocida, la corta antes de la primera palabra en minúscula", () => {
    const p = { id: 45, product: "Detergente para vajilla", brand: "Deterjane limón", spec: "Envase 1.250 lt." };
    expect(listingName(p)).toEqual({ name: "Detergente Deterjane limón 1.250 lt", brand: "Deterjane" });
  });

  it("recorta la marca a una del catálogo si la tiene como prefijo", () => {
    const p = { id: 46, product: "Detergente para vajilla", brand: "Hurra Nevex Limón", spec: "Envase 1.250 lt." };
    expect(listingName(p).brand).toBe("Hurra Nevex");
    expect(listingName(p, new Set(["hurra"]))).toEqual({ name: "Detergente Hurra Nevex Limón 1.250 lt", brand: "Hurra" });
    expect(listingName(products.get(81)!)).toEqual({ name: "Manteca Conaprole sin sal 200 grs", brand: "Conaprole" });
  });
});

describe("precios", () => {
  it("se queda con el último precio de cada local, sin ferias ni mayoristas", async () => {
    const { latest, stats } = await load();
    expect(stats).toMatchObject({ rows: 14, maxDate: "2026-06-30" });
    // Local 1 es "Sin Cadena": no se lee. El 107 es de feria y el 108 para mayoristas.
    expect(stats.skipped).toBe(3);
    expect(latest.get("10:1")).toMatchObject({ id: 101, price: 130 });
    expect(latest.get("11:1")).toMatchObject({ id: 102, price: 110 });
    // Mismo día, gana la declaración más nueva.
    expect(latest.get("12:1")).toMatchObject({ id: 105, price: 95, offer: true });
  });

  it("agrega por cadena con la mediana y marca las ofertas", async () => {
    const { latest } = await load();
    const byChain = aggregateByChain(latest, chainOfStore, { minDate: "2026-04-01" });
    const tata = byChain.get("tata")!;
    expect(tata.find((p) => p.productId === 1)).toEqual({
      productId: 1,
      date: "2026-06-30",
      listPrice: 120,
      salePrice: 95,
      stores: 3,
      offerStores: 1,
    });
    // El local con el dato de abril queda afuera: hay uno de junio.
    expect(tata.find((p) => p.productId === 14)).toMatchObject({ date: "2026-06-15", listPrice: 455, stores: 1 });
    expect(byChain.get("disco")).toEqual([
      { productId: 1, date: "2026-06-30", listPrice: 135, salePrice: null, stores: 1, offerStores: 0 },
    ]);
    // Los chorizos de Kinko son de enero, antes del corte.
    expect(byChain.get("kinko")!.map((p) => p.productId)).toEqual([81]);
  });

  it("arma el listado con la fecha real y origen sipc", async () => {
    const { latest } = await load();
    const byChain = aggregateByChain(latest, chainOfStore, { minDate: "2026-04-01" });
    const aceite = toRawListing(products.get(1)!, byChain.get("tata")!.find((p) => p.productId === 1)!, 2026);
    expect(aceite).toMatchObject({
      externalId: "sipc-1",
      name: "Aceite de girasol Óptimo 900 cc",
      listPrice: 120,
      salePrice: 95,
      promoText: "Oferta en 1 de 3 locales",
      source: "sipc",
      date: "2026-06-30",
    });
    const manteca = toRawListing(products.get(81)!, byChain.get("kinko")![0]!, 2026);
    expect(manteca).toMatchObject({ listPrice: 89, salePrice: null, promoText: "Precio de oferta" });
  });
});

describe("CKAN", () => {
  const resources = (y: number) => [
    { url: `https://x/download/establecimiento.csv` },
    { url: `https://x/download/productos.csv` },
    { url: `https://x/download/metadatos-productos.csv` },
    { url: `https://x/download/precios_${y}.csv` },
  ];

  it("encuentra los CSV del año, o del anterior si todavía no salió", async () => {
    const fake = (async (url: string) => {
      if (url.includes("2027")) return new Response(JSON.stringify({ success: false }), { status: 404 });
      return Response.json({ success: true, result: { resources: resources(2026) } });
    }) as typeof fetch;
    expect(await findResources(2027, fake)).toEqual({
      year: 2026,
      stores: "https://x/download/establecimiento.csv",
      products: "https://x/download/productos.csv",
      prices: "https://x/download/precios_2026.csv",
    });
  });
});
