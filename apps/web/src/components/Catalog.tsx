import { brandRanking, catalogChains, categoryCounts, getDb, listCatalog, type CatalogSort } from "@precios/db";
import { categoryName } from "@precios/matching";
import Link from "next/link";
import { Suspense } from "react";
import { BrandStrip } from "./BrandStrip";
import { CatalogCard } from "./CatalogCard";
import { CategoryNav } from "./CategoryNav";
import { Pagination } from "./Pagination";
import { SortSelect } from "./SortSelect";

const PAGE_SIZE = 24;
const SORTS: CatalogSort[] = ["relevancia", "precio", "precio-unidad", "nombre"];

export interface CatalogParams {
  q?: string;
  orden?: string;
  pagina?: string;
  /** Slug de la cadena del filtro "Comprar en…". */
  cadena?: string;
}

/** La grilla del catálogo con sus categorías, orden y páginas. Sirve para la portada y para cada categoría. */
export async function Catalog({ category, params }: { category: string | null; params: CatalogParams }) {
  const q = params.q?.trim() ?? "";
  const sort = SORTS.find((s) => s === params.orden) ?? "relevancia";
  const page = Math.max(Number.parseInt(params.pagina ?? "1", 10) || 1, 1);
  const db = getDb();
  const chains = await catalogChains(db, category ?? undefined);
  const chain = chains.find((c) => c.slug === params.cadena);

  const [counts, result, brands] = await Promise.all([
    categoryCounts(db, chain?.slug),
    listCatalog(db, { category: category ?? undefined, q: q || undefined, sort, chain: chain?.slug, page, pageSize: PAGE_SIZE }),
    // En la primera página de una búsqueda: qué marca conviene por kilo, de un vistazo.
    q && page === 1 ? brandRanking(db, q, category ?? undefined) : null,
  ]);
  const pages = Math.ceil(result.total / PAGE_SIZE);
  const basePath = category ? `/categoria/${category}` : "/";

  function hrefFor(p: number, cadena = chain?.slug) {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (sort !== "relevancia") sp.set("orden", sort);
    if (cadena) sp.set("cadena", cadena);
    if (p > 1) sp.set("pagina", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chip = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
      active ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:border-accent hover:text-accent"
    }`;

  const title = q
    ? `${result.fuzzy ? "Parecidos a" : "Resultados para"} “${q}”${category ? ` en ${categoryName(category)}` : ""}`
    : category
      ? categoryName(category)
      : "Todos los productos";

  if (Object.keys(counts).length === 0) {
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="mb-3 text-2xl font-bold">Todavía no hay precios cargados</h1>
        <p className="text-muted">Cuando corra el primer scrapeo de los supermercados, el catálogo aparece acá.</p>
      </section>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-8">
      <aside className="mb-5 lg:sticky lg:top-4 lg:mb-0 lg:self-start">
        <h2 className="mb-2 hidden text-xs font-semibold uppercase tracking-wide text-muted lg:block">Categorías</h2>
        <CategoryNav current={category} counts={counts} chain={chain?.slug} />
      </aside>

      <section aria-labelledby="catalog-title">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="catalog-title" className="text-2xl font-bold tracking-tight">
              {title}
              {chain && <span className="text-muted"> en {chain.name}</span>}
            </h1>
            <p className="text-sm text-muted">
              {result.fuzzy && "No lo encontramos tal cual escrito; estos se parecen · "}
              {result.total.toLocaleString("es-UY")} {result.total === 1 ? "producto" : "productos"}
              {q && (
                <>
                  {" · "}
                  <Link href={chain ? `${basePath}?${new URLSearchParams({ cadena: chain.slug })}` : basePath} className="underline hover:text-accent">
                    Ver todo{category ? ` ${categoryName(category)}` : " el catálogo"}
                  </Link>
                </>
              )}
            </p>
          </div>
          {result.total > 1 && (
            <Suspense>
              <SortSelect value={sort} />
            </Suspense>
          )}
        </header>

        {chains.length > 1 && (
          <nav aria-label="Comprar en" className="-mx-4 mb-5 flex items-center gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <span className="shrink-0 text-sm text-muted">Comprar en</span>
            <ul className="flex gap-2">
              <li>
                <Link href={hrefFor(1, "")} className={chip(!chain)}>
                  Todas
                </Link>
              </li>
              {chains.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={hrefFor(1, c.slug)}
                    className={chip(c.slug === chain?.slug)}
                    aria-current={c.slug === chain?.slug ? "page" : undefined}
                  >
                    {c.name} <span className="text-xs text-muted tabular-nums">{c.count.toLocaleString("es-UY")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {brands && !result.fuzzy && brands.brands.length >= 3 && <BrandStrip q={q} ranking={brands} />}

        {result.products.length === 0 ? (
          <p className="py-12 text-center text-muted">
            {q ? `No encontramos productos para “${q}”. Probá con otra palabra o con la marca.` : "No hay productos en esta página."}
            {q && category && (
              <>
                {" "}
                <Link href={`/?${new URLSearchParams({ q })}`} className="underline hover:text-accent">
                  Buscar en todo el catálogo
                </Link>
              </>
            )}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
            {result.products.map((p) => (
              <CatalogCard key={p.id} product={p} chain={chain?.slug} />
            ))}
          </div>
        )}

        <Pagination page={page} pages={pages} hrefFor={hrefFor} />
      </section>
    </div>
  );
}
