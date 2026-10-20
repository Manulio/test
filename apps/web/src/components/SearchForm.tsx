"use client";

import { useSearchParams } from "next/navigation";
import { ScanButton } from "./ScanButton";

/** Buscador compacto del encabezado. Busca en todo el catálogo; un código de barras lleva a la ficha. */
export function SearchForm() {
  const q = useSearchParams().get("q") ?? "";

  return (
    <form action="/" method="get" role="search" className="flex w-full gap-2">
      <label htmlFor="q" className="sr-only">
        Buscar producto
      </label>
      <input
        id="q"
        name="q"
        type="search"
        // Con key, el campo se actualiza al navegar a otra búsqueda.
        key={q}
        defaultValue={q}
        placeholder="Buscar leche, arroz o un código de barras…"
        minLength={2}
        required
        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      <ScanButton />
      <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-black">
        Buscar
      </button>
    </form>
  );
}
