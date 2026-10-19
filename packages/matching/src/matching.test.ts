import { describe, expect, it } from "vitest";
import {
  canonicalEan,
  isValidEan,
  matchProduct,
  normalizeText,
  parseSize,
  similarity,
  unitPrice,
  type Candidate,
} from "./index";

describe("normalizeText", () => {
  it("quita tildes, mayúsculas y signos", () => {
    expect(normalizeText("  Café   Molido ¡ÑANDÚ!  ")).toBe("cafe molido nandu");
  });
});

describe("EAN", () => {
  it("valida el dígito verificador", () => {
    expect(isValidEan("7730900571104")).toBe(true);
    expect(isValidEan("7730900571105")).toBe(false);
    expect(isValidEan("abc")).toBe(false);
    expect(isValidEan(null)).toBe(false);
  });

  it("lleva UPC-A a 13 dígitos", () => {
    expect(canonicalEan("036000291452")).toBe("0036000291452");
    expect(canonicalEan("123")).toBeNull();
  });
});

describe("parseSize", () => {
  it.each([
    ["Leche Conaprole Entera 1 L", { amount: 1000, unit: "ml" }],
    ["Arroz Saman Blanco 1kg", { amount: 1000, unit: "g" }],
    ["Yerba Canarias 500 g", { amount: 500, unit: "g" }],
    ["Coca-Cola 1,5 lt", { amount: 1500, unit: "ml" }],
    ["Agua Salus pack 6 x 2.25 L", { amount: 13500, unit: "ml" }],
    ["Huevos colorados x 12", { amount: 12, unit: "un" }],
    ["Aceite Óptimo 900 cc", { amount: 900, unit: "ml" }],
  ])("%s", (name, expected) => {
    expect(parseSize(name)).toEqual(expected);
  });

  it("devuelve null sin tamaño", () => {
    expect(parseSize("Banana Ecuador")).toBeNull();
  });
});

describe("unitPrice", () => {
  it("calcula precio por kg, litro o unidad", () => {
    expect(unitPrice(150, { amount: 500, unit: "g" })).toBe(300);
    expect(unitPrice(90, { amount: 1500, unit: "ml" })).toBe(60);
    expect(unitPrice(180, { amount: 12, unit: "un" })).toBe(15);
    expect(unitPrice(100, null)).toBeNull();
  });
});

describe("similarity", () => {
  it("es 1 para textos iguales y baja para textos distintos", () => {
    expect(similarity("leche entera", "Leche Entera")).toBe(1);
    expect(similarity("leche entera", "arroz blanco")).toBe(0);
  });
});

describe("matchProduct", () => {
  const catalog: Candidate[] = [
    { id: 1, name: "Leche Entera Conaprole 1 L", brand: "Conaprole", ean: "7730900571104", sizeAmount: 1000, sizeUnit: "ml" },
    { id: 2, name: "Leche Descremada Conaprole 1 L", brand: "Conaprole", ean: null, sizeAmount: 1000, sizeUnit: "ml" },
    { id: 3, name: "Leche Entera Conaprole 2 L", brand: "Conaprole", ean: null, sizeAmount: 2000, sizeUnit: "ml" },
    { id: 4, name: "Arroz Blanco Saman 1 Kg", brand: "Saman", ean: null, sizeAmount: 1000, sizeUnit: "g" },
    { id: 5, name: "Huevos Colorados Prodhin x 12", brand: "Prodhin", ean: null, sizeAmount: 12, sizeUnit: "un" },
  ];

  it("asocia por EAN aunque el nombre cambie", () => {
    expect(matchProduct({ name: "LECHE CONAPROLE ENT. 1LT", ean: "7730900571104" }, catalog)).toEqual({
      kind: "ean",
      productId: 1,
      score: 1,
    });
  });

  it("asocia por nombre cuando no hay EAN", () => {
    const result = matchProduct({ name: "Arroz Saman Blanco 1kg", brand: "SAMAN" }, catalog);
    expect(result).toMatchObject({ kind: "auto", productId: 4 });
  });

  it("entiende las distintas formas de escribir unidades", () => {
    const result = matchProduct({ name: "Huevos colorados Prodhin 12 un", brand: "Prodhin" }, catalog);
    expect(result).toMatchObject({ kind: "auto", productId: 5 });
  });

  it("no confunde tamaños distintos", () => {
    const result = matchProduct({ name: "Leche Entera Conaprole 2 L", brand: "Conaprole" }, catalog);
    expect(result).toMatchObject({ productId: 3 });
  });

  it("no asocia productos sin relación", () => {
    expect(matchProduct({ name: "Detergente Nevex 500 ml", brand: "Nevex" }, catalog).kind).toBe("none");
  });
});
