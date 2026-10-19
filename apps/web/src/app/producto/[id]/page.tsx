import { getDb, getProduct } from "@precios/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OfferList } from "@/components/OfferList";
import { formatSize } from "@/lib/format";

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

  return (
    <article className="mx-auto max-w-xl">
      <Link href="/" className="text-sm text-muted hover:underline">
        ← Buscar otro producto
      </Link>
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
        </div>
      </header>
      <section className="rounded-2xl border border-border bg-surface p-4">
        {product.offers.length > 0 ? (
          <OfferList offers={product.offers} unit={product.sizeUnit} />
        ) : (
          <p className="text-muted">No hay precios recientes para este producto.</p>
        )}
      </section>
    </article>
  );
}
