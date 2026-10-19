import type { ProductWithOffers } from "./queries";

export interface BasketItem {
  product: ProductWithOffers;
  quantity: number;
}

export interface BasketLine {
  productId: number;
  quantity: number;
  chainSlug: string;
  unitPrice: number;
  subtotal: number;
}

export interface BasketPlan {
  /** Cadenas donde se compra (una o dos). */
  chains: { slug: string; name: string; subtotal: number }[];
  lines: BasketLine[];
  /** Productos que no se consiguen en ninguna de las cadenas del plan. */
  missing: number[];
  total: number;
}

export interface BasketResult {
  /** Todas las cadenas, cada una comprando sola, de la mejor a la peor. */
  singles: BasketPlan[];
  /** La mejor combinación de dos cadenas, si ahorra respecto de la mejor cadena sola. */
  bestPair: BasketPlan | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Mejor plan para comprar la lista en un conjunto de cadenas: cada producto en la más barata del conjunto. */
function planFor(items: BasketItem[], chainSlugs: string[], names: Map<string, string>): BasketPlan {
  const lines: BasketLine[] = [];
  const missing: number[] = [];

  for (const { product, quantity } of items) {
    // Las ofertas ya vienen ordenadas: disponibles primero y de la más barata a la más cara.
    const offer = product.offers.find((o) => o.available && chainSlugs.includes(o.chainSlug));
    if (!offer) {
      missing.push(product.id);
      continue;
    }
    lines.push({
      productId: product.id,
      quantity,
      chainSlug: offer.chainSlug,
      unitPrice: offer.price,
      subtotal: round(offer.price * quantity),
    });
  }

  const chains = chainSlugs
    .map((slug) => ({
      slug,
      name: names.get(slug) ?? slug,
      subtotal: round(lines.filter((l) => l.chainSlug === slug).reduce((sum, l) => sum + l.subtotal, 0)),
    }))
    .filter((c) => c.subtotal > 0)
    .sort((a, b) => b.subtotal - a.subtotal);

  return { chains, lines, missing, total: round(lines.reduce((sum, l) => sum + l.subtotal, 0)) };
}

/** Un plan es mejor si le faltan menos productos; a igual cantidad, si es más barato. */
const compare = (a: BasketPlan, b: BasketPlan) => a.missing.length - b.missing.length || a.total - b.total;

/**
 * Calcula dónde conviene comprar la lista: el total en cada cadena y la mejor
 * combinación de dos. Con N cadenas son N(N-1)/2 pares, así que alcanza con probarlos todos.
 */
export function optimizeBasket(items: BasketItem[]): BasketResult {
  const names = new Map<string, string>();
  for (const { product } of items) for (const o of product.offers) names.set(o.chainSlug, o.chainName);
  const slugs = [...names.keys()].sort();

  const singles = slugs.map((s) => planFor(items, [s], names)).sort(compare);

  let bestPair: BasketPlan | null = null;
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const plan = planFor(items, [slugs[i]!, slugs[j]!], names);
      // Si todo sale de una sola cadena, no es un par real.
      if (plan.chains.length < 2) continue;
      if (!bestPair || compare(plan, bestPair) < 0) bestPair = plan;
    }
  }

  const bestSingle = singles[0];
  if (bestPair && bestSingle && compare(bestPair, bestSingle) >= 0) bestPair = null;

  return { singles, bestPair };
}
