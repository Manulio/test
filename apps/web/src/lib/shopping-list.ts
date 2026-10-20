"use client";

import { useSyncExternalStore } from "react";

export interface ListEntry {
  id: number;
  quantity: number;
  /** Nombre guardado para mostrar algo aunque el producto deje de existir. */
  name: string;
}

const KEY = "preciosuy:lista";
const EMPTY: ListEntry[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ListEntry[] } = { raw: null, value: EMPTY };

function read(): ListEntry[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Modo privado o almacenamiento bloqueado: la lista funciona solo en memoria.
    return cache.value;
  }
  if (raw === cache.raw) return cache.value;
  let value: ListEntry[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      value = parsed.filter(
        (e): e is ListEntry => Number.isInteger(e?.id) && Number.isInteger(e?.quantity) && e.quantity > 0,
      );
    }
  } catch {
    value = EMPTY;
  }
  cache = { raw, value };
  return value;
}

function write(next: ListEntry[]) {
  const raw = JSON.stringify(next);
  cache = { raw, value: next };
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // Ver read(): sin almacenamiento la lista vive solo en esta pestaña.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Sincroniza entre pestañas.
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useShoppingList(): ListEntry[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const MAX_QUANTITY = 99;

export function setQuantity(id: number, name: string, quantity: number) {
  const list = read();
  const q = Math.min(MAX_QUANTITY, Math.max(0, Math.round(quantity)));
  if (q === 0) return write(list.filter((e) => e.id !== id));
  const exists = list.some((e) => e.id === id);
  write(exists ? list.map((e) => (e.id === id ? { ...e, quantity: q } : e)) : [...list, { id, name, quantity: q }]);
}

export function clearList() {
  write([]);
}
