import { describe, expect, it } from "vitest";
import {
  AUTO_MATCH_THRESHOLD,
  canonicalEan,
  isValidEan,
  matchProduct,
  normalizeText,
  parseSize,
  scoreCandidate,
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
    ["Pack x 2 Yerba Canarias 1 kg", { amount: 2000, unit: "g" }],
    ["Yerba Armiño Suave 1kg+100gr", { amount: 1100, unit: "g" }],
    ["Alfajor Portezuelo Pack 6 U", { amount: 6, unit: "un" }],
    // Casos reales que daban precios por kilo absurdos.
    // Dos paquetes de 1 kg más 250 g de regalo ($ 388, cuando 1 kg sale $ 194).
    ["Pack 2 un. yerba CANARIAS serena 1 kg + 250 g", { amount: 2250, unit: "g" }],
    ["Pack x 2 yerba CANARIAS suave 1 kg + 250 g regalo", { amount: 2250, unit: "g" }],
    ["Te Canarias Hierbas Digestivas 10 Sobres 1.5Gr", { amount: 10, unit: "un" }],
    ["Te Canarias Negro 10 Sobres 2Gr", { amount: 10, unit: "un" }],
    ["Te Canarias Acai Verde 10Sob Sabor Manzana", { amount: 10, unit: "un" }],
    ["Té Canarias Manzanilla 20 U", { amount: 20, unit: "un" }],
    ["Edulcorante Hileret 100 sobres", { amount: 100, unit: "un" }],
    ["Repasador Estampado Diseño 3 (40 x 60 cm)", null],
    ["KIT Regalo Fácil Diseño Infantil 30 x 45 cm", null],
    ["SAMSUNG A55 5G 128 Gb Amarillo", null],
    ["Jamón Crudo Español EL POZO Serrano x 50 g", { amount: 50, unit: "g" }],
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

  it("ignora conectores, envases y puntos sueltos", () => {
    const a = { id: 1, name: "Dulce De Leche Los Nietitos Pote 1Kg .", brand: "LOS NIETITOS", ean: null, sizeAmount: 1000, sizeUnit: "g" as const };
    expect(scoreCandidate({ name: "Dulce de leche Los Nietitos 1 kg", brand: "Los Nietitos" }, a)).toBe(1);
    const b = { id: 2, name: "Aceite Delicia Maiz 900Cc", brand: "DELICIA", ean: null, sizeAmount: 900, sizeUnit: "ml" as const };
    expect(scoreCandidate({ name: "Aceite de maíz Delicia 900 cc", brand: "Delicia" }, b)).toBe(1);
  });

  it("no confunde números que no son tamaño", () => {
    const harina = { id: 1, name: "Harina Cololo 0000 1kg", brand: "COLOLO", ean: null, sizeAmount: 1000, sizeUnit: "g" as const };
    expect(scoreCandidate({ name: "Harina 000 Cololó 1 kg", brand: "Cololó" }, harina)).toBe(0);
    expect(scoreCandidate({ name: "Harina 0000 Cololó 1 kg", brand: "Cololó" }, harina)).toBe(1);
  });

  it("no asocia productos sin relación", () => {
    expect(matchProduct({ name: "Detergente Nevex 500 ml", brand: "Nevex" }, catalog).kind).toBe("none");
  });

  describe("mismo producto escrito distinto", () => {
    const score = (a: string, b: string, brandA: string | null = null, brandB: string | null = null) =>
      scoreCandidate({ name: a, brand: brandA }, { id: 1, name: b, brand: brandB, ean: null, sizeAmount: null, sizeUnit: null });

    it.each([
      ["Yerba Mate Baldo 1 Kg", "Yerba Baldo 1Kg", "Baldo", "BALDO"],
      ["Galletas Agridulces 9 De Oro 100 G", "Galleta 9 De Oro Agridulce 100gr", null, null],
      ["Mermelada Higo Los Nietitos 500 G", "Mermelada Los Nietitos Higo Pote 500 g", null, null],
      ["Aderezo Mayonesa Natura 250 Ml", "Mayonesa Natura Doypack 250Cc", "Natura", "Natura"],
      ["Jabón de tocador Dove Blanco 90 grs", "Jabon De Tocador Dove Original Blanco 90 g", "Dove", "Dove"],
      // La leche común es la fresca; "ultrapasteurizada" es "ultra" abreviado.
      ["Leche Fresca Entera Conaprole Sachet 1 L", "Leche Conaprole Entera 1Lt", "Conaprole", "CONAPROLE"],
      ["Leche Fresca Descremada Conaprole Sachet 1 L", "Leche Conaprole Descremada 1Lt .", "Conaprole", "CONAPROLE"],
      ["Leche Ultrapasteurizada Entera Conaprole Sachet 1 L", "Leche ultra CONAPROLE entera 1 L", "Conaprole", "CONAPROLE"],
    ])("%s = %s", (a, b, brandA, brandB) => {
      expect(score(a, b, brandA, brandB)).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    });

    it.each([
      // Variante de un solo lado.
      ["Mermelada de durazno Los Nietitos 400 g", "Mermelada Los Nietitos 0% Durazno 400Gr"],
      ["Margarina Qualy 250 g", "Margarina Qualy Light 250 g"],
      // Pack contra unidad, o tamaño de un solo lado.
      ["Pack x 2 Yerba Canarias 1 kg", "Yerba Canarias 1Kg"],
      ["Alfajor Chocolate Portezuelo Pack 6 U", "Alfajor Portezuelo Chocolate"],
      // Cantidades que no son tamaño.
      ["Molde para 6 muffins antiadherente", "Molde 12 cavidades antiadherente"],
      // "mate" solo es relleno en la yerba.
      ["Termo mate acero inoxidable 1 L", "Termo acero inoxidable 1 L"],
      // "fresca" solo es relleno en la leche.
      ["Pasta fresca tallarines Adria 500 g", "Pasta tallarines Adria 500 g"],
    ])("%s ≠ %s", (a, b) => {
      expect(score(a, b)).toBeLessThan(AUTO_MATCH_THRESHOLD);
    });

    // Conaprole vende cada una con su EAN, y El Dorado tiene la fresca y la ultra a la vez: no se juntan.
    it.each([
      ["Leche Conaprole Entera 1Lt", "Leche ultra CONAPROLE entera 1 L"],
      ["Leche Fresca Entera Conaprole Sachet 1 L", "Leche Conaprole Entera Ultra 1Lt ."],
      ["Leche Conaprole Entera 1Lt", "Leche Conaprole Larga Vida Entera Caja 1Lt"],
      ["Leche ultra CONAPROLE entera 1 L", "Leche Entera Larga Vida Conaprole 1 L"],
      ["Leche Conaprole Entera 1Lt", "Leche Conaprole UHT Entera 1 L"],
      ["Leche Conaprole Descremada 1Lt .", "Leche Ultra Descremada Conaprole 1 L"],
      ["Leche Conaprole Entera 1Lt", "Leche Conaprole Descremada 1Lt ."],
      ["Leche ultra CONAPROLE entera 1 L", "Leche Conaprole Ultra Descremada 1Lt ."],
    ])("leche: %s ≠ %s", (a, b) => {
      expect(score(a, b, "Conaprole", "CONAPROLE")).toBeLessThan(AUTO_MATCH_THRESHOLD);
    });

    it("no se fía de una marca que el otro ni nombra", () => {
      expect(score("Postre de dulce de leche 1 un.", "Postre Royarina Dulce De Leche 1 un.", null, "Royarina")).toBeLessThan(
        AUTO_MATCH_THRESHOLD,
      );
    });
  });
});
