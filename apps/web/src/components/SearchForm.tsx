export function SearchForm({ defaultValue = "", autoFocus = false }: { defaultValue?: string; autoFocus?: boolean }) {
  return (
    <form action="/" method="get" role="search" className="flex w-full gap-2">
      <label htmlFor="q" className="sr-only">
        Buscar producto
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        placeholder="Leche, arroz, yerba…"
        minLength={2}
        required
        className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      <button
        type="submit"
        className="rounded-xl bg-accent px-5 py-3 font-medium text-white hover:opacity-90 dark:text-black"
      >
        Buscar
      </button>
    </form>
  );
}
