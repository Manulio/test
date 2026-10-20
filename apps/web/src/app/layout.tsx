import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListLink } from "@/components/ListLink";
import { SearchForm } from "@/components/SearchForm";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PreciosUY · Compará precios de supermercados", template: "%s · PreciosUY" },
  description: "Compará los precios de los supermercados de Uruguay y encontrá dónde comprar más barato.",
  applicationName: "PreciosUY",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-UY">
      <body className="min-h-dvh antialiased">
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Precios<span className="text-accent">UY</span>
            </Link>
            <div className="order-last w-full sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
              <Suspense>
                <SearchForm />
              </Suspense>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Link href="/marcas" className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-soft hover:text-accent">
                Marcas
              </Link>
              <Link href="/ofertas" className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-soft hover:text-accent">
                Ofertas
              </Link>
              <Link href="/comparar" className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-soft hover:text-accent">
                Comparar
              </Link>
              <Link href="/indice" className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-soft hover:text-accent">
                Índice
              </Link>
              <Link href="/estrategias" className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-soft hover:text-accent">
                Estrategias
              </Link>
              <ListLink />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted">
          Precios tomados de las tiendas online de cada cadena. Pueden diferir de los de las sucursales.
        </footer>
      </body>
    </html>
  );
}
