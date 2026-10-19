import { describe, expect, it } from "vitest";
import { optimizeBasket, type BasketItem } from "./basket";
import type { Offer, ProductWithOffers } from "./queries";

const chainNames: Record<string, string> = { a: "Cadena A", b: "Cadena B", c: "Cadena C" };

function product(id: number, prices: Record<string, number | [number, false]>): ProductWithOffers {
  const offers: Offer[] = Object.entries(prices).map(([slug, p]) => {
    const [price, available] = Array.isArray(p) ? p : [p, true];
    return {
      chainSlug: slug,
      chainName: chainNames[slug]!,
      url: "",
      listPrice: price,
      salePrice: null,
      price,
      unitPrice: null,
      promoText: null,
      available,
      date: "2026-10-19",
    };
  });
  offers.sort((x, y) => Number(y.available) - Number(x.available) || x.price - y.price);
  return { id, name: `P${id}`, brand: null, ean: null, sizeAmount: null, sizeUnit: null, imageUrl: null, offers };
}

const item = (p: ProductWithOffers, quantity = 1): BasketItem => ({ product: p, quantity });

describe("optimizeBasket", () => {
  it("ordena las cadenas por total y multiplica por cantidad", () => {
    const result = optimizeBasket([
      item(product(1, { a: 100, b: 90 }), 2),
      item(product(2, { a: 50, b: 55 })),
    ]);
    expect(result.singles.map((s) => [s.chains[0]!.slug, s.total])).toEqual([
      ["b", 235],
      ["a", 250],
    ]);
  });

  it("propone dos cadenas cuando repartir la compra ahorra", () => {
    const result = optimizeBasket([
      item(product(1, { a: 100, b: 80 })),
      item(product(2, { a: 40, b: 70 })),
    ]);
    expect(result.singles[0]!.total).toBe(140);
    expect(result.bestPair).toMatchObject({ total: 120, missing: [] });
    expect(result.bestPair!.lines.map((l) => [l.productId, l.chainSlug])).toEqual([
      [1, "b"],
      [2, "a"],
    ]);
  });

  it("no propone par si una cadena sola ya es lo más barato", () => {
    const result = optimizeBasket([item(product(1, { a: 10, b: 20 })), item(product(2, { a: 10, b: 20 }))]);
    expect(result.bestPair).toBeNull();
  });

  it("prefiere la cadena que tiene todo aunque sea más cara", () => {
    const result = optimizeBasket([
      item(product(1, { a: 100, b: 90 })),
      item(product(2, { a: 50 })),
    ]);
    expect(result.singles[0]).toMatchObject({ total: 150, missing: [] });
    expect(result.singles[1]).toMatchObject({ total: 90, missing: [2] });
  });

  it("ignora ofertas sin stock", () => {
    const result = optimizeBasket([item(product(1, { a: 100, b: [50, false] }))]);
    expect(result.singles.find((s) => s.missing.length === 0)!.chains[0]!.slug).toBe("a");
    expect(result.singles.find((s) => s.missing.length === 1)!.total).toBe(0);
  });

  it("elige el mejor par entre tres cadenas", () => {
    const result = optimizeBasket([
      item(product(1, { a: 100, b: 60, c: 90 })),
      item(product(2, { a: 100, b: 95, c: 60 })),
      item(product(3, { a: 30, b: 50, c: 50 })),
    ]);
    // Solas: a = 230, b = 205, c = 200. Pares: a+b = 185, a+c = 180, b+c = 170.
    expect(result.singles[0]).toMatchObject({ total: 200 });
    expect(result.bestPair!.chains.map((c) => c.slug).sort()).toEqual(["b", "c"]);
    expect(result.bestPair!.total).toBe(170);
  });

  it("lista vacía", () => {
    expect(optimizeBasket([])).toEqual({ singles: [], bestPair: null });
  });
});
