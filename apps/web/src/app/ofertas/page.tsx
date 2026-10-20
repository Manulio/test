import { dealChains, getDb, listDeals } from "@precios/db";
import { CATEGORIES, categoryName } from "@precios/matching";
import type { Metadata } from "next";
import Link from "next/link";
import { CatalogCard } from "@/components/CatalogCard";
import { Pagination } from "@/components/Pagination";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ofertas de hoy" };

const PAGE_SIZE = 24;

type Params = { cadena?: string; categoria?: string; pagina?: string };

export default async function DealsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const db = getDb();
  const chains = await dealChains(db);
  const chain = chains.find((c) => c.slug === params.cadena)?.slug;
  const category = categoryName(params.categoria ?? "") ? params.categoria : undefined;
  const page = Math.max(Number.parseInt(params.pagina ?? "1", 10) || 1, 1);
  const result = await listDeals(db, { chain, category, page, pageSize: PAGE_SIZE });

  function hrefFor(next: Partial<{ cadena: string | undefined; categoria: string | undefined; pagina: number }>) {
    const merged = { cadena: chain, categoria: category, pagina: 1, ...next };
    const sp = new URLSearchParams();
    if (merged.cadena) sp.set("cadena", merged.cadena);
    if (merged.categoria) sp.set("categoria", merged.categoria);
    if (merged.pagina > 1) sp.set("pagina", String(merged.pagina));
    const qs = sp.toString();
    return qs ? `/ofertas?${qs}` : "/ofertas";
  }

  const chip = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
      active ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:border-accent hover:text-accent"
    }`;

  return (
    <section aria-labelledby="deals-title">
      <header className="mb-4">
        <h1 id="deals-title" className="text-2xl font-bold tracking-tight">
          Ofertas de hoy{chain ? ` en ${chains.find((c) => c.slug === chain)!.name}` : ""}
          {category ? ` · ${categoryName(category)}` : ""}
        </h1>
        <p className="text-sm text-muted">
          {result.total.toLocaleString("es-UY")} {result.total === 1 ? "producto rebajado" : "productos rebajados"}, del
          mayor descuento al menor. El porcentaje es sobre el precio de lista de la misma cadena.
        </p>
      </header>

      <nav aria-label="Cadenas" className="-mx-4 mb-2 overflow-x-auto px-4">
        <ul className="flex gap-2">
          <li>
            <Link href={hrefFor({ cadena: undefined })} className={chip(!chain)}>
              Todas
            </Link>
          </li>
          {chains.map((c) => (
            <li key={c.slug}>
              <Link href={hrefFor({ cadena: c.slug })} className={chip(c.slug === chain)} aria-current={c.slug === chain ? "page" : undefined}>
                {c.name} <span className="text-xs text-muted tabular-nums">{c.count.toLocaleString("es-UY")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Categorías" className="-mx-4 mb-5 overflow-x-auto px-4">
        <ul className="flex gap-2">
          <li>
            <Link href={hrefFor({ categoria: undefined })} className={chip(!category)}>
              Todo
            </Link>
          </li>
          {CATEGORIES.map((c) => (
            <li key={c.slug}>
              <Link href={hrefFor({ categoria: c.slug })} className={chip(c.slug === category)} aria-current={c.slug === category ? "page" : undefined}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {result.deals.length === 0 ? (
        <p className="py-12 text-center text-muted">No hay ofertas con estos filtros.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {result.deals.map((d) => (
            <CatalogCard key={d.product.id} product={d.product} deal={d} />
          ))}
        </div>
      )}

      <Pagination page={page} pages={Math.ceil(result.total / PAGE_SIZE)} hrefFor={(p) => hrefFor({ pagina: p })} />
    </section>
  );
}
