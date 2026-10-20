import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoData } from "../scripts/demo-data";
import { createDb, type Db } from "./client";
import { ingestListings } from "./ingest";
import { compareChains } from "./compare";
import { findDuplicateProducts, findExactDuplicates, mergeDuplicateProducts } from "./rematch";
import { confirmReviewMatch, listReviewQueue, rejectReviewMatch } from "./review";
import { listings, products } from "./schema";
import { catalogChains, categoryCounts, findProductByEan, getProduct, listCatalog, searchProducts } from "./queries";
import { dealChains, listDeals } from "./deals";
import { brandRanking } from "./brands";
import { priceHistory } from "./history";
import { basketIndex } from "./price-index";
import { shoppingStrategies } from "./strategies";
import { failScrapeRun, finishScrapeRun, scrapeStatus, startScrapeRun } from "./scrape-runs";

// Necesita una base Postgres vacía con las migraciones aplicadas (TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ingesta y búsqueda", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url);
    await db.execute(sql`truncate scrape_runs, prices, listings, products, chains restart identity cascade`);
    for (const { chain, items } of demoData) await ingestListings(db, chain, items);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("agrupa el mismo producto de varias cadenas", async () => {
    const [leche] = await searchProducts(db, "leche entera");
    expect(leche!.offers.map((o) => o.chainSlug).sort()).toEqual(["disco", "tata", "tienda-inglesa"]);
    expect(leche!.offers[0]).toMatchObject({ chainSlug: "tata", price: 51, unitPrice: 51 });
  });

  it("asocia productos sin EAN por nombre", async () => {
    const [arroz] = await searchProducts(db, "arroz saman");
    expect(arroz!.offers).toHaveLength(3);
    // El precio de oferta de Disco (69) gana a los de lista.
    expect(arroz!.offers[0]).toMatchObject({ chainSlug: "disco", price: 69, listPrice: 79 });
  });

  it("encuentra sin tildes y con errores de tipeo", async () => {
    const [aceite] = await searchProducts(db, "aceite óptimo");
    expect(aceite!.offers).toHaveLength(3);
    const results = await searchProducts(db, "yerva canarias");
    expect(results[0]!.name).toMatch(/Yerba/i);
    // Una sola palabra mal escrita no llega al umbral de pg_trgm: la encuentra la segunda pasada, tolerante.
    const yerba = await listCatalog(db, { q: "yerva" });
    expect(yerba).toMatchObject({ fuzzy: true });
    expect(yerba.products[0]!.name).toMatch(/Yerba/i);
    expect(await listCatalog(db, { q: "yerba" })).toMatchObject({ fuzzy: false });
    expect(await listCatalog(db, { q: "xqzwv" })).toMatchObject({ total: 0, products: [], fuzzy: false });
  });

  it("un reescrapeo del mismo día actualiza el precio en vez de duplicarlo", async () => {
    const disco = demoData[0]!;
    await ingestListings(db, disco.chain, [{ ...disco.items[0]!, listPrice: 60 }]);
    const [leche] = await searchProducts(db, "leche entera conaprole");
    const product = await getProduct(db, leche!.id);
    const offer = product!.offers.find((o) => o.chainSlug === "disco");
    expect(offer!.price).toBe(60);
    expect(product!.offers.filter((o) => o.chainSlug === "disco")).toHaveLength(1);
  });

  it("arma el catálogo por categoría, paginado y ordenado", async () => {
    const counts = await categoryCounts(db);
    expect(counts.lacteos).toBeGreaterThan(0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    const all = await listCatalog(db, { pageSize: 2 });
    expect(all.total).toBe(total);
    expect(all.products).toHaveLength(2);
    const second = await listCatalog(db, { pageSize: 2, page: 2 });
    expect(second.products.map((p) => p.id)).not.toContain(all.products[0]!.id);

    const lacteos = await listCatalog(db, { category: "lacteos" });
    expect(lacteos.total).toBe(counts.lacteos);
    expect(lacteos.products.every((p) => p.category === "lacteos")).toBe(true);

    const byPrice = await listCatalog(db, { sort: "precio" });
    const prices = byPrice.products.map((p) => p.offers.find((o) => o.available)?.price ?? Infinity);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const empty = await listCatalog(db, { page: 99 });
    expect(empty).toMatchObject({ products: [], total });
  });

  it("ordena el catálogo por precio por kg/L, con los productos sin tamaño al final", async () => {
    await ingestListings(db, demoData[0]!.chain, [
      { externalId: "bolsa1", url: "https://example.com", name: "Bolsa Reutilizable Disco", listPrice: 5, available: true },
    ]);
    const { products, total } = await listCatalog(db, { sort: "precio-unidad", pageSize: 100 });
    expect(products).toHaveLength(total);
    const kinds = products.map((p) => (p.sizeUnit == null ? 2 : p.sizeUnit === "un" ? 1 : 0));
    expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
    expect(products.at(-1)!.name).toBe("Bolsa Reutilizable Disco");
    const perKgL = products.filter((p) => p.sizeUnit === "g" || p.sizeUnit === "ml").map((p) => p.offers.find((o) => o.available)!.unitPrice!);
    expect(perKgL.length).toBeGreaterThan(3);
    expect(perKgL).toEqual([...perKgL].sort((a, b) => a - b));
    // Las páginas siguen el mismo orden.
    const page2 = await listCatalog(db, { sort: "precio-unidad", pageSize: 3, page: 2 });
    expect(page2.products.map((p) => p.id)).toEqual(products.slice(3, 6).map((p) => p.id));
  });

  it("filtra por cadena con su precio de hoy, y los conteos coinciden", async () => {
    const chains = await catalogChains(db);
    const ti = chains.find((c) => c.slug === "tienda-inglesa")!;
    const result = await listCatalog(db, { chain: "tienda-inglesa", sort: "precio", pageSize: 100 });
    expect(result.total).toBe(ti.count);
    expect(result.products.every((p) => p.offers.some((o) => o.chainSlug === "tienda-inglesa" && o.available))).toBe(true);
    const tiPrices = result.products.map((p) => p.offers.find((o) => o.chainSlug === "tienda-inglesa")!.price);
    expect(tiPrices).toEqual([...tiPrices].sort((a, b) => a - b));
    // La bolsa solo está en Disco.
    expect(result.products.map((p) => p.name)).not.toContain("Bolsa Reutilizable Disco");

    const counts = await categoryCounts(db, "tienda-inglesa");
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(result.total);
    const [category, count] = Object.entries(counts)[0]!;
    expect((await listCatalog(db, { chain: "tienda-inglesa", category })).total).toBe(count);
    expect((await catalogChains(db, category)).find((c) => c.slug === "tienda-inglesa")?.count).toBe(count);
    const paged = await listCatalog(db, { chain: "tienda-inglesa", sort: "precio", pageSize: 2, page: 2 });
    expect(paged.total).toBe(result.total);
    expect(paged.products.map((p) => p.id)).toEqual(result.products.slice(2, 4).map((p) => p.id));

    // En Ta-Ta el aceite está rebajado a 99: ordena y se ve con ese precio, no con el más barato de otra cadena.
    const aceite = await listCatalog(db, { q: "aceite", chain: "tata", sort: "precio-unidad" });
    expect(aceite.total).toBe(1);
    expect(aceite.products[0]!.offers.find((o) => o.chainSlug === "tata")).toMatchObject({ price: 99, unitPrice: 110 });
    expect((await listCatalog(db, { chain: "no-existe" })).total).toBe(0);
  });

  it("compara cadenas sobre los productos que comparten", async () => {
    const report = await compareChains(db);
    expect(report.compared).toBeGreaterThan(0);
    expect(report.chains.map((c) => c.slug).sort()).toEqual(["disco", "tata", "tienda-inglesa"]);
    expect(report.chains[0]!.index).toBe(100);

    const two = await compareChains(db, { chains: ["disco", "tata"], categories: ["lacteos"] });
    expect(two.chains.map((c) => c.slug).sort()).toEqual(["disco", "tata"]);
    expect(two.pairs).toHaveLength(1);
  });

  it("muestra precios del SIPC con su fecha, sin ganarle al scrapeado de la misma cadena", async () => {
    const disco = demoData[0]!;
    const leche = disco.items[0]!;
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
    const sipc = { ...leche, externalId: "sipc-1", listPrice: 10, salePrice: null, source: "sipc" as const, date: old };
    await ingestListings(db, disco.chain, [sipc]);
    await ingestListings(db, { slug: "macromercado", name: "Macromercado", website: "https://example.com" }, [sipc]);
    // Kinko no está entre las cadenas activas (ACTIVE_CHAINS): sus precios se guardan pero no se muestran.
    await ingestListings(db, { slug: "kinko", name: "Kinko", website: "https://example.com" }, [{ ...sipc, listPrice: 5 }]);

    const [found] = await searchProducts(db, "leche entera conaprole");
    const offers = found!.offers;
    expect(offers.find((o) => o.chainSlug === "disco")).toMatchObject({ source: "scraper" });
    expect(offers.at(-1)).toMatchObject({ chainSlug: "macromercado", source: "sipc", price: 10, date: old });
    expect(offers[0]!.source).toBe("scraper");
    expect(offers.some((o) => o.chainSlug === "kinko")).toBe(false);

    // Disco se scrapea: su precio del SIPC no aparece ni siquiera en un producto que su tienda online no tiene.
    const soloSipc = { externalId: "sipc-2", url: "https://example.com", name: "Producto Solo Sipc Prueba 1 kg", listPrice: 30, available: true, source: "sipc" as const, date: old };
    await ingestListings(db, disco.chain, [soloSipc]);
    await ingestListings(db, { slug: "macromercado", name: "Macromercado", website: "https://example.com" }, [{ ...soloSipc, listPrice: 28 }]);
    const [solo] = await searchProducts(db, "producto solo sipc prueba");
    expect(solo!.offers.map((o) => o.chainSlug)).toEqual(["macromercado"]);
  });

  it("no junta dos productos que la misma cadena vende por separado, y junta duplicados entre cadenas", async () => {
    const chain = { slug: "prueba-yerba", name: "Prueba", website: "https://example.com" };
    const yerba = (externalId: string, name: string) => ({ externalId, url: "https://example.com", name, listPrice: 200, available: true });
    await ingestListings(db, chain, [yerba("y1", "Yerba Baldo 1Kg"), yerba("y2", "Yerba Mate Baldo 1 Kg")]);
    const ids = (await db.execute<{ product_id: number }>(sql`
      select l.product_id from listings l join chains c on c.id = l.chain_id where c.slug = 'prueba-yerba'
    `)).map((r) => r.product_id);
    expect(new Set(ids).size).toBe(2);
    expect((await findDuplicateProducts(db)).some((p) => ids.includes(p.keep.id) && ids.includes(p.merge.id))).toBe(false);

    // Un duplicado de otra cadena (como los que quedaron antes de mejorar el matching) sí se junta.
    const [dup] = await db
      .insert(products)
      .values({ name: "Yerba Mate Baldo 1 Kg", searchText: "yerba mate baldo 1 kg", category: "almacen" })
      .returning({ id: products.id });
    const [other] = await db.execute<{ id: number }>(sql`select id from chains where slug = 'disco'`);
    await db.insert(listings).values({ chainId: other!.id, externalId: "dup-1", productId: dup!.id, url: "https://example.com", name: "Yerba Mate Baldo 1 Kg" });

    const pairs = (await findDuplicateProducts(db)).filter((p) => p.merge.id === dup!.id || p.keep.id === dup!.id);
    expect(pairs.length).toBeGreaterThan(0);
    await mergeDuplicateProducts(db, pairs);
    // Los tres listados quedan en dos productos: el duplicado se juntó con uno de los de la cadena de prueba.
    const after = await db.execute<{ n: number }>(sql`
      select count(distinct product_id)::int as n from listings where external_id in ('y1', 'y2', 'dup-1')
    `);
    expect(after[0]!.n).toBe(2);
  });

  it("separa la leche fresca de la ultra y la larga vida, y junta cada una aunque se escriba distinto", async () => {
    const leche = (externalId: string, name: string, ean: string | null = null) => ({
      externalId, url: "https://example.com", name, brand: "Conaprole", ean, listPrice: 50, available: true,
    });
    // Como El Dorado: vende la fresca y la ultra a la vez, cada una con su EAN.
    await ingestListings(db, { slug: "prueba-eldorado", name: "Prueba", website: "https://example.com" }, [
      leche("e1", "Leche Conaprole Descremada 1Lt .", "7730105001284"),
      leche("e2", "Leche Conaprole Ultra Descremada 1Lt .", "7730105001338"),
      leche("e3", "Leche ultra CONAPROLE entera 1 L", "7730105001321"),
    ]);
    // Como Tata: sin EAN y con otro nombre.
    await ingestListings(db, { slug: "prueba-tata", name: "Prueba", website: "https://example.com" }, [
      leche("t1", "Leche Fresca Descremada Conaprole Sachet 1 L"),
      leche("t2", "Leche Ultra Descremada Conaprole 1 L"),
      leche("t3", "Leche Ultrapasteurizada Entera Conaprole Sachet 1 L"),
      leche("t4", "Leche Fresca Entera Conaprole Sachet 1 L"),
      leche("t5", "Leche Descremada Larga Vida Conaprole Caja 1 L"),
    ]);
    const rows = await db.execute<{ external_id: string; product_id: number; match_status: string }>(sql`
      select l.external_id, l.product_id, l.match_status from listings l join chains c on c.id = l.chain_id
      where c.slug in ('prueba-eldorado', 'prueba-tata')
    `);
    const product = Object.fromEntries(rows.map((r) => [r.external_id, r.product_id]));
    expect(rows.filter((r) => r.external_id.startsWith("t") && r.external_id !== "t5").every((r) => r.match_status === "auto")).toBe(true);
    expect(product.t1).toBe(product.e1);
    expect(product.t2).toBe(product.e2);
    expect(product.t3).toBe(product.e3);
    const [fresca] = await searchProducts(db, "leche entera conaprole");
    expect(product.t4).toBe(fresca!.id);
    expect(new Set([product.e1, product.e2, product.e3, product.t4, product.t5]).size).toBe(5);

    const ids = Object.values(product);
    expect((await findDuplicateProducts(db)).filter((p) => ids.includes(p.keep.id) || ids.includes(p.merge.id))).toEqual([]);
  });

  it("revisa a mano los casos dudosos: une o separa y no vuelven a aparecer", async () => {
    const chain = { slug: "prueba-revision", name: "Revisión", website: "https://example.com" };
    const item = (externalId: string, name: string) => ({ externalId, url: "https://example.com", name, listPrice: 100, available: true });
    await ingestListings(db, chain, [item("r1", "Galletitas Maná 300 g"), item("r2", "Galletitas Maná 400 g"), item("r3", "Galletitas Maná 500 g")]);
    const target = await db.insert(products)
      .values({ name: "Galletitas Mana Vainilla", searchText: "galletitas mana vainilla", category: "almacen" })
      .returning({ id: products.id });
    const ids = (await db.execute<{ id: number; product_id: number }>(sql`
      select l.id, l.product_id from listings l where external_id in ('r1', 'r2', 'r3') order by external_id
    `));
    // Se marcan a mano como dudosos (el matching real depende del puntaje), con distinto score para ver el orden.
    for (const [i, l] of ids.entries()) {
      await db.execute(sql`
        update listings set match_status = 'review', match_candidate_id = ${target[0]!.id}, match_score = ${0.7 - i * 0.05}
        where id = ${l.id}
      `);
    }

    const queue = await listReviewQueue(db, { pageSize: 2 });
    expect(queue.total).toBeGreaterThanOrEqual(3);
    const ours = (await listReviewQueue(db, { pageSize: 100 })).items.filter((i) => i.candidate.id === target[0]!.id);
    expect(ours.map((i) => i.listing.id)).toEqual(ids.map((l) => l.id));
    expect(ours[0]).toMatchObject({ listing: { chainName: "Revisión", price: 100, siblings: 0 }, score: expect.closeTo(0.7) });

    // "Es el mismo": el listado pasa al sugerido y se borra su producto propio, que quedó vacío.
    expect(await confirmReviewMatch(db, ids[0]!.id)).toBe("merged");
    const [moved] = await db.execute<{ product_id: number; match_status: string }>(sql`select product_id, match_status from listings where id = ${ids[0]!.id}`);
    expect(moved).toMatchObject({ product_id: target[0]!.id, match_status: "manual" });
    expect(await db.execute(sql`select 1 from products where id = ${ids[0]!.product_id}`)).toHaveLength(0);

    // La misma cadena ya vende el sugerido: no se puede juntar otro listado suyo.
    expect(await confirmReviewMatch(db, ids[1]!.id)).toBe("clash");

    // "Son distintos": sale de la cola y queda en su producto.
    expect(await rejectReviewMatch(db, ids[2]!.id)).toBe(true);
    expect(await rejectReviewMatch(db, ids[2]!.id)).toBe(false);
    const left = (await listReviewQueue(db, { pageSize: 100 })).items.map((i) => i.listing.id);
    expect(left).not.toContain(ids[0]!.id);
    expect(left).not.toContain(ids[2]!.id);
    expect(left).toContain(ids[1]!.id);
  });

  it("ordena la búsqueda por relevancia: lo que se busca antes que lo que solo lo menciona", async () => {
    // El mismo EAN en las tres cadenas: compite en cantidad de cadenas con la leche de la demo.
    for (const [i, { chain }] of demoData.entries()) {
      await ingestListings(db, chain, [
        { externalId: `ddl${i}`, url: "https://example.com", name: "Dulce de Leche Conaprole 1 kg", ean: "7730900570015", listPrice: 250, available: true },
        { externalId: `pnl${i}`, url: "https://example.com", name: "Panales Pampers Confort Sec G 36 un", ean: "7500435126274", listPrice: 900, available: true },
      ]);
    }
    await ingestListings(db, demoData[0]!.chain, [
      { externalId: "pan1", url: "https://example.com", name: "Pan Flauta 215 g", listPrice: 49, available: true },
    ]);
    expect((await searchProducts(db, "leche"))[0]!.name).toMatch(/^Leche/i);
    expect((await searchProducts(db, "dulce de leche"))[0]!.name).toMatch(/^Dulce de Leche/i);
    // "pan" aparece dentro de "panales", pero no como palabra: va después aunque esté en menos cadenas.
    expect((await searchProducts(db, "pan")).map((p) => p.name)).toEqual(["Pan Flauta 215 g", "Panales Pampers Confort Sec G 36 un"]);
  });

  it("cruza por EAN aunque haya muchos productos de nombre parecido, y nunca repite un EAN", async () => {
    const ean = "7730103300242";
    const item = (externalId: string, name: string, code: string | null) => ({ externalId, url: "https://example.com", name, ean: code, listPrice: 100, available: true });
    // Más productos parecidos que el límite de candidatos del matching.
    await ingestListings(
      db,
      { slug: "ean-a", name: "EAN A", website: "https://example.com" },
      Array.from({ length: 25 }, (_, i) => item(`a${i}`, `Galletitas Prueba Coco ${i + 1} 150 g`, null)),
    );
    await ingestListings(db, { slug: "ean-b", name: "EAN B", website: "https://example.com" }, [item("b0", "Producto Distinto Cualquiera 1 kg", ean)]);
    const stats = await ingestListings(db, { slug: "ean-c", name: "EAN C", website: "https://example.com" }, [item("c1", "Galletitas Prueba Coco 150 g", ean)]);
    expect(stats).toMatchObject({ listings: 1, matchedByEan: 1 });
    expect(await db.execute(sql`select id from products where ean = ${ean}`)).toHaveLength(1);
  });

  it("lista ofertas, arma el historial y encuentra por código de barras", async () => {
    // En la demo, el arroz Saman está rebajado en Disco: 69 en vez de 79.
    const deals = await listDeals(db);
    const arroz = deals.deals.find((d) => /arroz/i.test(d.product.name));
    expect(arroz).toMatchObject({ chainSlug: "disco", discount: expect.closeTo(1 - 69 / 79, 3) });
    expect(deals.deals.map((d) => d.discount)).toEqual([...deals.deals.map((d) => d.discount)].sort((a, b) => b - a));
    expect((await listDeals(db, { chain: "tata" })).deals.every((d) => d.chainSlug === "tata")).toBe(true);
    expect((await dealChains(db)).find((c) => c.slug === "disco")?.count).toBeGreaterThan(0);

    const [leche] = await searchProducts(db, "leche entera conaprole");
    const disco = demoData[0]!;
    await ingestListings(db, disco.chain, [{ ...disco.items[0]!, listPrice: 55 }], "2026-01-10");
    const history = await priceHistory(db, leche!.id, 10_000);
    const discoHistory = history.find((h) => h.chainSlug === "disco")!;
    expect(discoHistory.points[0]).toEqual({ date: "2026-01-10", price: 55 });
    expect(discoHistory.points.length).toBeGreaterThan(1);

    expect(await findProductByEan(db, "7730900571104")).toBe(leche!.id);
    // El mismo código como GTIN-14, con ceros adelante.
    expect(await findProductByEan(db, "07730900571104")).toBe(leche!.id);
    expect(await findProductByEan(db, "7790000000013")).toBeNull();
  });

  it("registra cada scrapeo y arma el estado por cadena", async () => {
    const chain = { slug: "estado-test", name: "Estado Test", website: "https://example.com" };
    const item = (id: string, name: string, salePrice: number | null) => ({
      externalId: id, url: `https://example.com/${id}`, name, listPrice: 100, salePrice, available: true,
    });
    const okRun = await startScrapeRun(db, chain);
    const stats = await ingestListings(db, chain, [item("e1", "Fideos Estado Moñita 500 g", 80), item("e2", "Polenta Estado 1 kg", null)]);
    await finishScrapeRun(db, okRun, stats);
    const failed = await startScrapeRun(db, chain);
    await failScrapeRun(db, failed, new Error("Failed query: insert…", { cause: new Error("clave duplicada") }), 7);

    const status = (await scrapeStatus(db)).find((s) => s.chainSlug === "estado-test")!;
    expect(status).toMatchObject({ pricedToday: 2, onSaleToday: 1, stale: false, running: null });
    expect(status.lastOk!.stats).toEqual(stats);
    expect(status.lastError).toMatchObject({ listings: 7, message: "Failed query: insert…\nCausa: clave duplicada" });
    expect(status.lastUpdate).toEqual(status.lastOk!.finishedAt);
    // Las cadenas de la demo no tienen corridas registradas: cuenta su último precio scrapeado.
    expect((await scrapeStatus(db)).find((s) => s.chainSlug === "disco")).toMatchObject({ stale: false, lastOk: null });

    // Una corrida sin terminar se ve como "en curso"; pasadas 36 h sin otro ok, la cadena queda marcada.
    await startScrapeRun(db, chain);
    const later = (await scrapeStatus(db, new Date(Date.now() + 37 * 3_600_000))).find((s) => s.chainSlug === "estado-test")!;
    expect(later).toMatchObject({ stale: true, pricedToday: 0, onSaleToday: 0 });
    expect(later.running).not.toBeNull();
  });

  it("calcula el índice de la canasta por cadena y día", async () => {
    // EAN-13 válidos (con dígito verificador): los inválidos se descartan al ingerir.
    const eans = ["7790000011016", "7790000021022", "7790000031038", "7790000041044", "7790000051050"];
    const basket = ["Garbanzo", "Lenteja", "Poroto", "Avena", "Semola"].map((word, i) => ({ ean: eans[i]!, label: `${word} Zeta` }));
    const missing = { ean: "7790000009990", label: "No está en el catálogo" };
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const item = (chain: string, i: number, price: number, date: string, source: "scraper" | "sipc" = "scraper") => ({
      externalId: `${chain}-${i}-${source}`, url: `https://example.com/${chain}/${i}`, name: `${basket[i]!.label} 1 kg`,
      ean: basket[i]!.ean, listPrice: price, available: true, source, date,
    });
    const chain = (slug: string) => ({ slug, name: slug.toUpperCase(), website: "https://example.com" });

    await ingestListings(db, chain("idx-a"), [0, 1, 2, 3, 4].map((i) => item("a", i, 100, daysAgo(2))));
    await ingestListings(db, chain("idx-a"), [item("a", 0, 120, daysAgo(1))]);
    await ingestListings(db, chain("idx-b"), [0, 1, 2, 3].map((i) => item("b", i, 90, daysAgo(2))));
    await ingestListings(db, chain("idx-c"), [0, 1, 2].map((i) => item("c", i, 50, daysAgo(2))));
    await ingestListings(db, chain("idx-a"), [0, 1, 2, 3, 4].map((i) => item("a", i, 70, daysAgo(120), "sipc")));
    // Cadenas de prueba: fuera de ACTIVE_CHAINS quedarían ocultas.
    await db.execute(sql`update chains set active = true where slug like 'idx-%'`);

    const index = await basketIndex(db, { basket: [...basket, missing] });
    expect(index.items).toHaveLength(5);
    expect(index.missing).toEqual([missing]);
    const bySeries = Object.fromEntries(index.series.map((s) => [`${s.source}:${s.chainSlug}`, s.points]));
    expect(Object.keys(bySeries).sort()).toEqual(["scraper:idx-a", "scraper:idx-b", "sipc:idx-a"]);
    // El segundo día solo se relevó un producto: los demás siguen con el precio del día anterior.
    expect(bySeries["scraper:idx-a"]).toEqual([
      { date: daysAgo(2), cost: 500, observed: 500, items: 5 },
      { date: daysAgo(1), cost: 520, observed: 520, items: 5 },
    ]);
    expect(bySeries["scraper:idx-b"]![0]).toMatchObject({ observed: 360, items: 4 });
    expect(bySeries["scraper:idx-b"]![0]!.cost).toBeGreaterThan(360);
    expect(bySeries["sipc:idx-a"]).toEqual([{ date: daysAgo(120), cost: 350, observed: 350, items: 5 }]);
  });

  it("arma estrategias de compra por cadena", async () => {
    // EAN-13 con dígito verificador válido.
    const ean = (n: number) => {
      const body = `779100${String(n).padStart(6, "0")}`;
      const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
      return `${body}${(10 - (sum % 10)) % 10}`;
    };
    const chain = (slug: string) => ({ slug, name: `Est ${slug.slice(-1).toUpperCase()}`, website: "https://example.com" });
    const item = (externalId: string, name: string, price: number, code: string | null, brand: string | null = null) => ({
      externalId, url: `https://example.com/${externalId}`, name, brand, ean: code, listPrice: price, available: true,
    });
    const prices: Record<string, { queso: number; detergente: number }> = {
      "est-a": { queso: 100, detergente: 130 },
      "est-b": { queso: 120, detergente: 100 },
      "est-c": { queso: 110, detergente: 110 },
    };
    for (const [slug, p] of Object.entries(prices)) {
      await ingestListings(db, chain(slug), [
        ...Array.from({ length: 12 }, (_, i) => item(`${slug}-q${i}`, `Queso Estrategia Dambo ${i + 1} 500 g`, p.queso, ean(i))),
        ...Array.from({ length: 12 }, (_, i) => item(`${slug}-d${i}`, `Detergente Estrategia Limón ${i + 1} 750 ml`, p.detergente, ean(100 + i))),
        item(`${slug}-arroz`, "Arroz Blanco Saman Estrategia 1 kg", 80, ean(200), "Saman Estrategia"),
      ]);
    }
    // Marca propia de Est A (la marca se llama como la cadena) y una que solo vende Est B.
    await ingestListings(db, chain("est-a"), [item("est-a-propia", "Arroz Blanco Est A 1 kg", 60, ean(300), "EST A")]);
    await ingestListings(db, chain("est-b"), [item("est-b-solo", "Arroz Blanco Solobe 1 kg", 64, ean(301), "Solobe")]);
    await db.execute(sql`update chains set active = true where slug like 'est-%'`);

    const basket = [0, 1, 100, 101].map((n) => ({ ean: ean(n), label: `Producto ${n}` }));
    const missing = { ean: ean(999), label: "No está" };
    const s = await shoppingStrategies(db, { chains: ["est-a", "est-b", "est-c"], basket: [...basket, missing] });

    const advice = Object.fromEntries(s.categories.map((c) => [c.slug, c]));
    expect(advice["est-a"]!.cheapest.map((e) => e.category)).toContain("lacteos");
    expect(advice["est-a"]!.dearest).toContainEqual(expect.objectContaining({ category: "limpieza", best: "est-b" }));
    expect(advice["est-b"]!.cheapest.map((e) => e.category)).toContain("limpieza");

    expect(s.ownBrands["est-a"]).toMatchObject([{ kind: "propia", own: { price: 60 }, rival: { price: 80, chains: 3 } }]);
    expect(s.ownBrands["est-a"]![0]!.saving).toBeCloseTo(0.25);
    expect(s.ownBrands["est-b"]).toMatchObject([{ kind: "exclusiva", own: { price: 64 } }]);
    expect(s.ownBrands["est-c"]).toBeUndefined();

    expect(s.basketMissing).toEqual([missing]);
    expect(s.twoStore).toMatchObject({ items: 4, saving: 40, single: { total: 440 }, pair: { total: 400 } });
    expect(s.twoStore!.pair!.chains.map((c) => c.slug).sort()).toEqual(["est-a", "est-b"]);
    const summaryA = s.summary.find((l) => l.slug === "est-a")!;
    expect(summaryA.sentences[0]).toBe("Si comprás en Est A, conviene llevar la limpieza en Est B.");
    expect(summaryA.sentences.join(" ")).toContain("Probá Est A");
  });

  it("rankea las marcas de un producto por precio por kilo y agrupa la misma marca mal escrita", async () => {
    const yerba = (externalId: string, name: string, brand: string, listPrice: number) => ({ externalId, url: "https://example.com", name, brand, listPrice, available: true });
    await ingestListings(db, demoData[0]!.chain, [
      yerba("ym1", "Yerba Marca Uno 1 kg", "MARCA UNO", 200),
      yerba("ym2", "Yerba Marca Uno 500 g", "Marca Uno", 90), // 180/kg: la mejor opción de la marca
      yerba("ym3", "Yerba Otra Marca 1 kg", "Otra Marca", 150),
      yerba("ym4", "Yerba Tercera Compuesta 1 kg", "Tercera", 300),
    ]);
    const ranking = (await brandRanking(db, "yerba"))!;
    expect(ranking.unit).toBe("g");
    // La demo trae otras yerbas: se miran solo las de este test.
    const ours = ranking.brands.filter((b) => ["Otra Marca", "Marca Uno", "Tercera"].includes(b.brand));
    expect(ours.map((b) => [b.brand, b.best.unitPrice])).toEqual([
      ["Otra Marca", 150],
      ["Marca Uno", 180],
      ["Tercera", 300],
    ]);
    expect(ours[1]!.others.map((o) => o.unitPrice)).toEqual([200]);
    expect(ranking.variants).toEqual([]); // "compuesta" aparece en un solo producto: no alcanza para sugerirla
    expect((await brandRanking(db, "yerba compuesta"))!.brands.map((b) => b.brand)).toEqual(["Tercera"]);
    expect(await brandRanking(db, "xqzwv")).toBeNull();
  });

  it("junta el mismo SKU de Disco/Devoto/Geant y los productos con el mismo nombre y tamaño", async () => {
    const item = (externalId: string, name: string, ean: string | null) => ({ externalId, url: "https://example.com", name, ean, listPrice: 100, available: true });
    const chain = (slug: string) => ({ slug, name: slug, website: "https://example.com" });
    // Al cargar: Devoto reusa el producto de Disco con el mismo SKU aunque el nombre no se parezca.
    await ingestListings(db, chain("disco"), [item("sku-777", "Galletitas Dup Prueba Chocolate 120 g", null)]);
    await ingestListings(db, chain("devoto"), [item("sku-777", "GALLETITAS dup prb choc. x120g", null)]);
    const bySku = await db.execute<{ n: number }>(sql`select count(distinct product_id)::int as n from listings where external_id = 'sku-777'`);
    expect(bySku[0]!.n).toBe(1);

    // El mismo artículo con dos EAN (cambio de envase), vendido por la misma cadena: dos productos al cargar...
    await ingestListings(db, chain("disco"), [
      item("dup-a", "Yerba Duplicada Prueba 1 kg", "7730241003654"),
      item("dup-b", "Yerba Duplicada Prueba 1 kg", "7730241003876"),
    ]);
    const ids = async () =>
      new Set([...(await db.execute<{ product_id: number }>(sql`select product_id from listings where external_id in ('dup-a', 'dup-b')`))].map((r) => r.product_id));
    expect((await ids()).size).toBe(2);
    // ...que el paso de duplicados exactos junta en uno.
    const pairs = await findExactDuplicates(db);
    expect(pairs.some((p) => p.keep.name === "Yerba Duplicada Prueba 1 kg")).toBe(true);
    expect(await mergeDuplicateProducts(db, pairs, { allowSameChain: true })).toBeGreaterThan(0);
    expect((await ids()).size).toBe(1);
    expect(await findExactDuplicates(db)).toEqual([]);
  });
});
