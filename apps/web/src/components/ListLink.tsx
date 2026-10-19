"use client";

import Link from "next/link";
import { useShoppingList } from "@/lib/shopping-list";

export function ListLink() {
  const count = useShoppingList().reduce((sum, e) => sum + e.quantity, 0);
  return (
    <Link href="/lista" className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-soft hover:text-accent">
      Mi lista
      {count > 0 && (
        <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-xs text-white tabular-nums dark:text-black">
          {count}
        </span>
      )}
    </Link>
  );
}
