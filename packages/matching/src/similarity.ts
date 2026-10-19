import { normalizeText } from "./normalize";

/** Trigramas al estilo de pg_trgm: cada palabra se rellena con dos espacios adelante y uno atrás. */
export function trigrams(input: string): Set<string> {
  const set = new Set<string>();
  for (const word of normalizeText(input).split(" ")) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  }
  return set;
}

/** Similitud entre 0 y 1, equivalente a similarity() de pg_trgm. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}
