import type { Offer } from "@precios/db";
import { formatPrice, unitLabel } from "@/lib/format";

/** Precio en cada cadena, de la más barata a la más cara. */
export function OfferList({ offers, unit }: { offers: Offer[]; unit: "g" | "ml" | "un" | null }) {
  const cheapest = offers.find((o) => o.available)?.price;

  return (
    <ul className="divide-y divide-border">
      {offers.map((offer) => {
        const best = offer.available && offer.price === cheapest;
        return (
          <li key={offer.chainSlug} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <a href={offer.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                {offer.chainName}
              </a>
              {offer.promoText && <p className="truncate text-xs text-sale">{offer.promoText}</p>}
              {!offer.available && <p className="text-xs text-muted">Sin stock online</p>}
            </div>
            <div className="shrink-0 text-right">
              <div className="flex items-baseline justify-end gap-2">
                {offer.salePrice != null && (
                  <span className="text-xs text-muted line-through">{formatPrice(offer.listPrice)}</span>
                )}
                <span
                  className={`tabular-nums ${best ? "rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent" : ""} ${offer.available ? "" : "text-muted"}`}
                >
                  {formatPrice(offer.price)}
                </span>
              </div>
              {offer.unitPrice != null && (
                <p className="text-xs text-muted tabular-nums">
                  {formatPrice(offer.unitPrice)}
                  {unitLabel(unit)}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
