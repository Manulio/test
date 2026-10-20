import { brandRanking, getDb, type BrandOption } from "@precios/db";
import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice, formatSize, unitLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

const EXAMPLES = ["yerba", "aceite girasol", "arroz", "leche entera", "cafe", "fideos", "azucar", "detergente", "papel higienico", "atun"];

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `¿Qué marca de ${q} conviene?` : "¿Qué marca conviene?" };
}

const perWord = (unit: "g" | "ml" | "un") => (unit === "g" ? "kilo" : unit === "ml" ? "litro" : "unidad");

function Option({ option, unit, muted = false }: { option: BrandOption; unit: "g" | "ml" | "un"; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${muted ? "text-muted" : ""}`}>
      <Link href={`/producto/${option.productId}`} className="min-w-0 truncate text-sm hover:underline">
        {option.name}
      </Link>
      <span className="shrink-0 text-xs tabular-nums">
        {formatSize(option.sizeAmount, unit)} · {formatPrice(option.price)} en {option.chainName}
      </span>
    </div>
  );
}

/** Ranking de marcas de un tipo de producto por precio por kg, litro o unidad. */
export default async function BrandsPage({ searchParams }: Props) {
  const q = (await searchParams).q?.trim() ?? "";
  const ranking = q ? await brandRanking(getDb(), q) : null;
  const brands = ranking?.brands ?? [];
  const cheapest = brands[0];
  const priciest = brands.at(-1);
  const max = priciest?.best.unitPrice ?? 1;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">¿Qué marca conviene?</h1>
        <p className="text-sm text-muted">
          Compará todas las marcas de un producto por lo que realmente pagás: el precio por kilo, litro o unidad, con el
          mejor precio de hoy entre los supermercados.
        </p>
        <form action="/marcas" method="get" role="search" className="mt-3 flex gap-2">
          <label htmlFor="marcas-q" className="sr-only">
            Producto a comparar
          </label>
          <input
            id="marcas-q"
            name="q"
            type="search"
            defaultValue={q}
            key={q}
            placeholder="Yerba, aceite girasol, arroz…"
            minLength={2}
            required
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-black">
            Comparar
          </button>
        </form>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {EXAMPLES.map((e) => (
            <li key={e}>
              <Link
                href={`/marcas?${new URLSearchParams({ q: e })}`}
                aria-current={e === q ? "page" : undefined}
                className={`rounded-full border px-3 py-1 ${e === q ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface hover:border-accent hover:text-accent"}`}
              >
                {e}
              </Link>
            </li>
          ))}
        </ul>
      </header>

      {q && (!ranking || brands.length === 0) && (
        <p className="py-12 text-center text-muted">
          No encontramos marcas de “{q}” con tamaño y precio de hoy. Probá con el nombre del producto, por ejemplo
          “yerba” o “aceite girasol”.
        </p>
      )}

      {ranking && cheapest && priciest && (
        <>
          <section className="mb-4 rounded-2xl border border-border bg-accent-soft p-4">
            <p className="text-sm">
              La marca más barata por {perWord(ranking.unit)} es <strong>{cheapest.brand}</strong>:{" "}
              <strong className="tabular-nums">
                {formatPrice(cheapest.best.unitPrice)}
                {unitLabel(ranking.unit)}
              </strong>{" "}
              ({cheapest.best.name}, {formatPrice(cheapest.best.price)} en {cheapest.best.chainName}).
            </p>
            {brands.length > 1 && priciest.best.unitPrice > cheapest.best.unitPrice && (
              <p className="mt-1 text-sm text-muted">
                Comparamos {brands.length} marcas y {ranking.compared} productos. La más cara, {priciest.brand}, sale{" "}
                {(priciest.best.unitPrice / cheapest.best.unitPrice).toLocaleString("es-UY", { maximumFractionDigits: 1 })}{" "}
                veces más por {perWord(ranking.unit)}.
              </p>
            )}
          </section>

          {ranking.variants.length > 0 && (
            <nav aria-label="Afinar por variante" className="mb-4">
              <p className="mb-1.5 text-xs text-muted">
                Si no son intercambiables, afiná la comparación:
              </p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {ranking.variants.map((v) => (
                  <li key={v.word}>
                    <Link
                      href={`/marcas?${new URLSearchParams({ q: `${q} ${v.word}` })}`}
                      className="rounded-full border border-border bg-surface px-3 py-1 hover:border-accent hover:text-accent"
                    >
                      {v.word} <span className="text-xs text-muted tabular-nums">{v.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <ol className="space-y-2">
            {brands.map((b, i) => (
              <li key={b.brand} className="rounded-2xl border border-border bg-surface p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-semibold">
                    <span className="mr-2 text-sm text-muted tabular-nums">{i + 1}</span>
                    {b.brand}
                  </h2>
                  <p className="shrink-0 font-semibold tabular-nums">
                    {formatPrice(b.best.unitPrice)}
                    <span className="text-xs font-normal text-muted">{unitLabel(ranking.unit)}</span>
                  </p>
                </div>
                {/* Barra proporcional al precio por unidad: se ve de un vistazo cuánto más cara es cada marca. */}
                <div className="my-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
                  <div
                    className={`h-full rounded-full ${i === 0 ? "bg-accent" : "bg-muted"}`}
                    style={{ width: `${Math.max((b.best.unitPrice / max) * 100, 2)}%` }}
                  />
                </div>
                <Option option={b.best} unit={ranking.unit} />
                {i > 0 && (
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    +{Math.round((b.best.unitPrice / cheapest.best.unitPrice - 1) * 100)} % por {perWord(ranking.unit)} que{" "}
                    {cheapest.brand}
                  </p>
                )}
                {b.others.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted hover:text-accent">
                      {b.others.length} {b.others.length === 1 ? "producto más" : "productos más"} de {b.brand}
                    </summary>
                    <div className="mt-1 space-y-1">
                      {b.others.map((o) => (
                        <div key={o.productId} className="flex items-baseline gap-2">
                          <div className="min-w-0 flex-1">
                            <Option option={o} unit={ranking.unit} muted />
                          </div>
                          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
                            {formatPrice(o.unitPrice)}
                            {unitLabel(ranking.unit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
