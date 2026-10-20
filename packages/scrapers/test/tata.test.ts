import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createHttp } from "../src/http";
import {
  categoryFacets,
  channelFor,
  createTataScraper,
  fixMojibake,
  menuCategories,
  toRawListing,
  type TataProduct,
} from "../src/tata/scraper";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const products = fixture("tata-products.json");
const product = fixture("tata-product.json");
const menu = fixture("tata-menu.json");
const nodes = (products.data.search.products.edges as { node: TataProduct }[]).map((e) => e.node);
const base = "https://www.tata.com.uy";
const chain = { slug: "tata", name: "Ta-Ta", website: base };

describe("toRawListing", () => {
  it("lee la ficha con EAN, precio de lista y de oferta", () => {
    expect(toRawListing(product.data.product, base)).toEqual({
      externalId: "3366",
      url: "https://www.tata.com.uy/harina-0000-ca%C3%B1uelas-1-kg-3366/p",
      name: "Harina 0000 Cañuelas 1 Kg",
      brand: "Cañuelas",
      ean: "7730376000337",
      imageUrl: expect.stringContaining("tatauy.vtexassets.com"),
      listPrice: 59,
      salePrice: 45,
      promoText: null,
      available: true,
    });
  });

  it("el listado no trae EAN; sin descuento no hay precio de oferta", () => {
    expect(toRawListing(nodes[0]!, base)).toMatchObject({
      externalId: "8413",
      name: "Azúcar TaTa 1 Kg",
      brand: "TaTa",
      ean: null,
      listPrice: 43,
      salePrice: null,
    });
  });

  it("lo que se vende al peso trae el precio de lista por kilo: se lleva al paquete", () => {
    // Así responde la ficha de un queso de 220 g: el precio de lista (830) es el del kilo.
    const queso = (price: number) => ({
      ...nodes[0]!,
      unitMultiplier: 0.22,
      offers: { offers: [{ availability: "https://schema.org/InStock", price, listPrice: 830 }] },
    });
    expect(toRawListing(queso(182.6), base)).toMatchObject({ listPrice: 182.6, salePrice: null });
    expect(toRawListing(queso(150), base)).toMatchObject({ listPrice: 182.6, salePrice: 150 });
  });

  it("sin stock queda como no disponible y sin precio se descarta", () => {
    const offers = (o: object) => ({ ...nodes[0]!, offers: { offers: [{ ...nodes[0]!.offers!.offers![0], ...o }] } });
    expect(toRawListing(offers({ availability: "https://schema.org/OutOfStock" }), base)?.available).toBe(false);
    expect(toRawListing(offers({ price: 0 }), base)).toBeNull();
    expect(toRawListing({ ...nodes[0]!, offers: { offers: [] } }, base)).toBeNull();
  });
});

describe("fixMojibake", () => {
  it("repara UTF-8 leído como Latin-1 y deja el resto igual", () => {
    expect(fixMojibake("Harina 0000 CaÃ±uelas 1 Kg")).toBe("Harina 0000 Cañuelas 1 Kg");
    expect(fixMojibake("Azúcar TaTa 1 Kg")).toBe("Azúcar TaTa 1 Kg");
    expect(fixMojibake("Ñandú")).toBe("Ñandú");
  });
});

describe("helpers", () => {
  it("arma el canal de la región como lo hace la web", () => {
    expect(JSON.parse(channelFor("tatauymontevideo"))).toEqual({
      salesChannel: "4",
      regionId: "U1cjdGF0YXV5bW9udGV2aWRlbw==",
    });
  });

  it("convierte la ruta de la categoría en facetas", () => {
    expect(categoryFacets("/frescos/lacteos")).toEqual([
      { key: "category-1", value: "frescos" },
      { key: "category-2", value: "lacteos" },
    ]);
    expect(categoryFacets("/Textil?x=1")).toEqual([{ key: "category-1", value: "textil" }]);
  });

  it("lee el árbol de categorías del menú", () => {
    const cats = menuCategories(menu)!;
    expect(cats.map((c) => c.link)).toEqual(["/almacen", "/frescos"]);
    expect(cats[0]!.children!.map((c) => c.link)).toEqual(["/almacen/desayuno", "/almacen/aceites-y-aderezos"]);
    expect(menuCategories({ data: { cmsGlobal: {} } })).toBeNull();
  });
});

describe("createTataScraper", () => {
  type Vars = { first: number; after: string; sort: string; selectedFacets: { key: string; value: string }[] };
  const item = (sku: string): TataProduct => ({ ...nodes[0]!, sku, slug: `p-${sku}` });

  /** Simula la web: menú, listados por categoría (con el tope de 2500) y fichas. */
  function fakeSite(catalog: Record<string, TataProduct[]>, opts: { robots?: string; failDetail?: boolean } = {}) {
    const log: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      log.push(url.pathname + url.search);
      const json = (body: unknown) => new Response(JSON.stringify(body));
      if (url.pathname === "/robots.txt") return new Response(opts.robots ?? "User-agent: *\nAllow: /\nDisallow: /checkout/*");
      if (url.pathname === "/page-data/index/page-data.json") return json({ staticQueryHashes: ["111", "222"] });
      if (url.pathname === "/page-data/sq/d/111.json") return json({ data: { geolocations: { items: [] } } });
      if (url.pathname === "/page-data/sq/d/222.json") return json(menu);
      if (url.pathname !== "/api/graphql") return new Response("", { status: 404 });

      const op = url.searchParams.get("operationName");
      const vars = JSON.parse(url.searchParams.get("variables")!);
      if (op === "BrowserProductQuery") {
        if (opts.failDetail) return json({ errors: [{ message: "Sorry, something went wrong." }] });
        const sku = vars.locator.find((l: { key: string }) => l.key === "id").value;
        return json({ data: { product: { ...item(sku), ean: "7730376000337" } } });
      }
      const { first, after, sort, selectedFacets } = vars as Vars;
      expect(selectedFacets.find((f) => f.key === "channel")?.value).toBe(channelFor("tatauymontevideo"));
      const link = "/" + selectedFacets.filter((f) => f.key.startsWith("category-")).map((f) => f.value).join("/");
      const all = Object.entries(catalog).filter(([k]) => k === link || k.startsWith(`${link}/`)).flatMap(([, v]) => v);
      const from = Number(after);
      if (from >= 2500) return json({ errors: [{ message: "Sorry, something went wrong." }] });
      const sorted = sort === "price_desc" ? [...all].reverse() : all;
      const page = sorted.slice(from, Math.min(from + first, 2500));
      return json({
        data: { search: { products: { pageInfo: { totalCount: all.length }, edges: page.map((node) => ({ node })) } } },
      });
    }) as typeof fetch;
    return { http: createHttp({ delayMs: 0, retries: 0, fetchImpl }), log };
  }

  const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => item(`${prefix}${i}`));

  it("recorre las categorías del menú, pagina, completa el EAN y no repite productos", async () => {
    const { http } = fakeSite({
      "/almacen/desayuno/cafe": range("a", 70),
      "/frescos/lacteos/leches": [...range("f", 3), item("a0")],
    });
    const listings = [];
    for await (const l of createTataScraper({ chain, http }).fetchCatalog()) listings.push(l);

    expect(listings).toHaveLength(73);
    expect(new Set(listings.map((l) => l.externalId)).size).toBe(73);
    expect(listings.every((l) => l.ean === "7730376000337")).toBe(true);
    expect(listings[0]!.url).toBe("https://www.tata.com.uy/p-a0/p");
  });

  it("si una categoría pasa el tope de la búsqueda, baja a las subcategorías", async () => {
    const { http, log } = fakeSite({
      "/almacen/desayuno/cafe": range("c", 2000),
      "/almacen/aceites-y-aderezos/aceites": range("o", 1000),
    });
    const ids = new Set<string>();
    for await (const l of createTataScraper({ chain, http }).fetchCatalog()) ids.add(l.externalId);
    expect(ids.size).toBe(3000);
    const offsets = log.filter((u) => u.includes("ProductsQuery")).map((u) => Number(JSON.parse(new URLSearchParams(u.split("?")[1]).get("variables")!).after));
    expect(Math.max(...offsets)).toBeLessThan(2500);
  });

  it("una hoja con más de 2500 se lee de las dos puntas por precio", async () => {
    const { http } = fakeSite({ "/frescos/lacteos/huevos": range("h", 3000) });
    const ids = new Set<string>();
    for await (const l of createTataScraper({ chain, http }).fetchCatalog()) ids.add(l.externalId);
    expect(ids.size).toBe(3000);
  });

  it("respeta el límite", async () => {
    const { http, log } = fakeSite({ "/almacen/desayuno/cafe": range("a", 70) });
    const ids: string[] = [];
    for await (const l of createTataScraper({ chain, http }).fetchCatalog({ limit: 5 })) ids.push(l.externalId);
    expect(ids).toHaveLength(5);
    expect(log.filter((u) => u.includes("BrowserProductQuery"))).toHaveLength(5);
  });

  it("si fallan las fichas usa el listado sin EAN, y abandona si fallan muchas seguidas", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const few = fakeSite({ "/almacen/desayuno/cafe": range("a", 3) }, { failDetail: true });
    const listings = [];
    for await (const l of createTataScraper({ chain, http: few.http }).fetchCatalog()) listings.push(l);
    expect(listings.map((l) => [l.externalId, l.ean])).toEqual([["a0", null], ["a1", null], ["a2", null]]);

    const many = fakeSite({ "/almacen/desayuno/cafe": range("a", 30) }, { failDetail: true });
    const run = async () => {
      for await (const _ of createTataScraper({ chain, http: many.http }).fetchCatalog());
    };
    await expect(run()).rejects.toThrow("fichas seguidas fallaron");
  });

  it("no scrapea si robots.txt prohíbe la API", async () => {
    const { http } = fakeSite({}, { robots: "User-agent: *\nDisallow: /api/" });
    await expect(createTataScraper({ chain, http }).fetchCatalog()[Symbol.asyncIterator]().next()).rejects.toThrow(
      "robots.txt",
    );
  });
});
