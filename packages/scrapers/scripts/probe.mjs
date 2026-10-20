// Sondeo de plataformas: detecta qué tecnología usa cada tienda y muestra respuestas de ejemplo.
// Corre en GitHub Actions (que tiene acceso a internet abierto): node packages/scrapers/scripts/probe.mjs
const UA = "PreciosUY/0.1 (comparador de precios; sondeo de plataforma)";
const SITES = [
  "https://www.disco.com.uy",
  "https://www.devoto.com.uy",
  "https://www.geant.com.uy",
  "https://www.tata.com.uy",
  "https://www.eldorado.com.uy",
  "https://www.tiendainglesa.com.uy",
];
const MARKERS = {
  vtex: /vtex|vteximg|vtexassets/i,
  genexus: /gxstate|genexus|GXState/i,
  magento: /magento|mage\/cookies/i,
  shopify: /cdn\.shopify|Shopify\./,
  woocommerce: /woocommerce/i,
  nextjs: /__NEXT_DATA__|\/_next\//,
  jsonld: /application\/ld\+json/i,
};

async function get(url, accept = "*/*") {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    return { status: res.status, url: res.url, text: await res.text() };
  } catch (e) {
    return { status: 0, url, text: String(e) };
  }
}

function cut(s, n = 1500) {
  return s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s;
}

for (const site of SITES) {
  console.log(`\n==================== ${site}`);
  const home = await get(site);
  console.log(`home: ${home.status} → ${home.url} (${home.text.length} chars)`);
  console.log("markers:", Object.entries(MARKERS).filter(([, re]) => re.test(home.text)).map(([k]) => k).join(", ") || "ninguno");
  const gen = home.text.match(/<meta[^>]+name=["']generator["'][^>]*>/i);
  if (gen) console.log("generator:", gen[0]);

  const robots = await get(`${site}/robots.txt`);
  console.log(`robots.txt: ${robots.status}\n${cut(robots.text, 800)}`);

  const search = await get(`${site}/api/catalog_system/pub/products/search?ft=leche&_from=0&_to=1`, "application/json");
  console.log(`vtex search: ${search.status}`);
  try {
    const data = JSON.parse(search.text);
    if (Array.isArray(data) && data[0]) {
      const p = data[0];
      const item = p.items?.[0] ?? {};
      const offer = item.sellers?.[0]?.commertialOffer ?? {};
      console.log("product keys:", Object.keys(p).join(","));
      console.log("item keys:", Object.keys(item).join(","));
      console.log("sample:", JSON.stringify({
        productId: p.productId, productName: p.productName, brand: p.brand, link: p.link,
        itemId: item.itemId, name: item.name, nameComplete: item.nameComplete, ean: item.ean,
        measurementUnit: item.measurementUnit, unitMultiplier: item.unitMultiplier,
        sellers: item.sellers?.map((s) => ({ id: s.sellerId, def: s.sellerDefault })),
        offer: {
          Price: offer.Price, ListPrice: offer.ListPrice, PriceWithoutDiscount: offer.PriceWithoutDiscount,
          AvailableQuantity: offer.AvailableQuantity, IsAvailable: offer.IsAvailable,
          PromotionTeasers: offer.PromotionTeasers, Teasers: offer.Teasers, DiscountHighLight: offer.DiscountHighLight,
        },
      }, null, 1));
    } else console.log(cut(search.text, 400));
  } catch {
    console.log(cut(search.text, 400));
  }

  const tree = await get(`${site}/api/catalog_system/pub/category/tree/1`, "application/json");
  try {
    const t = JSON.parse(tree.text);
    console.log(`category tree: ${tree.status}, ${t.length} raíz:`, t.slice(0, 15).map((c) => `${c.id}:${c.name}`).join(" | "));
  } catch {
    console.log(`category tree: ${tree.status}`, cut(tree.text, 200));
  }
}

// Tienda Inglesa no usa VTEX (según lo visto hasta ahora): miramos su búsqueda.
console.log("\n==================== Tienda Inglesa búsqueda");
for (const url of [
  "https://www.tiendainglesa.com.uy/supermercado/busqueda?0,0,leche,0",
  "https://www.tiendainglesa.com.uy/busqueda?0,0,leche,0",
]) {
  const r = await get(url);
  console.log(`${url}: ${r.status} → ${r.url} (${r.text.length} chars)`);
  const i = r.text.search(/\$\s?\d{2,4}/);
  if (i >= 0) console.log("cerca del primer precio:\n" + r.text.slice(Math.max(0, i - 2500), i + 800));
  const ld = r.text.match(/<script[^>]+ld\+json[^>]*>[\s\S]*?<\/script>/i);
  if (ld) console.log("json-ld:", cut(ld[0], 1500));
}
