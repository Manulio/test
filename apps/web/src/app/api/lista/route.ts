import { getDb, getProducts, optimizeBasket } from "@precios/db";
import { NextResponse } from "next/server";

const MAX_ITEMS = 100;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const raw = (body as { items?: unknown })?.items;
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Se esperan hasta ${MAX_ITEMS} productos en "items"` }, { status: 400 });
  }
  const quantities = new Map<number, number>();
  for (const entry of raw) {
    const id = Number(entry?.id);
    const quantity = Number(entry?.quantity);
    if (Number.isInteger(id) && id > 0 && Number.isInteger(quantity) && quantity > 0 && quantity <= 99) {
      quantities.set(id, quantity);
    }
  }

  const products = await getProducts(getDb(), [...quantities.keys()]);
  const result = optimizeBasket(products.map((product) => ({ product, quantity: quantities.get(product.id)! })));
  return NextResponse.json({ products, result });
}
