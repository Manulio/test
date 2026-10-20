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
// "pack x 2", "pack 6" (sin unidad: la cantidad de envases)
const PACK = new RegExp(String.raw`\bpack\s*(?:x\s*)?(\d+)\b(?![.,]\d)(?!\s*(?:${UNIT_RE})\b)`);
// "pack 2 un.": la cantidad de envases, dicha en unidades.
const PACK_UNITS = /\bpack\s*(?:x\s*)?(\d+)\s*(?:un|u|unid|unidades)\b/;
// "x 12", "x12 un" (huevos, pañales); no "40 x 60 cm", que son medidas.
const COUNT = /(?<!\d\s*)\bx\s*(\d+)\b(?!\s*(?:cm|mm|m|mts|metros)\b)/;
// "10 sobres 1,5 g", "10sob", "20 saquitos": se compara por sobre, no por el peso de cada uno.
const SACHETS = /\b(\d+)\s*(?:sobres?|sob|saquitos?|bolsitas?|capsulas?|filtros?)\b/;
// "5G 128 Gb": en celulares y tablets, el "5G" es la red, no un peso.
const STORAGE = /\b\d+\s*(?:gb|tb)\b/;

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

/** Extrae el tamaño del nombre de un producto, por ejemplo "Leche Conaprole 1 L" → 1000 ml. */
export function parseSize(name: string): Size | null {
  const text = normalizeText(name);

  const sachets = SACHETS.exec(text);
  if (sachets) return { amount: Number(sachets[1]), unit: "un" };

  const multi = MULTI.exec(text);
  if (multi) {
    const u = UNITS[multi[3]!]!;
    return { amount: round(Number(multi[1]) * toNumber(multi[2]!) * u.factor), unit: u.unit };
  }

  const storage = STORAGE.test(text);
  const singles = [...text.matchAll(SINGLE)]
    .filter((m) => !(storage && UNITS[m[2]!]!.unit === "g"))
    .map((m) => {
      const u = UNITS[m[2]!]!;
      return { amount: toNumber(m[1]!) * u.factor, unit: u.unit };
    });
  if (singles.length > 0) {
    // "Pack x 2 Yerba 1 kg" son 2 kg.
    const pack = PACK.exec(text);
    // "Pack 6 U" ya son 6 unidades: "pack N un." multiplica solo pesos y volúmenes.
    const packUnits = PACK_UNITS.exec(text);
    const times = pack ? Number(pack[1]) : packUnits ? Number(packUnits[1]) : 1;
    // "Yerba 1 kg + 100 g gratis" es 1,1 kg, y "Pack x 2 yerba 1 kg + 250 g regalo" son dos de 1 kg más el
    // regalo: 2,25 kg. El "2 un." del pack no es una medida.
    const measures = singles.filter((x) => x.unit !== "un");
    if (/\d\s*[a-z]*\s*\+\s*\d/i.test(name) && measures.length > 1 && measures.every((x) => x.unit === measures[0]!.unit)) {
      const [first, ...extra] = measures;
      return { amount: round(first!.amount * times + extra.reduce((sum, x) => sum + x.amount, 0)), unit: first!.unit };
    }
    // Si aparece más de una medida, nos quedamos con la última ("Yerba 1 kg 1000g" es raro, pero pasa).
    const last = singles.at(-1)!;
    const lastTimes = last.unit === "un" && !pack ? 1 : times;
    return { amount: round(last.amount * lastTimes), unit: last.unit };
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
