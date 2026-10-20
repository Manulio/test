import { describe, expect, it } from "vitest";
import { describeError, isStale } from "./scrape-runs";

describe("isStale", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("marca la cadena pasadas 36 h desde el último dato", () => {
    expect(isStale(new Date("2026-10-19T01:00:00Z"), now)).toBe(false);
    expect(isStale(new Date("2026-10-18T23:59:00Z"), now)).toBe(true);
  });

  it("marca la cadena que nunca se actualizó", () => {
    expect(isStale(null, now)).toBe(true);
  });
});

describe("describeError", () => {
  it("incluye las causas y el detalle de Postgres", () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "products_ean_unique"'), {
      detail: "Key (ean)=(7730105001321) already exists.",
    });
    expect(describeError(new Error("Failed query: insert into products", { cause: pg }))).toBe(
      "Failed query: insert into products\nCausa: duplicate key value violates unique constraint \"products_ean_unique\" (Key (ean)=(7730105001321) already exists.)",
    );
  });

  it("acepta cualquier cosa lanzada y recorta mensajes enormes", () => {
    expect(describeError("timeout")).toBe("timeout");
    expect(describeError(new Error("x".repeat(10_000))).length).toBeLessThan(4100);
  });
});
