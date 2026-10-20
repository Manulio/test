import { describe, expect, it } from "vitest";
import { sameVariant } from "./alternatives";

describe("sameVariant", () => {
  it("acepta otra marca o tamaño del mismo producto", () => {
    expect(sameVariant("arroz saman blanco 1 kg", "arroz vida 1kg")).toBe(true);
    expect(sameVariant("yerba canarias 1kg", "yerba mate tata 1 kg")).toBe(true);
    expect(sameVariant("aceite optimo girasol 900cc", "aceite de girasol legitimo 900 cc")).toBe(true);
  });

  it("rechaza variantes distintas", () => {
    expect(sameVariant("aceite optimo girasol 900cc", "aceite de soja trofeo 900cc")).toBe(false);
    expect(sameVariant("leche conaprole entera 1 l", "leche conaprole descremada 1 l")).toBe(false);
    expect(sameVariant("yerba canarias 1kg", "yerba canarias compuesta 1kg")).toBe(false);
    expect(sameVariant("arroz saman 1 kg", "arroz saman integral 1 kg")).toBe(false);
  });
});
