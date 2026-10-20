import { categoryName } from "@precios/matching";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Catalog, type CatalogParams } from "@/components/Catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<CatalogParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = categoryName((await params).slug);
  return name ? { title: name } : {};
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!categoryName(slug)) notFound();
  return <Catalog category={slug} params={await searchParams} />;
}
