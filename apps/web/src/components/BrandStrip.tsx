import type { BrandRanking } from "@precios/db";
import Link from "next/link";
import { formatPrice, formatSize, unitLabel } from "@/lib/format";

/** Las tres marcas más baratas por kilo, litro o unidad de lo que se buscó, con link al ranking completo. */
export function BrandStrip({ q, ranking }: { q: string; ranking: BrandRanking }) {
  const top = ranking.brands.slice(0, 3);
  const per = ranking.unit === "g" ? "kilo" : ranking.unit === "ml" ? "litro" : "unidad";

  return (
    <section aria-labelledby="brand-strip-title" className="mb-5 rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="brand-strip-title" className="font-semibold">
          Marcas más baratas por {per}
        </h2>
        <Link href={`/marcas?${new URLSearchParams({ q })}`} className="text-sm text-accent hover:underline">
          Ver las {ranking.brands.length} marcas →
        </Link>
      </div>
      <ol className="grid gap-2 sm:grid-cols-3">
        {top.map((b, i) => (
          <li key={b.brand} className={`rounded-xl p-3 ${i === 0 ? "bg-accent-soft" : "bg-background"}`}>
            <p className="text-sm font-semibold">
              {i + 1}. {b.brand}
            </p>
            <p className={`text-lg font-bold tabular-nums ${i === 0 ? "text-accent" : ""}`}>
              {formatPrice(b.best.unitPrice)}
              <span className="text-xs font-normal text-muted">{unitLabel(ranking.unit)}</span>
            </p>
            <Link href={`/producto/${b.best.productId}`} className="line-clamp-1 text-xs text-muted hover:underline">
              {formatSize(b.best.sizeAmount, ranking.unit)} a {formatPrice(b.best.price)} en {b.best.chainName}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
