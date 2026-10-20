import { canonicalEan, normalizeText } from "./normalize";
import { parseSize, sameSize, type Size } from "./size";
import { similarity } from "./similarity";

/** Por encima de este puntaje se asocia automáticamente. */
export const AUTO_MATCH_THRESHOLD = 0.85;
/** Entre este valor y el automático, el caso queda para revisión manual. */
export const REVIEW_THRESHOLD = 0.6;

export interface MatchInput {
  name: string;
  brand?: string | null;
  ean?: string | null;
}

export interface Candidate {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  sizeAmount: number | null;
  sizeUnit: Size["unit"] | null;
}

export type MatchResult =
  | { kind: "ean"; productId: number; score: 1 }
  | { kind: "auto"; productId: number; score: number }
  | { kind: "review"; productId: number; score: number }
  | { kind: "none"; score: number };

const SIZE_UNITS = "kg|kilos?|k|grs|gr|gramos|g|lts|lt|litros?|l|ml|cc|cm3|unidades|unid|un|u";

/** Saca las marcas y el tamaño del nombre para que la comparación se concentre en el resto. */
function core(name: string, brands: (string | null | undefined)[]): string {
  let text = normalizeText(name);
  for (const brand of brands) {
    const b = brand ? normalizeText(brand) : "";
    // Se quita como palabras enteras, para que la marca "Sol" no le saque letras a "Solar".
    if (b) text = ` ${text} `.replace(` ${b} `, " ").trim();
  }
  // Solo se saca el tamaño (peso, volumen, unidades), que se compara aparte. Otras cantidades ("6 muffins",
  // "12 cubos", "34 x 29 cm") se quedan, así los números distintos marcan productos distintos.
  return text
    .replace(new RegExp(String.raw`\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:${SIZE_UNITS})\b`, "g"), " ")
    .replace(new RegExp(String.raw`\b\d+(?:[.,]\d+)?\s*(?:${SIZE_UNITS})\b`, "g"), " ")
    .replace(/\bx\s*\d+\b/g, " ")
    // Conectores y envases que unas tiendas escriben y otras no ("Aceite de maíz" / "Aceite Maíz", "Dulce de leche
    // Pote 1 kg"). "con" y "sin" se quedan: "con gas" y "sin gas" son productos distintos.
    .replace(/\b(de|del|la|las|el|los|al|en|y|e|para)\b/g, " ")
    .replace(/\b(pote|frasco|botella|lata|doypack|sachet|bolsa|paquete|envase|caja)\b/g, " ")
    .replace(/[.,]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palabras que unas tiendas agregan y otras no, sin que cambie el producto: el tipo genérico
 * ("Yerba Mate Baldo" / "Yerba Baldo", "Aderezo Mayonesa", "Bebida energizante") o la variante
 * por defecto ("Jabón Dove Original Blanco" / "Jabón Dove Blanco").
 */
const FILLER = new Set(["mate", "aderezo", "bebida", "sabor", "tipo", "pack", "original", "clasico", "clasica", "tradicional", "u", "un", "unidad", "unidades"]);
/** Palabras que significan lo mismo, llevadas a una forma (ya en singular). */
const SYNONYMS: Record<string, string> = {
  galletita: "galleta",
  toallita: "toalla",
  gomita: "goma",
  ultrapasteurizada: "ultra",
  ultrapasteurizado: "ultra",
};

/** Singular aproximado: "galletas" → "galleta", "medallones" → "medallon", "agridulces" → "agridulce". */
function singular(word: string): string {
  if (word.length <= 3 || !word.endsWith("s")) return word;
  if (/[lrnd]es$/.test(word) && word.length > 4) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** Las palabras que identifican al producto, sin relleno, en singular y sin importar el orden. */
function keyWords(coreText: string): Set<string> {
  const words = coreText
    .replace(/\bc\/\s*/g, "con ")
    .replace(/\bs\/\s*/g, "sin ")
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      const s = singular(w);
      return SYNONYMS[s] ?? s;
    });
  // "mate" solo es relleno en "yerba mate": un mate de calabaza es otro producto.
  // "fresca" solo en la leche, donde es la común ("Leche Fresca Entera" / "Leche Entera"); una pasta fresca no es seca.
  const filler = (w: string) =>
    (FILLER.has(w) && !(w === "mate" && !words.includes("yerba"))) || (w === "fresca" && words.includes("leche"));
  return new Set(words.filter((w) => !filler(w)));
}

/**
 * Palabras que marcan una versión distinta del mismo producto, que no puede faltar de un solo lado.
 * "ultra", "uht" y "larga" (vida) son leches distintas de la fresca, con otro EAN: la tienda que dice
 * "Leche Entera" sin más vende la fresca.
 */
const VARIANT =
  /^(0%|light|diet|dietetic[oa]|zero|cero|sin|deslactosad[oa]|descremad[oa]|semidescremad[oa]|integral|organic[oa]|ultra|uht|larga)$/;

function variants(words: Set<string>): string {
  return [...words].filter((w) => VARIANT.test(w)).map((w) => w.replace(/[oa]$/, "")).sort().join(" ");
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && a.size === b.size && [...a].every((w) => b.has(w));
}

function numbers(text: string): string | null {
  const found = text.match(/\b\d+\b/g);
  return found ? [...new Set(found)].sort().join(" ") : null;
}

export function scoreCandidate(input: MatchInput, candidate: Candidate): number {
  const inputSize = parseSize(input.name);
  const candidateSize =
    candidate.sizeAmount != null && candidate.sizeUnit
      ? { amount: candidate.sizeAmount, unit: candidate.sizeUnit }
      : parseSize(candidate.name);

  // Distinto tamaño es distinto producto: un 1 L nunca es igual a un 2 L.
  if (inputSize && candidateSize && !sameSize(inputSize, candidateSize)) return 0;

  const brandA = input.brand ? normalizeText(input.brand) : null;
  const brandB = candidate.brand ? normalizeText(candidate.brand) : null;
  if (brandA && brandB && similarity(brandA, brandB) < 0.5) return 0;

  // Se sacan las dos marcas de los dos nombres: a veces una tienda la carga como marca y otra solo en el nombre.
  const coreA = core(input.name, [input.brand, candidate.brand]);
  const coreB = core(candidate.name, [candidate.brand, input.brand]);
  // Números sueltos que no son tamaño ("Harina 000" / "0000", "SPF 30" / "SPF 50"): si los dos tienen y no coinciden,
  // son productos distintos. Hay que mirarlos aparte porque los trigramas de "000" y "0000" son los mismos.
  const numbersA = numbers(coreA);
  const numbersB = numbers(coreB);
  if (numbersA && numbersB && numbersA !== numbersB) return 0;

  const wordsA = keyWords(coreA);
  const wordsB = keyWords(coreB);
  // Mismas palabras (en otro orden, singular o plural, con o sin relleno): es el mismo producto.
  // Si no, trigramas sobre las palabras limpias, que toleran errores de tipeo.
  let score = sameSet(wordsA, wordsB) ? 1 : similarity([...wordsA].join(" "), [...wordsB].join(" "));
  if (brandA && brandB) score = score * 0.85 + 0.15;
  // Si uno tiene marca y el otro ni la nombra ("Postre de dulce de leche" / "Postre Royarina..."), no hay certeza.
  const nameA = normalizeText(input.name);
  const nameB = normalizeText(candidate.name);
  if ((brandA && !brandB && !nameB.includes(brandA)) || (brandB && !brandA && !nameA.includes(brandB))) score *= 0.8;
  // Una variante que dice solo uno ("Mermelada Durazno" / "Mermelada 0% Durazno", "Margarina Light"): no es seguro.
  if (variants(wordsA) !== variants(wordsB)) score *= 0.8;
  // Si solo uno dice el tamaño ("Alfajor Pack 6 U" / "Alfajor"), puede ser otra presentación: queda para revisar.
  // Sin tamaño de ninguno de los dos lados hay menos certeza.
  if (Boolean(inputSize) !== Boolean(candidateSize)) score *= 0.8;
  else if (!inputSize) score *= 0.9;
  return Math.round(score * 1000) / 1000;
}

/** Busca el mejor producto del catálogo para un listado de una cadena. */
export function matchProduct(input: MatchInput, candidates: Candidate[]): MatchResult {
  const ean = canonicalEan(input.ean);
  if (ean) {
    const byEan = candidates.find((c) => c.ean === ean);
    if (byEan) return { kind: "ean", productId: byEan.id, score: 1 };
  }

  let best: { id: number; score: number } | null = null;
  for (const candidate of candidates) {
    // Si los dos tienen EAN válido y difieren, no son el mismo producto.
    if (ean && candidate.ean && candidate.ean !== ean) continue;
    const score = scoreCandidate(input, candidate);
    if (!best || score > best.score) best = { id: candidate.id, score };
  }

  if (!best || best.score < REVIEW_THRESHOLD) return { kind: "none", score: best?.score ?? 0 };
  if (best.score >= AUTO_MATCH_THRESHOLD) return { kind: "auto", productId: best.id, score: best.score };
  return { kind: "review", productId: best.id, score: best.score };
}
