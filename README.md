# PreciosUY

Comparador de precios de supermercados de Uruguay. Es una web instalable como app (PWA).

Estado: **fase 1 completa y parte de la 3**. Tiene búsqueda y comparación de precios, el scraper de las cadenas VTEX (Disco, Devoto y Geant), el cruce de productos entre cadenas y la lista de compras óptima. El plan completo está en [ARCHITECTURE.md](./ARCHITECTURE.md).

## Despliegue local con Docker (recomendado)

Solo hace falta Docker con Compose. Levanta la base de datos, aplica las migraciones y sirve la web:

```bash
docker compose up -d --build
```

Después:

| Para… | Comando |
|---|---|
| Abrir la app | http://localhost:3000 |
| Cargar los datos de demo (precios inventados) | `docker compose run --rm tools pnpm --filter @precios/db seed` |
| Scrapear una cadena ahora | `docker compose run --rm tools pnpm scrape disco --limit 200` |
| Scrapear todas las noches (03:17 UY) | `docker compose --profile scheduler up -d` |
| Ver logs | `docker compose logs -f web` |
| Actualizar después de un `git pull` | `docker compose up -d --build` |
| Apagar | `docker compose down` (los datos quedan en el volumen `precios-data`) |
| Borrar también los datos | `docker compose down -v` |

La base queda expuesta en `localhost:5432` (usuario y contraseña `postgres`), por si querés mirarla con un cliente SQL. Si ya tenés otro Postgres en ese puerto, cambiá `"5432:5432"` por `"5433:5432"` en `docker-compose.yml`.

## Desarrollo sin Docker

### Requisitos

- Node 22 y pnpm 10 (`corepack enable`)
- PostgreSQL 16 con la extensión `pg_trgm`. Sirve una instalación local, Docker, Supabase o Neon.

### Puesta en marcha

```bash
pnpm install
cp .env.example .env            # ajustá DATABASE_URL
cp .env.example apps/web/.env.local

docker compose up -d db         # solo Postgres (o usá uno propio)

export DATABASE_URL=postgres://postgres:postgres@localhost:5432/precios
pnpm db:migrate
pnpm --filter @precios/db seed  # datos de demo con precios inventados
pnpm dev                        # http://localhost:3000
```

## Scraping

```bash
pnpm scrape                       # todas las cadenas → base de datos
pnpm scrape disco --limit 200     # una cadena, primeros 200 productos
pnpm scrape devoto --dry-run      # imprime JSON, no toca la base
```

### En tu máquina

Para tener precios frescos todos los días sin GitHub Actions, agregá una línea al crontab (`crontab -e`) que corra a las 03:17:

```cron
17 3 * * * cd /ruta/al/repo && DATABASE_URL=postgres://postgres:postgres@localhost:5432/precios pnpm scrape >> scrape.log 2>&1
```

### Sondeo de plataformas

`node packages/scrapers/scripts/probe.mjs` consulta cada cadena y muestra qué plataforma usa (VTEX, GeneXus, etc.), su `robots.txt` y una respuesta de ejemplo. No necesita dependencias. Sirve para escribir un scraper nuevo o para entender por qué se rompió uno.

### En GitHub Actions (más adelante)

`.github/workflows/scrape.yml` corre el scrapeo todos los días. Para usarlo hay que cargar el secreto `DATABASE_URL` en el repositorio.

## Tests

```bash
pnpm test        # unitarios
pnpm typecheck
```

Los tests de integración de la base corren solo si existe `TEST_DATABASE_URL`, que tiene que apuntar a una base con las migraciones aplicadas. **Esos tests vacían las tablas.**

## Estructura

| Carpeta | Qué hay |
|---|---|
| `apps/web` | Next.js (App Router): búsqueda, ficha de producto, lista de compras y manifest de la PWA |
| `packages/db` | Esquema con Drizzle, migraciones, ingesta de precios, consultas de búsqueda y optimización de la lista |
| `packages/scrapers` | Un scraper por plataforma (por ahora VTEX), cliente HTTP con pausas y lectura de robots.txt |
| `packages/matching` | Normalización de nombres, tamaños y unidades, validación de EAN y similitud entre productos |
