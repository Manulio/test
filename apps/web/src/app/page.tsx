import { getDb, searchProducts } from "@precios/db";
import type { Metadata } from "next";
import { ProductCard } from "@/components/ProductCard";
import { SearchForm } from "@/components/SearchForm";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return q ? { title: `Precios de “${q}”` } : {};
}

export default async function Home({ searchParams }: Props) {
  const q = (await searchParams).q?.trim() ?? "";

  if (!q) {
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">¿Dónde está más barato?</h1>
        <p className="mb-8 text-muted">Buscá un producto y compará su precio en los supermercados de Uruguay.</p>
        <SearchForm autoFocus />
      </section>
    );
  }

  const results = await searchProducts(getDb(), q);

  return (
    <>
      <div className="mb-6">
        <SearchForm defaultValue={q} />
      </div>
      {results.length === 0 ? (
        <p className="py-12 text-center text-muted">
          No encontramos productos para “{q}”. Probá con otra palabra o con la marca.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {results.length} {results.length === 1 ? "producto" : "productos"} para “{q}”
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
