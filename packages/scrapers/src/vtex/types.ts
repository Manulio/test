/** Partes de la respuesta de la API de catálogo de VTEX que usamos. */
export interface VtexCategory {
  id: number;
  name: string;
  url: string;
  hasChildren: boolean;
  children: VtexCategory[];
}

export interface VtexOffer {
  Price: number;
  ListPrice: number;
  PriceWithoutDiscount?: number;
  IsAvailable?: boolean;
  AvailableQuantity: number;
  PromotionTeasers?: { Name?: string }[];
  Teasers?: { "<Name>k__BackingField"?: string; Name?: string }[];
}

export interface VtexItem {
  itemId: string;
  name: string;
  nameComplete?: string;
  ean?: string;
  measurementUnit?: string;
  unitMultiplier?: number;
  images?: { imageUrl: string }[];
  sellers: { sellerDefault: boolean; commertialOffer: VtexOffer }[];
}

export interface VtexProduct {
  productId: string;
  productName: string;
  brand?: string;
  link: string;
  items: VtexItem[];
}
