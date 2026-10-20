"use client";

import type { BasketPlan, BasketResult, ProductWithOffers } from "@precios/db";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { QuantityStepper } from "@/components/AddToListButton";
import { formatPrice, formatSize } from "@/lib/format";
import { clearList, setQuantity, useShoppingList } from "@/lib/shopping-list";

interface Response {
  products: ProductWithOffers[];
  result: BasketResult;
}

export function ShoppingList() {
  const list = useShoppingList();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState(false);
  const key = useMemo(() => list.map((e) => `${e.id}x${e.quantity}`).join(","), [list]);

  useEffect(() => {
    if (list.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/lista", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: list.map(({ id, quantity }) => ({ id, quantity })) }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
        setError(false);
      } catch (e) {
        if (!controller.signal.aborted) setError(true);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` resume el contenido de la lista; evita recalcular cuando solo cambia la referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (list.length === 0) {
    return (
      <section className="mx-auto max-w-xl py-16 text-center">
        <h1 className="mb-3 text-2xl font-bold">Tu lista está vacía</h1>
        <p className="mb-6 text-muted">Buscá productos y agregalos para ver en qué súper te conviene hacer la compra.</p>
        <Link href="/" className="rounded-xl bg-accent px-5 py-3 font-medium text-white dark:text-black">
          Buscar productos
        </Link>
      </section>
    );
  }

  const products = new Map(data?.products.map((p) => [p.id, p]));
  const result = data?.result;
  const best = result?.singles[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">Mi lista</h1>
          <button type="button" onClick={clearList} className="text-sm text-muted hover:text-sale hover:underline">
            Vaciar
          </button>
        </div>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {list.map((entry) => {
            const product = products.get(entry.id);
            const cheapest = product?.offers.find((o) => o.available && o.source !== "sipc");
            return (
              <li key={entry.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/producto/${entry.id}`} className="font-medium hover:underline">
                    {product?.name ?? entry.name}
                  </Link>
                  <p className="text-sm text-muted">
                    {product
                      ? [formatSize(product.sizeAmount, product.sizeUnit), cheapest && `desde ${formatPrice(cheapest.price)} en ${cheapest.chainName}`]
                          .filter(Boolean)
                          .join(" · ") || "Sin precios recientes"
                      : data
                        ? "Ya no está disponible"
                        : " "}
                  </p>
                </div>
                <QuantityStepper id={entry.id} name={entry.name} quantity={entry.quantity} />
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="space-y-4" aria-live="polite">
        {error && <p className="rounded-xl bg-sale/10 p-3 text-sm text-sale">No pudimos calcular los precios. Probá de nuevo.</p>}
        {!result && !error && <p className="text-muted">Calculando…</p>}
        {best && (
          <>
            <PlanCard title="Comprando todo en un solo lugar" plan={best} products={products} />
            {result.bestPair && (
              <PlanCard
                title="Repartiendo la compra"
                plan={result.bestPair}
                products={products}
                savings={best.missing.length === result.bestPair.missing.length ? best.total - result.bestPair.total : null}
                showLines
              />
            )}
            <section className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="mb-2 font-semibold">Total por cadena</h2>
              <ul className="divide-y divide-border text-sm">
                {result.singles.map((plan) => (
                  <li key={plan.chains[0]?.slug ?? "none"} className="flex justify-between gap-3 py-1.5">
                    <span>
                      {plan.chains[0]?.name ?? "—"}
                      {plan.missing.length > 0 && (
                        <span className="ml-1 text-xs text-muted">
                          (faltan {plan.missing.length})
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{formatPrice(plan.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function PlanCard({
  title,
  plan,
  products,
  savings = null,
  showLines = false,
}: {
  title: string;
  plan: BasketPlan;
  products: Map<number, ProductWithOffers>;
  savings?: number | null;
  showLines?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-soft/40 p-4">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <p className="mt-1 text-lg font-semibold">{plan.chains.map((c) => c.name).join(" + ")}</p>
      <p className="text-3xl font-bold tabular-nums text-accent">{formatPrice(plan.total)}</p>
      {savings != null && savings > 0 && (
        <p className="text-sm">
          Ahorrás <strong>{formatPrice(savings)}</strong> frente a una sola cadena
        </p>
      )}
      {plan.missing.length > 0 && (
        <p className="mt-2 text-sm text-sale">
          No incluye: {plan.missing.map((id) => products.get(id)?.name ?? `#${id}`).join(", ")}
        </p>
      )}
      {showLines &&
        plan.chains.map((chain) => (
          <div key={chain.slug} className="mt-3">
            <h3 className="flex justify-between text-sm font-semibold">
              <span>{chain.name}</span>
              <span className="tabular-nums">{formatPrice(chain.subtotal)}</span>
            </h3>
            <ul className="text-sm text-muted">
              {plan.lines
                .filter((l) => l.chainSlug === chain.slug)
                .map((l) => (
                  <li key={l.productId} className="flex justify-between gap-2">
                    <span className="truncate">
                      {l.quantity > 1 && `${l.quantity} × `}
                      {products.get(l.productId)?.name}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatPrice(l.subtotal)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
