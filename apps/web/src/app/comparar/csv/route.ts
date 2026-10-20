import { currentChainPrices, getDb, listChains } from "@precios/db";
import { categoryName } from "@precios/matching";
import { parseCompareParams } from "../filters";

export const dynamic = "force-dynamic";

/** Excel en español usa ";" entre columnas y coma decimal. */
function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const s = typeof value === "number" ? value.toFixed(2).replace(".", ",") : value;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Planilla con el precio de hoy de cada producto en cada cadena, para analizar por fuera (Excel, Sheets). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { query } = parseCompareParams({
    ambito: url.searchParams.get("ambito") ?? undefined,
    cadenas: url.searchParams.getAll("cadenas"),
  });
  const db = getDb();
  const [chains, rows] = await Promise.all([listChains(db), currentChainPrices(db, query)]);
  const selected = chains.filter((c) => !query.chains || query.chains.includes(c.slug));

  const byProduct = new Map<number, { name: string; brand: string | null; category: string; prices: Map<string, number> }>();
  for (const r of rows) {
    const entry = byProduct.get(r.productId) ?? { name: r.productName, brand: r.brand, category: r.category, prices: new Map() };
    entry.prices.set(r.chainSlug, r.price);
    byProduct.set(r.productId, entry);
  }

  const header = ["producto", "marca", "categoria", ...selected.map((c) => c.name), "mas_barato", "diferencia_pesos"];
  const lines = [header.map(csvCell).join(";")];
  for (const p of [...byProduct.values()].filter((p) => p.prices.size >= 2).sort((a, b) => a.name.localeCompare(b.name))) {
    const sorted = [...p.prices].sort((a, b) => a[1] - b[1]);
    const diff = sorted.at(-1)![1] - sorted[0]![1];
    const cheapest = diff === 0 ? "igual" : selected.find((c) => c.slug === sorted[0]![0])!.name;
    lines.push(
      [p.name, p.brand, categoryName(p.category), ...selected.map((c) => p.prices.get(c.slug) ?? null), cheapest, diff]
        .map(csvCell)
        .join(";"),
    );
  }

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date());
  // BOM para que Excel abra bien los tildes.
  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="comparacion-precios-${date}.csv"`,
    },
  });
}
