import type { CompareQuery } from "@precios/db";
import { CATEGORIES, GROCERY_CATEGORIES, categoryName } from "@precios/matching";

export type CompareParams = { ambito?: string; cadenas?: string | string[] };

/** Opciones del selector de ámbito: la compra del súper, todo el catálogo o una categoría. */
export const SCOPES = [
  { value: "super", label: "Compra del súper (comida, limpieza, perfumería)" },
  { value: "todo", label: "Todo el catálogo" },
  ...CATEGORIES.filter((c) => c.slug !== "otros").map((c) => ({ value: c.slug, label: c.name })),
];

export function parseCompareParams(params: CompareParams) {
  const scope = SCOPES.some((s) => s.value === params.ambito) ? params.ambito! : "super";
  const chains = [params.cadenas ?? []].flat().filter(Boolean);
  const categories = scope === "super" ? GROCERY_CATEGORIES : scope === "todo" ? undefined : [scope];
  const query: CompareQuery = { chains: chains.length > 0 ? chains : undefined, categories };
  const scopeLabel = scope === "super" ? "la compra del súper" : scope === "todo" ? "todo el catálogo" : categoryName(scope)!;
  return { scope, chains, query, scopeLabel };
}

export function compareQueryString(scope: string, chains: string[]): string {
  const sp = new URLSearchParams();
  if (scope !== "super") sp.set("ambito", scope);
  for (const c of chains) sp.append("cadenas", c);
  return sp.toString();
}
