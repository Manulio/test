import { normalizeText } from "./normalize";

export type BaseUnit = "g" | "ml" | "un";

export interface Size {
  /** Cantidad total en la unidad base (gramos, mililitros o unidades). */
  amount: number;
  unit: BaseUnit;
}

const UNITS: Record<string, { unit: BaseUnit; factor: number }> = {
  kg: { unit: "g", factor: 1000 },
  kilo: { unit: "g", factor: 1000 },
  kilos: { unit: "g", factor: 1000 },
  g: { unit: "g", factor: 1 },
  gr: { unit: "g", factor: 1 },
  grs: { unit: "g", factor: 1 },
  gramos: { unit: "g", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  lt: { unit: "ml", factor: 1000 },
  lts: { unit: "ml", factor: 1000 },
  litro: { unit: "ml", factor: 1000 },
  litros: { unit: "ml", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  cc: { unit: "ml", factor: 1 },
  cm3: { unit: "ml", factor: 1 },
  un: { unit: "un", factor: 1 },
  u: { unit: "un", factor: 1 },
  unid: { unit: "un", factor: 1 },
  unidades: { unit: "un", factor: 1 },
};

const UNIT_RE = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
// "6 x 1,5 lt" o "pack 6x500ml"
const MULTI = new RegExp(String.raw`\b(\d+)\s*x\s*${NUM}\s*(${UNIT_RE})\b`);
// "1,5 lt", "500g"
const SINGLE = new RegExp(String.raw`${NUM}\s*(${UNIT_RE})\b`, "g");
// "x 12", "x12 un" (huevos, pañales)
const COUNT = /\bx\s*(\d+)\b/;

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

/** Extrae el tamaño del nombre de un producto, por ejemplo "Leche Conaprole 1 L" → 1000 ml. */
export function parseSize(name: string): Size | null {
  const text = normalizeText(name);

  const multi = MULTI.exec(text);
  if (multi) {
    const u = UNITS[multi[3]!]!;
    return { amount: round(Number(multi[1]) * toNumber(multi[2]!) * u.factor), unit: u.unit };
  }

  // Si aparece más de una medida, nos quedamos con la última ("Yerba 1 kg 1000g" es raro, pero pasa).
  const singles = [...text.matchAll(SINGLE)];
  const last = singles.at(-1);
  if (last) {
    const u = UNITS[last[2]!]!;
    return { amount: round(toNumber(last[1]!) * u.factor), unit: u.unit };
  }

  const count = COUNT.exec(text);
  if (count) return { amount: Number(count[1]), unit: "un" };

  return null;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Precio por kg, litro o unidad, para comparar envases de distinto tamaño. */
export function unitPrice(price: number, size: Size | null): number | null {
  if (!size || size.amount <= 0) return null;
  const per = size.unit === "un" ? size.amount : size.amount / 1000;
  return Math.round((price / per) * 100) / 100;
}

export function sameSize(a: Size | null, b: Size | null, tolerance = 0.02): boolean {
  if (!a || !b || a.unit !== b.unit) return false;
  return Math.abs(a.amount - b.amount) <= Math.max(a.amount, b.amount) * tolerance;
}
