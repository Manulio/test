import { describe, expect, it } from "vitest";
import type { BasketItem } from "./basket";
import { buildReport, type ChainPrice } from "./compare";
import type { Offer, ProductWithOffers } from "./queries";
import {
  brandKey,
  categoryAdvice,
  displayBrand,
  joinSpanish,
  pickOwnBrandSavings,
  summarize,
  twoStoreStrategy,
} from "./strategies";

const names: Record<string, string> = { a: "Súper A", b: "Súper B", c: "Súper C" };

function row(productId: number, chainSlug: string, price: number, category: string): ChainPrice {
  return { productId, productName: `P${productId}`, brand: null, category, chainSlug, price, onSale: false };
}

// A es la más barata en lácteos, B en limpieza; C queda en el medio en las dos.
const rows = Array.from({ length: 12 }, (_, i) => [
  row(i, "a", 100, "lacteos"), row(i, "b", 120, "lacteos"), row(i, "c", 110, "lacteos"),
  row(100 + i, "a", 130, "limpieza"), row(100 + i, "b", 100, "limpieza"), row(100 + i, "c", 110, "limpieza"),
]).flat();

function product(id: number, prices: Record<string, number>): ProductWithOffers {
  const offers: Offer[] = Object.entries(prices)
    .map(([slug, price]) => ({
      chainSlug: slug, chainName: names[slug]!, url: "", listPrice: price, salePrice: null, price, unitPrice: null,
      promoText: null, available: true, date: "2026-10-20", source: "scraper" as const,
    }))
    .sort((x, y) => x.price - y.price);
  return { id, name: `P${id}`, brand: null, ean: null, sizeAmount: null, sizeUnit: null, imageUrl: null, category: "otros", offers };
}

const basket: BasketItem[] = [
  product(1, { a: 100, b: 120, c: 110 }),
  product(2, { a: 100, b: 120, c: 110 }),
  product(3, { a: 130, b: 100, c: 110 }),
  product(4, { a: 130, b: 100, c: 110 }),
].map((p) => ({ product: p, quantity: 1 }));

describe("categoryAdvice", () => {
  const advice = categoryAdvice(buildReport(rows, names));
  const by = Object.fromEntries(advice.map((a) => [a.slug, a]));

  it("dice en qué categorías cada cadena es la más barata y en cuáles conviene otra", () => {
    expect(by.a!.cheapest.map((e) => e.category)).toEqual(["lacteos"]);
    expect(by.a!.cheapest[0]!.lead).toBeCloseTo(0.1);
    expect(by.a!.dearest).toMatchObject([{ category: "limpieza", best: "b" }]);
    expect(by.a!.dearest[0]!.over).toBeCloseTo(0.3);
    expect(by.b!.cheapest.map((e) => e.category)).toEqual(["limpieza"]);
    expect(by.b!.dearest).toMatchObject([{ category: "lacteos", best: "a" }]);
    expect(by.c!.cheapest).toEqual([]);
    expect(by.c!.dearest.map((e) => e.category).sort()).toEqual(["lacteos", "limpieza"]);
  });

  it("ignora categorías con pocos productos en común", () => {
    const few = categoryAdvice(buildReport(rows.filter((r) => r.productId % 100 < 5), names));
    expect(few.every((a) => a.cheapest.length === 0 && a.dearest.length === 0)).toBe(true);
  });
});

describe("twoStoreStrategy", () => {
  const strategy = twoStoreStrategy(basket)!;

  it("compara la mejor cadena sola contra repartir entre dos", () => {
    expect(strategy.single.total).toBe(440);
    expect(strategy.pair!.chains.map((c) => c.slug).sort()).toEqual(["a", "b"]);
    expect(strategy.pair!.total).toBe(400);
    expect(strategy.saving).toBe(40);
    expect(strategy.share).toBeCloseTo(40 / 440);
  });

  it("sugiere a cada cadena su mejor complemento", () => {
    const partner = Object.fromEntries(strategy.partners.map((p) => [p.slug, p.partner]));
    expect(partner.a).toMatchObject({ slug: "b", saving: 60, moved: 2 });
    expect(partner.b).toMatchObject({ slug: "a", saving: 40, moved: 2 });
    // Para C, sumar A o B ahorra lo mismo.
    expect(partner.c).toMatchObject({ saving: 20, moved: 2 });
  });

  it("sin ahorro no propone par", () => {
    const one = twoStoreStrategy([{ product: product(1, { a: 100, b: 120 }), quantity: 1 }])!;
    expect(one.pair).toBeNull();
    expect(one.saving).toBe(0);
    expect(twoStoreStrategy([])).toBeNull();
  });
});

describe("marcas propias", () => {
  const base = {
    own_brand: "Súper A", own_amount: 1000, own_unit: "g" as const, rival_brand: "Saman", rival_amount: 1000,
    rival_unit: "g" as const, rival_chains: 3,
  };
  const rival = (chain: string, ownId: number, ownText: string, ownPrice: number, house: boolean, rivalId: number, rivalText: string, rivalPrice: number) => ({
    ...base, chain_slug: chain, own_id: ownId, own_name: ownText, own_text: ownText, own_price: String(ownPrice), house,
    rival_id: rivalId, rival_name: rivalText, rival_text: rivalText, rival_price: String(rivalPrice),
  });

  it("toma el primer rival de la misma variante y descarta ahorros chicos o sospechosos", () => {
    const picked = pickOwnBrandSavings([
      // El primer rival es integral: no es el mismo producto, gana el siguiente.
      rival("a", 1, "arroz super a blanco 1 kg", 60, true, 10, "arroz saman integral 1 kg", 70),
      rival("a", 1, "arroz super a blanco 1 kg", 60, true, 11, "arroz saman blanco 1 kg", 80),
      rival("a", 2, "fideos super a 1 kg", 98, true, 12, "fideos adria 1 kg", 100),
      rival("a", 3, "yerba super a 1 kg", 40, true, 13, "yerba canarias 1 kg", 200),
      rival("a", 4, "harina solo a 1 kg", 30, false, 14, "harina canuelas 1 kg", 50),
    ]);
    expect(picked.a!.map((s) => [s.own.id, s.rival.id, s.kind])).toEqual([
      [4, 14, "exclusiva"],
      [1, 11, "propia"],
    ]);
    expect(picked.a![1]!.saving).toBeCloseTo(0.25);
    expect(picked.a![1]!.savingPesos).toBe(20);
  });

  it("prioriza la marca de la cadena sobre las exclusivas", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      rival("a", 20 + i, `harina solo a ${i} 1 kg`, 30, false, 40 + i, `harina canuelas ${i} 1 kg`, 50),
    );
    const picked = pickOwnBrandSavings([rival("a", 1, "arroz super a blanco 1 kg", 60, true, 11, "arroz saman blanco 1 kg", 80), ...many]);
    expect(picked.a).toHaveLength(5);
    expect(picked.a!.filter((s) => s.kind === "propia")).toHaveLength(1);
  });

  it("no repite el mismo rival", () => {
    const picked = pickOwnBrandSavings([
      rival("a", 1, "desodorante super a lavanda 1 kg", 60, true, 11, "desodorante florex 1 kg", 80),
      rival("a", 2, "desodorante super a jazmin 1 kg", 60, true, 11, "desodorante florex 1 kg", 80),
    ]);
    expect(picked.a).toHaveLength(1);
  });

  it("normaliza y muestra marcas", () => {
    expect(brandKey("PRECIO LÍDER")).toBe("preciolider");
    expect(brandKey("Ta-Ta")).toBe(brandKey("TaTa"));
    expect(displayBrand("PRECIO LÍDER")).toBe("Precio Líder");
    expect(displayBrand("TaTa")).toBe("TaTa");
  });
});

describe("summarize", () => {
  it("arma el consejo de cada cadena en lenguaje simple", () => {
    const advice = categoryAdvice(buildReport(rows, names));
    const summary = summarize(advice, {}, twoStoreStrategy(basket));
    const a = summary.find((s) => s.slug === "a")!;
    expect(a.sentences).toContain("Si comprás en Súper A, conviene llevar la limpieza en Súper B.");
    expect(a.sentences).toContain("Donde Súper A es la más barata: los lácteos.");
    expect(a.sentences.at(-1)).toBe("Sumando Súper B para 2 productos de la canasta ahorrás $60 (13%).");
    const c = summary.find((s) => s.slug === "c")!;
    expect(c.sentences[0]).toBe("Si comprás en Súper C, conviene llevar los lácteos en Súper A y la limpieza en Súper B.");
  });

  it("une listas como en castellano", () => {
    expect(joinSpanish(["a"])).toBe("a");
    expect(joinSpanish(["a", "b", "c"])).toBe("a, b y c");
  });
});
