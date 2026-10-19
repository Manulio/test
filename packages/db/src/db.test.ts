import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoData } from "../scripts/demo-data";
import { createDb, type Db } from "./client";
import { ingestListings } from "./ingest";
import { getProduct, searchProducts } from "./queries";

// Necesita una base Postgres vacía con las migraciones aplicadas (TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ingesta y búsqueda", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url);
    await db.execute(sql`truncate prices, listings, products, chains restart identity cascade`);
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
});
