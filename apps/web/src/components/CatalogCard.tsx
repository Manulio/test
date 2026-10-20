import type { ProductWithOffers } from "@precios/db";
import Link from "next/link";
import { formatDate, formatPrice, formatSize, unitLabel } from "@/lib/format";
import { AddToListButton } from "./AddToListButton";

/**
 * Tarjeta de la grilla del catálogo: foto, nombre y el mejor precio entre las cadenas.
 * Con `deal`, muestra el precio de esa cadena y el porcentaje de descuento (para la página de ofertas).
 * Con `chain` (filtro "Comprar en…"), muestra el precio de esa cadena.
 */
export function CatalogCard({
  product,
  deal,
  chain,
}: {
  product: ProductWithOffers;
  deal?: { chainSlug: string; discount: number };
  chain?: string;
}) {
  // Las ofertas vienen con los precios de hoy primero; si solo hay del SIPC, se muestra ese con su fecha.
  const cheapest = product.offers.find((o) => o.available);
  const focus = deal?.chainSlug ?? chain;
  const fixed = Boolean(focus);
  const best = (focus && product.offers.find((o) => o.chainSlug === focus)) || cheapest;
  const sipcOnly = best?.source === "sipc";
  const chains = product.offers.filter((o) => o.available && o.source === best?.source).length;
  const href = `/producto/${product.id}`;

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <Link href={href} className="relative block aspect-square bg-white p-3" tabIndex={-1} aria-hidden>
        {deal && (
          <span className="absolute left-2 top-2 z-10 rounded-md bg-sale px-1.5 py-0.5 text-xs font-bold text-white tabular-nums dark:text-black">
            −{Math.round(deal.discount * 100)} %
          </span>
        )}
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imágenes de dominios de cada cadena
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain transition-transform group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-neutral-300">🛒</div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">
          <Link href={href} className="hover:underline">
            {product.name}
          </Link>
        </h3>
        <p className="truncate text-xs text-muted">
          {[product.brand, formatSize(product.sizeAmount, product.sizeUnit)].filter(Boolean).join(" · ") || " "}
        </p>
        <div className="mt-auto pt-2">
          {best ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                {chains > 1 && !fixed && <span className="text-xs text-muted">desde</span>}
                <span className="text-lg font-bold tabular-nums">{formatPrice(best.price)}</span>
                {best.salePrice != null && (
                  <span className="text-xs text-muted line-through tabular-nums">{formatPrice(best.listPrice)}</span>
                )}
                {best.unitPrice != null && (
                  <span className="text-xs text-muted tabular-nums">
                    {formatPrice(best.unitPrice)}
                    {unitLabel(product.sizeUnit)}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                en {best.chainName}
                {fixed && cheapest && cheapest.price < best.price && (
                  <span className="text-sale"> · más barato en {cheapest.chainName}</span>
                )}
                {chains > 1 && ` · ${chains} supermercados`}
                {sipcOnly && ` · precio SIPC del ${formatDate(best.date)}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Sin stock online</p>
          )}
        </div>
        <div className="pt-2">
          <AddToListButton id={product.id} name={product.name} compact />
        </div>
      </div>
    </article>
  );
}
