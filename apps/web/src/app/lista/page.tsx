import type { Metadata } from "next";
import { ShoppingList } from "./ShoppingList";

export const metadata: Metadata = { title: "Mi lista" };

export default function ListPage() {
  return <ShoppingList />;
}
