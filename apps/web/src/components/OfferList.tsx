import type { Offer } from "@precios/db";
import { formatDate, formatPrice, unitLabel } from "@/lib/format";

/** Precio en cada cadena: primero los de hoy (de la más barata a la más cara) y aparte los del SIPC, con su fecha. */
export function OfferList({ offers, unit }: { offers: Offer[]; unit: "g" | "ml" | "un" | null }) {
  const current = offers.filter((o) => o.source !== "sipc");
  const sipc = offers.filter((o) => o.source === "sipc");
  const cheapest = current.find((o) => o.available)?.price;

  return (
    <>
      {current.length > 0 && (
        <ul className="divide-y divide-border">
          {current.map((offer) => (
            <OfferRow key={offer.chainSlug} offer={offer} unit={unit} best={offer.available && offer.price === cheapest} />
          ))}
        </ul>
      )}
      {sipc.length > 0 && (
        <div className={current.length > 0 ? "mt-4 border-t border-border pt-3" : ""}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Precios oficiales del SIPC</h3>
          <p className="text-xs text-muted">
            Relevados en los locales por el Ministerio de Economía; se publican con meses de atraso.
          </p>
          <ul className="divide-y divide-border text-muted">
            {sipc.map((offer) => (
              <OfferRow key={offer.chainSlug} offer={offer} unit={unit} best={false} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function OfferRow({ offer, unit, best }: { offer: Offer; unit: "g" | "ml" | "un" | null; best: boolean }) {
  const sipc = offer.source === "sipc";
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <a href={offer.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
          {offer.chainName}
        </a>
        {sipc && <p className="text-xs">Precio SIPC · relevado el {formatDate(offer.date)}</p>}
        {offer.promoText && <p className="truncate text-xs text-sale">{offer.promoText}</p>}
        {!offer.available && <p className="text-xs text-muted">Sin stock online</p>}
      </div>
      <div className="shrink-0 text-right">
        <div className="flex items-baseline justify-end gap-2">
          {offer.salePrice != null && <span className="text-xs text-muted line-through">{formatPrice(offer.listPrice)}</span>}
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
}
