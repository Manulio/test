import { describe, expect, it } from "vitest";
import { createHttp } from "../src/http";
import { isAllowedByRobots } from "../src/robots";
import { createVtexScraper, leafCategoryPaths, toRawListings } from "../src/vtex/scraper";
import type { VtexCategory, VtexProduct } from "../src/vtex/types";
import search from "./fixtures/vtex-search.json";

const products = search as VtexProduct[];
const chain = { slug: "disco", name: "Disco", website: "https://www.disco.com.uy" };

describe("toRawListings", () => {
  it("toma precio de lista, de oferta y promociones", () => {
    expect(toRawListings(products[0]!)).toEqual([
      {
        externalId: "5001",
        url: "https://www.disco.com.uy/leche-entera-conaprole-1-l/p",
        name: "Leche Entera Conaprole 1 L",
        brand: "Conaprole",
        ean: "7730900571104",
        imageUrl: "https://img.example/leche.jpg",
        listPrice: 52,
        salePrice: 49,
        promoText: "Precio especial lácteos",
        available: true,
      },
    ]);
  });

  it("usa el nombre completo del SKU y descarta los que no tienen precio", () => {
    const listings = toRawListings(products[1]!);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      name: "Agua Salus sin gas 600 ml",
      ean: null,
      salePrice: null,
      available: false,
    });
  });
});

describe("leafCategoryPaths", () => {
  it("devuelve solo las categorías hoja con la ruta completa", () => {
    const tree: VtexCategory[] = [
      {
        id: 1, name: "Almacén", url: "", hasChildren: true,
        children: [
          { id: 2, name: "Arroz", url: "", hasChildren: false, children: [] },
          { id: 3, name: "Pastas", url: "", hasChildren: false, children: [] },
        ],
      },
      { id: 9, name: "Frutas", url: "", hasChildren: false, children: [] },
    ];
    expect(leafCategoryPaths(tree)).toEqual(["/1/2/", "/1/3/", "/9/"]);
  });
});

describe("createVtexScraper", () => {
  function fakeFetch(routes: Record<string, unknown>, log: string[]): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      log.push(url);
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /checkout");
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify(routes[key]), { status: 200 });
    }) as typeof fetch;
  }

  it("recorre categorías, pagina y no repite SKUs", async () => {
    const log: string[] = [];
    const page = Array.from({ length: 50 }, (_, i) => ({ ...products[0]!, items: [{ ...products[0]!.items[0]!, itemId: `s${i}` }] }));
    const http = createHttp({
      delayMs: 0,
      fetchImpl: fakeFetch(
        {
          "category/tree": [
            { id: 1, name: "A", url: "", hasChildren: false, children: [] },
            { id: 2, name: "B", url: "", hasChildren: false, children: [] },
          ],
          "C:%2F1%2F&_from=0": page,
          "C:%2F1%2F&_from=50": [products[1]],
          // El mismo SKU aparece también en la categoría 2.
          "C:%2F2%2F&_from=0": [page[0]],
        },
        log,
      ),
    });

    const scraper = createVtexScraper({ chain, http });
    const ids: string[] = [];
    for await (const l of scraper.fetchCatalog()) ids.push(l.externalId);

    expect(ids).toHaveLength(51);
    expect(new Set(ids).size).toBe(51);
    expect(log.filter((u) => u.includes("products/search"))).toHaveLength(3);
  });

  it("respeta el límite", async () => {
    const http = createHttp({
      delayMs: 0,
      fetchImpl: fakeFetch(
        { "category/tree": [{ id: 1, name: "A", url: "", hasChildren: false, children: [] }], "_from=0": products },
        [],
      ),
    });
    const ids: string[] = [];
    for await (const l of createVtexScraper({ chain, http }).fetchCatalog({ limit: 1 })) ids.push(l.externalId);
    expect(ids).toEqual(["5001"]);
  });

  it("reintenta cuando el sitio responde 429", async () => {
    let calls = 0;
    const http = createHttp({
      delayMs: 1,
      fetchImpl: (async () => {
        calls++;
        return calls < 3 ? new Response("", { status: 429 }) : new Response("[]");
      }) as typeof fetch,
    });
    await expect(http.getJson("https://x.test/a")).resolves.toEqual([]);
    expect(calls).toBe(3);
  });
});

describe("createHttp", () => {
  it("reintenta errores de red y termina fallando si persisten", async () => {
    let calls = 0;
    const http = createHttp({
      delayMs: 1,
      retries: 2,
      fetchImpl: (async () => {
        calls++;
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(http.getJson("https://x.test/a")).rejects.toThrow("fetch failed");
    expect(calls).toBe(3);
  });
});

describe("isAllowedByRobots", () => {
  const robots = `
User-agent: *
Disallow: /api/
Allow: /api/catalog_system/pub/
Disallow: /*?map=

User-agent: BadBot
Disallow: /
`;

  it("aplica la regla más específica", () => {
    expect(isAllowedByRobots(robots, "/api/catalog_system/pub/products/search")).toBe(true);
    expect(isAllowedByRobots(robots, "/api/checkout")).toBe(false);
    expect(isAllowedByRobots(robots, "/almacen?map=c")).toBe(false);
    expect(isAllowedByRobots(robots, "/almacen")).toBe(true);
  });

  it("sin robots.txt todo está permitido", () => {
    expect(isAllowedByRobots(null, "/api/x")).toBe(true);
  });
});
