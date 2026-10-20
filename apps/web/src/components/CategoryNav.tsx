import { CATEGORIES } from "@precios/matching";
import Link from "next/link";

/** Categorías con su cantidad de productos: chips desplazables en el celular, columna lateral en pantallas grandes. */
export function CategoryNav({
  current,
  counts,
  chain,
}: {
  current: string | null;
  counts: Record<string, number>;
  /** Filtro "Comprar en…" activo: se mantiene al cambiar de categoría. */
  chain?: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const qs = chain ? `?${new URLSearchParams({ cadena: chain })}` : "";
  const items = [
    { slug: null, name: "Todo", count: total, href: `/${qs}` },
    ...CATEGORIES.filter((c) => counts[c.slug] || c.slug === current).map((c) => ({
      slug: c.slug,
      name: c.name,
      count: counts[c.slug] ?? 0,
      href: `/categoria/${c.slug}${qs}`,
    })),
  ];

  return (
    <nav aria-label="Categorías" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-2 lg:flex-col lg:gap-0.5">
        {items.map((item) => {
          const active = item.slug === current;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between gap-3 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm lg:rounded-lg lg:border-0 lg:py-2 ${
                  active
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-border bg-surface hover:border-accent hover:text-accent lg:bg-transparent lg:hover:bg-accent-soft"
                }`}
              >
                {item.name}
                <span className="text-xs tabular-nums text-muted">{item.count.toLocaleString("es-UY")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
