import { describe, expect, it } from "vitest";
import { buildIndex, INDEX_BASKET, type Observation } from "./price-index";

const obs = (chainSlug: string, productId: number, date: string, price: number, source: Observation["source"] = "scraper"): Observation => ({
  source, chainSlug, chainName: chainSlug.toUpperCase(), productId, date, price,
});

describe("canasta del índice", () => {
  it("tiene unos 25 productos sin EAN repetidos", () => {
    expect(INDEX_BASKET.length).toBeGreaterThanOrEqual(20);
    expect(new Set(INDEX_BASKET.map((i) => i.ean)).size).toBe(INDEX_BASKET.length);
    for (const item of INDEX_BASKET) expect(item.ean).toMatch(/^\d{8,14}$/);
  });
});

describe("buildIndex", () => {
  const ids = [1, 2, 3, 4, 5];

  it("suma la canasta cuando la cadena tiene todo", () => {
    const series = buildIndex(ids, ids.map((id) => obs("a", id, "2026-10-19", 100)));
    expect(series).toEqual([
      { chainSlug: "a", chainName: "A", source: "scraper", points: [{ date: "2026-10-19", cost: 500, observed: 500, items: 5 }] },
    ]);
  });

  it("estima lo que falta al nivel de precios de la cadena y descarta las de poca cobertura", () => {
    const series = buildIndex(ids, [
      ...ids.map((id) => obs("a", id, "2026-10-19", 100)),
      ...ids.map((id) => obs("b", id, "2026-10-19", 100)),
      // "c" tiene 4 de 5 (80 %) y es 10 % más barata en lo que tiene.
      ...[1, 2, 3, 4].map((id) => obs("c", id, "2026-10-19", 90)),
      // "d" tiene 3 de 5: no llega.
      ...[1, 2, 3].map((id) => obs("d", id, "2026-10-19", 100)),
    ]);
    expect(series.map((s) => s.chainSlug)).toEqual(["a", "b", "c"]);
    expect(series[2]!.points[0]).toEqual({ date: "2026-10-19", cost: 450, observed: 360, items: 4 });
  });

  it("arrastra precios de los días anteriores, pero no para siempre", () => {
    const series = buildIndex(
      ids,
      [
        ...ids.map((id) => obs("a", id, "2026-10-01", 100)),
        // Un scrapeo parcial: solo el producto 1, que subió.
        obs("a", 1, "2026-10-03", 150),
        // Pasada una semana, los demás precios ya no cuentan.
        obs("a", 1, "2026-10-20", 150),
      ],
      { carryDays: 7 },
    );
    expect(series[0]!.points.map((p) => [p.date, p.items])).toEqual([
      ["2026-10-01", 5],
      ["2026-10-03", 5],
    ]);
    expect(series[0]!.points[1]!.observed).toBe(550);
  });

  it("no mezcla los precios del SIPC con los scrapeados", () => {
    const series = buildIndex(ids, [
      ...ids.map((id) => obs("a", id, "2026-10-19", 100)),
      ...ids.map((id) => obs("a", id, "2026-06-30", 70, "sipc")),
    ]);
    expect(series.map((s) => [s.source, s.points.map((p) => p.cost)])).toEqual([
      ["scraper", [500]],
      ["sipc", [350]],
    ]);
  });
});
