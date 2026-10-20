import { describe, expect, it } from "vitest";
import { buildReport, type ChainPrice } from "./compare";

const names = { a: "Súper A", b: "Súper B", c: "Súper C" };

function row(productId: number, chainSlug: string, price: number, category = "almacen", onSale = false): ChainPrice {
  return { productId, productName: `P${productId}`, brand: null, category, chainSlug, price, onSale };
}

describe("buildReport", () => {
  // A es siempre el más barato; B cuesta 10% más; C solo vende el producto 1, 20% más caro que A.
  const rows = [
    row(1, "a", 100), row(1, "b", 110), row(1, "c", 120),
    row(2, "a", 50), row(2, "b", 55, "almacen", true),
    row(3, "a", 200),
  ];
  const report = buildReport(rows, names);

  it("ordena las cadenas por índice y cuenta solo productos en común", () => {
    expect(report.compared).toBe(2);
    expect(report.chains.map((c) => c.slug)).toEqual(["a", "b", "c"]);
    const [a, b, c] = report.chains;
    expect(a).toMatchObject({ products: 3, compared: 2, index: 100, cheapestShare: 1 });
    expect(b!.index).toBeCloseTo(110);
    expect(b!.onSaleShare).toBe(0.5);
    expect(c).toMatchObject({ compared: 1, cheapestShare: 0 });
    expect(c!.index).toBeCloseTo(120);
  });

  it("compara cada par sobre los productos que comparten", () => {
    const ab = report.pairs.find((p) => p.a === "a" && p.b === "b")!;
    expect(ab).toMatchObject({ shared: 2, aCheaper: 2, bCheaper: 0, ties: 0 });
    expect(ab.aVsB).toBeCloseTo(1 / 1.1 - 1);
    expect(report.pairs.find((p) => p.a === "b" && p.b === "c")).toMatchObject({ shared: 1, aCheaper: 1 });
  });

  it("lista las mayores diferencias en pesos", () => {
    expect(report.gaps[0]).toMatchObject({ productId: 1, saving: 20, cheapest: { chain: "a" }, priciest: { chain: "c" } });
  });

  it("descarta diferencias sospechosas de más del doble", () => {
    const r = buildReport([row(1, "a", 10), row(1, "b", 100), row(2, "a", 10), row(2, "b", 12)], names);
    expect(r).toMatchObject({ compared: 1, excluded: 1 });
  });

  it("solo recomienda una cadena por categoría con suficientes productos", () => {
    expect(report.categories[0]).toMatchObject({ category: "almacen", compared: 2, best: null });
    const many = Array.from({ length: 12 }, (_, i) => [row(i, "a", 100, "lacteos"), row(i, "b", 90, "lacteos")]).flat();
    const r = buildReport(many, names);
    expect(r.categories[0]).toMatchObject({ category: "lacteos", name: "Lácteos y huevos", best: "b" });
  });
});
