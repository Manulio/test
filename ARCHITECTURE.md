# Arquitectura

## Decisiones

| Tema | Decisión |
|---|---|
| Productos | Supermercado (alimentos, bebidas, limpieza, higiene) |
| Fuente de datos | Scraping de las tiendas online, más datos abiertos del SIPC (fase 4) |
| Plataforma | Web responsive instalable (PWA) |
| Funciones del MVP | Buscar y comparar, y lista de compras óptima |
| Cuentas | Opcionales: sin cuenta se usa todo y la lista queda en el navegador |
| Stack | TypeScript: Next.js, Node, Drizzle y PostgreSQL |
| Hosting | Vercel (web), Supabase o Neon (base) y GitHub Actions (scrapers): US$0–10 por mes |
| Productos iguales entre cadenas | EAN cuando existe; si no, nombre + marca + tamaño, con revisión manual de los casos dudosos |
| Granularidad | Un precio por cadena, el de su tienda online |
| Frescura | Scrapeo diario; precio de lista, precio de oferta y promoción como texto |

## Flujo de datos

```
GitHub Actions (cron 03:17 UY)
  └─ packages/scrapers ── fetchCatalog() → RawListing[]
        │
        ▼
  packages/db/ingest
    1. upsert del listado (cadena + id externo)
    2. si es nuevo → matching (packages/matching)
         EAN igual             → mismo producto ("ean")
         similitud ≥ 0,85      → mismo producto ("auto")
         similitud 0,60–0,85   → producto nuevo + candidato sugerido ("review")
         menor                 → producto nuevo ("new")
    3. upsert del precio del día (un registro por listado y por día)
        │
        ▼
  PostgreSQL ── apps/web (Server Components, consultas directas)
```

## Modelo de datos

- `chains`: las cadenas de supermercados.
- `products`: el catálogo propio. Tiene EAN, nombre, marca, tamaño normalizado (g, ml o un) y `search_text`, que es el texto normalizado con índice GIN de trigramas.
- `listings`: cada producto tal como aparece en una cadena, con el resultado del matching (`match_status`, `match_score`, `match_candidate_id`).
- `prices`: precio por listado y por día (`list_price`, `sale_price`, `promo_text`, `available`). Al guardar uno por día, el historial sale gratis.

La búsqueda exige que todas las palabras aparezcan en el texto, o que haya similitud de palabras (`<%` de pg_trgm) para tolerar errores de tipeo. Los resultados se ordenan por cantidad de cadenas en las que está el producto. Los precios con más de 7 días no se muestran.

## Cómo sumar una cadena

1. Si usa VTEX, alcanza con agregarla en `packages/scrapers/src/chains.ts`.
2. Si usa otra plataforma, se implementa la interfaz `Scraper` (`chain` + `fetchCatalog()`) en `packages/scrapers/src/<plataforma>/` y se registra en `chains.ts`.
3. Hay que agregar tests con una respuesta real guardada en `test/fixtures/`.

Reglas de cortesía, ya implementadas en `http.ts` y `robots.ts`: una request a la vez, al menos 750 ms entre requests, User-Agent identificable, reintentos con espera creciente y respeto de `robots.txt`.

## Fases

1. ✅ Monorepo, esquema, matching, scraper VTEX, búsqueda y ficha de producto
2. Más cadenas (Tienda Inglesa, Ta-Ta, El Dorado) y ajuste del matching con datos reales
3. Lista de compras óptima (mejor cadena única y mejor combinación de dos cadenas), cuentas opcionales con Supabase Auth y service worker
4. Importación del SIPC y pantalla `/admin` para revisar los matches dudosos
5. Historial con gráficos, alertas de precio, escaneo de código de barras y precios por sucursal
