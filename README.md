# PreciosUY

Comparador de precios de supermercados de Uruguay. Es una web instalable como app (PWA).

Estado: **fase 1**. Tiene búsqueda y comparación de precios, el scraper de las cadenas VTEX (Disco, Devoto y Geant) y el cruce de productos entre cadenas. El plan completo está en [ARCHITECTURE.md](./ARCHITECTURE.md).

## Requisitos

- Node 22 y pnpm 10 (`corepack enable`)
- PostgreSQL 16 con la extensión `pg_trgm`. Sirve una instalación local, Docker, Supabase o Neon.

## Puesta en marcha

```bash
pnpm install
cp .env.example .env            # ajustá DATABASE_URL
cp .env.example apps/web/.env.local

# Postgres local con Docker (opcional)
docker run -d --name precios-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=precios -p 5432:5432 postgres:16

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

En producción corre todos los días con GitHub Actions (`.github/workflows/scrape.yml`). Para eso hay que cargar el secreto `DATABASE_URL` en el repositorio. También se puede lanzar a mano desde la pestaña Actions.

## Tests

```bash
pnpm test        # unitarios
pnpm typecheck
```

Los tests de integración de la base corren solo si existe `TEST_DATABASE_URL`, que tiene que apuntar a una base con las migraciones aplicadas. **Esos tests vacían las tablas.**

## Estructura

| Carpeta | Qué hay |
|---|---|
| `apps/web` | Next.js (App Router): búsqueda, ficha de producto y manifest de la PWA |
| `packages/db` | Esquema con Drizzle, migraciones, ingesta de precios y consultas de búsqueda |
| `packages/scrapers` | Un scraper por plataforma (por ahora VTEX), cliente HTTP con pausas y lectura de robots.txt |
| `packages/matching` | Normalización de nombres, tamaños y unidades, validación de EAN y similitud entre productos |
