import { findProductByEan, getDb } from "@precios/db";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Código no encontrado" };

/** Lleva de un código de barras (escaneado o escrito) a la ficha del producto. */
export default async function EanPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).replace(/\D/g, "");
  const id = code ? await findProductByEan(getDb(), code) : null;
  if (id) redirect(`/producto/${id}`);

  return (
    <section className="mx-auto max-w-xl py-16 text-center">
      <h1 className="mb-3 text-2xl font-bold">No encontramos el código {code || "escaneado"}</h1>
      <p className="text-muted">
        Puede que ninguna de las cadenas que relevamos lo venda online, o que la tienda no publique su código de barras.
        Probá buscándolo por nombre.
      </p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-black">
        Ir al catálogo
      </Link>
    </section>
  );
}
