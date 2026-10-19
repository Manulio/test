"use client";

import { setQuantity, useShoppingList } from "@/lib/shopping-list";

export function AddToListButton({ id, name }: { id: number; name: string }) {
  const entry = useShoppingList().find((e) => e.id === id);

  if (!entry) {
    return (
      <button
        type="button"
        onClick={() => setQuantity(id, name, 1)}
        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
      >
        + Agregar a la lista
      </button>
    );
  }

  return <QuantityStepper id={id} name={name} quantity={entry.quantity} />;
}

export function QuantityStepper({ id, name, quantity }: { id: number; name: string; quantity: number }) {
  const button = "h-8 w-8 rounded-lg border border-border text-lg leading-none hover:border-accent hover:text-accent";
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={`Cantidad de ${name}`}>
      <button type="button" className={button} onClick={() => setQuantity(id, name, quantity - 1)} aria-label="Quitar uno">
        −
      </button>
      <span className="min-w-6 text-center tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button type="button" className={button} onClick={() => setQuantity(id, name, quantity + 1)} aria-label="Agregar uno">
        +
      </button>
    </div>
  );
}
