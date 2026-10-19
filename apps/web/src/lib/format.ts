const pesos = new Intl.NumberFormat("es-UY", { style: "currency", currency: "UYU", maximumFractionDigits: 2 });

export function formatPrice(value: number): string {
  return pesos.format(value).replace("UYU", "$").trim();
}

export function formatSize(amount: number | null, unit: "g" | "ml" | "un" | null): string | null {
  if (amount == null || !unit) return null;
  if (unit === "un") return `${amount} un.`;
  if (amount >= 1000) return `${(amount / 1000).toLocaleString("es-UY")} ${unit === "g" ? "kg" : "L"}`;
  return `${amount.toLocaleString("es-UY")} ${unit}`;
}

/** "por kg", "por L" o "por unidad", según la unidad del producto. */
export function unitLabel(unit: "g" | "ml" | "un" | null): string {
  return unit === "g" ? "/kg" : unit === "ml" ? "/L" : "/un.";
}
