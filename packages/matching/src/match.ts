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

/** Saca la marca y el tamaño del nombre para que la comparación se concentre en el resto. */
function core(name: string, brand: string | null | undefined): string {
  let text = normalizeText(name);
  if (brand) text = text.replace(normalizeText(brand), " ");
  return text
    .replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*[a-z]*\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*[a-z]+\d*\b/g, " ")
    .replace(/\bx\s*\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  let score = similarity(core(input.name, input.brand), core(candidate.name, candidate.brand));
  if (brandA && brandB) score = score * 0.85 + 0.15;
  // Sin tamaño de los dos lados hay menos certeza.
  if (!inputSize || !candidateSize) score *= 0.9;
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
