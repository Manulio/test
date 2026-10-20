import Link from "next/link";

/** Páginas a mostrar: la primera, la última y las cercanas a la actual, con "…" en los saltos. */
function pageList(page: number, pages: number): (number | "…")[] {
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return shown.flatMap((p, i) => (i > 0 && p - shown[i - 1]! > 1 ? (["…", p] as const) : [p]));
}

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  const base = "min-w-9 rounded-lg border px-3 py-1.5 text-center text-sm tabular-nums";

  return (
    <nav aria-label="Páginas" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className={`${base} border-border bg-surface hover:border-accent`} rel="prev">
          ← Anterior
        </Link>
      )}
      {pageList(page, pages).map((p, i) =>
        p === "…" ? (
          <span key={`gap${i}`} className="px-1 text-muted">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            className={`${base} ${p === page ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-surface hover:border-accent"}`}
          >
            {p}
          </Link>
        ),
      )}
      {page < pages && (
        <Link href={hrefFor(page + 1)} className={`${base} border-border bg-surface hover:border-accent`} rel="next">
          Siguiente →
        </Link>
      )}
    </nav>
  );
}
