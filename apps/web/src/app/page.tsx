import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Catalog, type CatalogParams } from "@/components/Catalog";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<CatalogParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return q ? { title: `Precios de “${q}”` } : {};
}

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  // Un código de barras pegado o tipeado en el buscador va directo a la ficha.
  const code = params.q?.trim();
  if (code && /^\d{8,14}$/.test(code)) redirect(`/ean/${code}`);
  return <Catalog category={null} params={params} />;
}
