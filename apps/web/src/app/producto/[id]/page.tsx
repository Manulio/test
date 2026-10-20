import { cheaperAlternatives, getDb, getProduct, priceHistory } from "@precios/db";
import { categoryName } from "@precios/matching";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToListButton } from "@/components/AddToListButton";
import { OfferList } from "@/components/OfferList";
import { PriceHistory } from "@/components/PriceHistory";
import { formatPrice, formatSize, unitLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function load(params: Props["params"]) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const product = await getProduct(getDb(), id);
  if (!product) notFound();
  return product;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await load(params);
  return { title: product.name };
}

export default async function ProductPage({ params }: Props) {
  const product = await load(params);
  const [history, alternatives] = await Promise.all([
    priceHistory(getDb(), product.id),
    cheaperAlternatives(getDb(), product.id),
  ]);

  return (
    <article className="mx-auto max-w-xl">
      <nav aria-label="Ubicación" className="text-sm text-muted">
        <Link href="/" className="hover:underline">
          Catálogo
        </Link>
        {" / "}
        <Link href={`/categoria/${product.category}`} className="hover:underline">
          {categoryName(product.category) ?? "Otros"}
        </Link>
      </nav>
      <header className="my-4 flex gap-4">
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- imágenes de dominios de cada cadena
          <img src={product.imageUrl} alt="" className="h-24 w-24 rounded-xl bg-surface object-contain" />
        )}
        <div>
          <h1 className="text-2xl font-bold leading-tight">{product.name}</h1>
          <p className="text-muted">
            {[product.brand, formatSize(product.sizeAmount, product.sizeUnit), product.ean && `EAN ${product.ean}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-3">
            <AddToListButton id={product.id} name={product.name} />
          </div>
        </div>
      </header>
      <section className="rounded-2xl border border-border bg-surface p-4">
        {product.offers.length > 0 ? (
          <OfferList offers={product.offers} unit={product.sizeUnit} />
        ) : (
          <p className="text-muted">No hay precios recientes para este producto.</p>
        )}
      </section>
      {alternatives.length > 0 && (
        <section aria-labelledby="alternatives-title" className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <h2 id="alternatives-title" className="font-semibold">
            Más barato por {product.sizeUnit === "g" ? "kilo" : product.sizeUnit === "ml" ? "litro" : "unidad"}
          </h2>
          <p className="mb-2 text-xs text-muted">El mismo tipo de producto de otra marca o en otro tamaño, con su mejor precio de hoy.</p>
          <ul className="divide-y divide-border">
            {alternatives.map(({ product: alt, unitPrice, saving }) => {
              const best = alt.offers.find((o) => o.available && o.source === "scraper");
              return (
                <li key={alt.id} className="flex items-center gap-3 py-2">
                  {alt.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imágenes de dominios de cada cadena
                    <img src={alt.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-xl text-neutral-300">🛒</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/producto/${alt.id}`} className="line-clamp-2 text-sm font-medium hover:underline">
                      {alt.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {[formatSize(alt.sizeAmount, alt.sizeUnit), best && `en ${best.chainName}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {best && <p className="font-semibold tabular-nums">{formatPrice(best.price)}</p>}
                    <p className="text-xs tabular-nums text-muted">
                      {formatPrice(unitPrice)}
                      {unitLabel(alt.sizeUnit)}
                    </p>
                    <p className="text-xs font-semibold text-accent tabular-nums">−{Math.round(saving * 100)} %</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {history.length > 0 && (
        <section aria-labelledby="history-title" className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <h2 id="history-title" className="mb-3 font-semibold">
            Historial de precios
          </h2>
          <PriceHistory history={history} />
        </section>
      )}
    </article>
  );
}
