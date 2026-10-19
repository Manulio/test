import type { ProductWithOffers } from "@precios/db";
import Link from "next/link";
import { formatPrice, formatSize } from "@/lib/format";
import { OfferList } from "./OfferList";

export function ProductCard({ product }: { product: ProductWithOffers }) {
  const available = product.offers.filter((o) => o.available);
  const min = available[0]?.price;
  const max = available.at(-1)?.price;
  const savings = min != null && max != null && max > min ? max - min : null;

  return (
    <article className="flex flex-col rounded-2xl border border-border bg-surface p-4">
      <header className="mb-2 flex gap-3">
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- imágenes de dominios de cada cadena
          <img src={product.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-contain" loading="lazy" />
        )}
        <div className="min-w-0">
          <h2 className="font-semibold leading-snug">
            <Link href={`/producto/${product.id}`} className="hover:underline">
              {product.name}
            </Link>
          </h2>
          <p className="text-sm text-muted">
            {[product.brand, formatSize(product.sizeAmount, product.sizeUnit)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>
      <OfferList offers={product.offers} unit={product.sizeUnit} />
      {savings != null && (
        <p className="mt-2 text-xs text-muted">
          Ahorrás hasta <span className="font-medium text-foreground">{formatPrice(savings)}</span> eligiendo bien
        </p>
      )}
    </article>
  );
}
