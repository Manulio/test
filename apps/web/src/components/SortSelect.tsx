"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "relevancia", label: "Más comparados" },
  { value: "precio", label: "Menor precio" },
  { value: "precio-unidad", label: "Precio por kg/L" },
  { value: "nombre", label: "Nombre (A-Z)" },
];

export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function change(sort: string) {
    const next = new URLSearchParams(params);
    if (sort === "relevancia") next.delete("orden");
    else next.set("orden", sort);
    // Al cambiar el orden se vuelve a la primera página.
    next.delete("pagina");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Ordenar por
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-foreground"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
