import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createGduScraper,
  escapeLiteralPercents,
  gtinToEan,
  parseProductPage,
  promoTexts,
  shuffled,
  sitemapLocs,
} from "../src/gdu/scraper";
import { createHttp } from "../src/http";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const plain = fixture("gdu-product-plain.html");
const santander = fixture("gdu-product-santander.html");
// Ficha real de Geant rebajada: $ 668 tachado, $ 439 ahora, y 10 % más con Santander.
const sale = fixture("gdu-product-sale.html");
// Ficha real de Disco al peso: "$ 2620 / kg" y "$ 131" por los 50 g del nombre; el JSON-LD dice 2620.
const weighable = fixture("gdu-product-weighable.html");
const chain = { slug: "disco", name: "Disco", website: "https://www.disco.com.uy" };

describe("parseProductPage", () => {
  it("lee el JSON-LD de la ficha", () => {
    const url = "https://www.devoto.com.uy/product/dulce-de-leche-lapataia-440-g/220379";
    expect(parseProductPage(plain, url)).toEqual({
      externalId: "220379",
      url,
      name: "Dulce de leche LAPATAIA 440 g",
      brand: "LAPATAIA",
      ean: "7730406000023",
      imageUrl: expect.stringContaining("gdu-multimedia.azurewebsites.net"),
      listPrice: expect.any(Number),
      salePrice: null,
      promoText: "Edición Limitada",
      available: true,
    });
  });

  it("marca '-' es sin marca, sin gtin no hay EAN y el descuento con tarjeta va como promo", () => {
    expect(parseProductPage(santander, "https://www.disco.com.uy/product/x/341571")).toMatchObject({
      externalId: "341571",
      name: "Juego de Jardín en Madera Acacia 4 Piezas",
      brand: null,
      ean: null,
      listPrice: 36990,
      salePrice: null,
      promoText: "Santander 25%OFF $ 27742",
    });
  });

  it("descarta páginas sin producto, sin precio o en otra moneda", () => {
    expect(parseProductPage(sale, "https://www.geant.com.uy/product/pizza/110081")).toMatchObject({
      externalId: "110081",
      listPrice: 668,
      salePrice: 439,
      promoText: "Santander 10%OFF $ 395",
    });
    // Sin precio tachado (o uno que no es mayor), no hay oferta.
    expect(parseProductPage(plain, "u")).toMatchObject({ salePrice: null });
    expect(parseProductPage(sale.replace('<span class="val">668</span>', '<span class="val">439</span>'), "u")).toMatchObject({ listPrice: 439, salePrice: null });
    expect(parseProductPage(weighable, "u")).toMatchObject({
      externalId: "362382",
      name: "Jamón Crudo Español EL POZO Serrano x 50 g",
      listPrice: 131,
      salePrice: null,
    });
    expect(parseProductPage("<html></html>", "u")).toBeNull();
    expect(parseProductPage(plain.replace(/"price":[\d.]+/, '"price":0'), "u")).toBeNull();
    expect(parseProductPage(plain.replace('"priceCurrency":"UYU"', '"priceCurrency":"USD"'), "u")).toBeNull();
    expect(parseProductPage(plain.replaceAll("Dulce de leche LAPATAIA 440 g", "Envase Cerveza 1 L PRODUCTO NO COMERCIABLE"), "u")).toBeNull();
  });

  it("sin stock queda como no disponible", () => {
    const html = plain.replace("schema.org/InStock", "schema.org/OutOfStock");
    expect(parseProductPage(html, "u")?.available).toBe(false);
  });
});

describe("promoTexts", () => {
  it("ignora las promos de los carruseles de otros productos", () => {
    expect(promoTexts(santander)).toEqual(["Santander 25%OFF $ 27742"]);
  });
});

describe("gtinToEan", () => {
  it("pasa GTIN-14 a EAN-13", () => {
    expect(gtinToEan("07730406000023")).toBe("7730406000023");
    expect(gtinToEan("00614141000012")).toBe("0614141000012"); // UPC-A
  });

  it("descarta códigos internos y basura", () => {
    expect(gtinToEan("00000020433031")).toBeNull(); // EAN-8 interno (empieza con 2)
    expect(gtinToEan("02000000012345")).toBeNull(); // EAN-13 de uso interno
    expect(gtinToEan("")).toBeNull();
    expect(gtinToEan(undefined)).toBeNull();
    expect(gtinToEan("abc")).toBeNull();
  });
});

describe("shuffled", () => {
  it("mezcla sin perder elementos y repite el orden con la misma semilla", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = shuffled(items, 20261019);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(shuffled(items, 20261019)).toEqual(a);
    expect(shuffled(items, 20261020)).not.toEqual(a);
  });
});

describe("escapeLiteralPercents", () => {
  it("codifica los % sueltos de los nombres y deja los escapes válidos", () => {
    expect(escapeLiteralPercents("https://x.test/product/sabanas-100%-algodon/454293")).toBe("https://x.test/product/sabanas-100%25-algodon/454293");
    expect(escapeLiteralPercents("https://x.test/product/sabanas-100%algodon/1")).toBe("https://x.test/product/sabanas-100%25algodon/1");
    expect(escapeLiteralPercents("https://x.test/product/tony-32%180-g/7")).toBe("https://x.test/product/tony-32%25180-g/7");
    expect(escapeLiteralPercents("https://x.test/product/ca%C3%B1a/2")).toBe("https://x.test/product/ca%C3%B1a/2");
  });
});

describe("sitemapLocs", () => {
  it("lee las URLs y decodifica entidades", () => {
    const xml = `<urlset><url><loc>https://x.test/product/a/1</loc></url><url><loc> https://x.test/b?a=1&amp;b=2 </loc></url></urlset>`;
    expect(sitemapLocs(xml)).toEqual(["https://x.test/product/a/1", "https://x.test/b?a=1&b=2"]);
  });
});

describe("createGduScraper", () => {
  const base = chain.website;
  const index = `<sitemapindex><sitemap><loc>${base}/sitemap-1.xml</loc></sitemap><sitemap><loc>${base}/sitemap-2.xml</loc></sitemap></sitemapindex>`;
  const urlset = (paths: string[]) => `<urlset>${paths.map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>`;
  const page = (sku: string) => plain.replace('"sku":"220379"', `"sku":"${sku}"`);

  function fakeFetch(routes: Record<string, string | number>, log: string[]): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      log.push(url);
      const path = new URL(url).pathname;
      if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /cart");
      const body = routes[path];
      if (body === undefined) return new Response("", { status: 404 });
      if (typeof body === "number") return new Response("", { status: body });
      return new Response(body);
    }) as typeof fetch;
  }

  it("recorre el índice del sitemap, baja solo fichas y saltea las que ya no existen", async () => {
    const log: string[] = [];
    const http = createHttp({
      delayMs: 0,
      fetchImpl: fakeFetch(
        {
          "/sitemap.xml": index,
          "/sitemap-1.xml": urlset(["/product/a/1", "/product/b/2", "/products/category/almacen/10"]),
          "/sitemap-2.xml": urlset(["/product/c/3", "/product/borrado/4", "/product/a/1"]),
          "/product/a/1": page("1"),
          "/product/b/2": page("2"),
          "/product/c/3": page("3"),
        },
        log,
      ),
    });
    const ids: string[] = [];
    for await (const l of createGduScraper({ chain, http, concurrency: 2 }).fetchCatalog()) ids.push(l.externalId);

    expect(ids.sort()).toEqual(["1", "2", "3"]);
    expect(log.some((u) => u.includes("/products/category/"))).toBe(false);
    expect(log.filter((u) => u.endsWith("/product/a/1"))).toHaveLength(1);
  });

  it("respeta el límite", async () => {
    const paths = Array.from({ length: 10 }, (_, i) => `/product/p/${i}`);
    const routes: Record<string, string> = { "/sitemap.xml": urlset(paths) };
    for (const [i, p] of paths.entries()) routes[p] = page(String(i));
    const http = createHttp({ delayMs: 0, fetchImpl: fakeFetch(routes, []) });

    const ids: string[] = [];
    for await (const l of createGduScraper({ chain, http }).fetchCatalog({ limit: 4 })) ids.push(l.externalId);
    expect(ids).toHaveLength(4);
  });

  it("si el sitio frena, pausa, reintenta las fichas fallidas y al final abandona", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const paths = Array.from({ length: 30 }, (_, i) => `/product/p/${i}`);
    let blocked = true;
    const routes: Record<string, string> = { "/sitemap.xml": urlset(paths) };
    for (const [i, p] of paths.entries()) routes[p] = page(String(i));
    const base403 = fakeFetch(routes, []);
    const fetchImpl = (async (input: string) =>
      blocked && String(input).includes("/product/") ? new Response("", { status: 403 }) : base403(input)) as typeof fetch;

    // Se desbloquea durante la pausa: termina con todo, gracias a los reintentos.
    const http = createHttp({ delayMs: 0, retries: 0, fetchImpl });
    const ids: string[] = [];
    const scraper = createGduScraper({ chain, http, concurrency: 1, cooldownMs: 5, maxCooldowns: 1 });
    setTimeout(() => (blocked = false), 1);
    for await (const l of scraper.fetchCatalog()) ids.push(l.externalId);
    expect(ids.length).toBeGreaterThanOrEqual(20);

    // Si sigue bloqueado después de las pausas permitidas, falla.
    blocked = true;
    const stuck = createGduScraper({ chain, http: createHttp({ delayMs: 0, retries: 0, fetchImpl }), cooldownMs: 1, maxCooldowns: 1 });
    const run = async () => {
      for await (const _ of stuck.fetchCatalog());
    };
    await expect(run()).rejects.toThrow("fichas seguidas fallaron");
  });

  it("no scrapea si robots.txt prohíbe las fichas", async () => {
    const http = createHttp({
      delayMs: 0,
      fetchImpl: (async () => new Response("User-agent: *\nDisallow: /product/")) as typeof fetch,
    });
    await expect(createGduScraper({ chain, http }).fetchCatalog()[Symbol.asyncIterator]().next()).rejects.toThrow("robots.txt");
  });
});

describe("createHttp", () => {
  it("getHtml devuelve null en 404 y reintenta 503", async () => {
    let calls = 0;
    const http = createHttp({
      delayMs: 1,
      fetchImpl: (async (input: string) => {
        if (String(input).endsWith("/no")) return new Response("", { status: 404 });
        calls++;
        return calls < 2 ? new Response("", { status: 503 }) : new Response("ok");
      }) as typeof fetch,
    });
    await expect(http.getHtml("https://x.test/no")).resolves.toBeNull();
    await expect(http.getHtml("https://x.test/si")).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("espacia el inicio de requests concurrentes", async () => {
    const starts: number[] = [];
    const http = createHttp({
      delayMs: 30,
      fetchImpl: (async () => {
        starts.push(Date.now());
        return new Response("ok");
      }) as typeof fetch,
    });
    await Promise.all([1, 2, 3].map((i) => http.getHtml(`https://x.test/${i}`)));
    expect(starts[2]! - starts[0]!).toBeGreaterThanOrEqual(55);
  });
});
