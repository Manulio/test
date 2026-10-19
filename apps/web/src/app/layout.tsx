import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ListLink } from "@/components/ListLink";
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
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Precios<span className="text-accent">UY</span>
            </Link>
            <ListLink />
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-muted">
          Precios tomados de las tiendas online de cada cadena. Pueden diferir de los de las sucursales.
        </footer>
      </body>
    </html>
  );
}
