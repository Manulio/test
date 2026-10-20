import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { todayInUruguay, upsertChain, type ChainInfo, type IngestStats } from "./ingest";
import { scrapeRuns } from "./schema";

/** Pasado este tiempo sin un scrapeo exitoso, la cadena se marca como desactualizada. */
export const STALE_AFTER_HOURS = 36;
const MAX_ERROR_LENGTH = 4000;

/** Anota que empieza el scrapeo de una cadena (la crea si no existe). Devuelve el id de la corrida. */
export async function startScrapeRun(db: Db, chain: ChainInfo): Promise<number> {
  const chainId = await upsertChain(db, chain);
  const [row] = await db.insert(scrapeRuns).values({ chainId }).returning({ id: scrapeRuns.id });
  return row!.id;
}

export async function finishScrapeRun(db: Db, runId: number, stats: IngestStats): Promise<void> {
  await db.update(scrapeRuns).set({ ...stats, status: "ok", finishedAt: new Date() }).where(eq(scrapeRuns.id, runId));
}

/** Anota la falla con su mensaje. `listings` son los que llegaron a guardarse antes del error. */
export async function failScrapeRun(db: Db, runId: number, error: unknown, listings = 0): Promise<void> {
  await db
    .update(scrapeRuns)
    .set({ status: "error", error: describeError(error), listings, finishedAt: new Date() })
    .where(eq(scrapeRuns.id, runId));
}

/**
 * Mensaje legible de un error, con sus causas: drizzle envuelve los errores de Postgres en
 * "Failed query: …" y lo que importa (por ejemplo, la clave duplicada) queda en `cause`.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (current instanceof Error) {
      const detail = (current as { detail?: unknown }).detail;
      parts.push(`${current.message}${typeof detail === "string" ? ` (${detail})` : ""}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  const text = parts.join("\nCausa: ") || "Error desconocido";
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

export function isStale(lastUpdate: Date | null, now = new Date(), hours = STALE_AFTER_HOURS): boolean {
  return lastUpdate == null || now.getTime() - lastUpdate.getTime() > hours * 3_600_000;
}

export interface ChainScrapeStatus {
  chainSlug: string;
  chainName: string;
  lastOk: { startedAt: Date; finishedAt: Date; stats: IngestStats } | null;
  lastError: { startedAt: Date; finishedAt: Date; message: string; listings: number } | null;
  /** Corrida sin terminar más nueva que el último resultado: sigue corriendo o el proceso murió. */
  running: { startedAt: Date } | null;
  /** Último dato fresco: el fin del último scrapeo ok o, si nunca terminó uno bien, el último precio scrapeado. */
  lastUpdate: Date | null;
  /** Listados de la tienda online con precio de hoy (hora de Uruguay). */
  pricedToday: number;
  /** De esos, cuántos tienen precio de oferta. */
  onSaleToday: number;
  stale: boolean;
}

interface StatusRow extends Record<string, unknown> {
  slug: string;
  name: string;
  ok_started: string | null;
  ok_finished: string | null;
  ok_listings: number | null;
  ok_ean: number | null;
  ok_auto: number | null;
  ok_review: number | null;
  ok_new: number | null;
  err_started: string | null;
  err_finished: string | null;
  err_message: string | null;
  err_listings: number | null;
  running_started: string | null;
  last_scraped: string | null;
  priced_today: number;
  on_sale_today: number;
}

const toDate = (value: string | null) => (value == null ? null : new Date(value));

/**
 * Estado del scrapeo de cada cadena que tiene scraper (las que solo tienen datos del SIPC no aparecen).
 * Ordenadas con las desactualizadas primero.
 */
export async function scrapeStatus(db: Db, now = new Date()): Promise<ChainScrapeStatus[]> {
  const today = todayInUruguay(now);
  const rows = await db.execute<StatusRow>(sql`
    select c.slug, c.name,
      ok.started_at::text as ok_started, ok.finished_at::text as ok_finished, ok.listings as ok_listings,
      ok.matched_by_ean as ok_ean, ok.matched_auto as ok_auto, ok.needs_review as ok_review, ok.new_products as ok_new,
      err.started_at::text as err_started, err.finished_at::text as err_finished, err.error as err_message,
      err.listings as err_listings,
      run.started_at::text as running_started,
      today.last_scraped::text as last_scraped,
      coalesce(today.priced, 0)::int as priced_today, coalesce(today.on_sale, 0)::int as on_sale_today
    from chains c
    left join lateral (
      select * from scrape_runs where chain_id = c.id and status = 'ok' order by started_at desc limit 1
    ) ok on true
    left join lateral (
      select * from scrape_runs where chain_id = c.id and status = 'error' order by started_at desc limit 1
    ) err on true
    left join lateral (
      select started_at from scrape_runs where chain_id = c.id and status = 'running' order by started_at desc limit 1
    ) run on true
    left join lateral (
      select
        count(*) filter (where pr.date = ${today}::date) as priced,
        count(*) filter (where pr.date = ${today}::date and pr.sale_price is not null) as on_sale,
        max(pr.scraped_at) as last_scraped
      from listings l
      join prices pr on pr.listing_id = l.id
      where l.chain_id = c.id and l.source = 'scraper'
    ) today on true
    where exists (select 1 from scrape_runs where chain_id = c.id)
      or exists (select 1 from listings where chain_id = c.id and source = 'scraper')
    order by c.name
  `);

  const statuses = rows.map((r): ChainScrapeStatus => {
    const lastOk =
      r.ok_started && r.ok_finished
        ? {
            startedAt: new Date(r.ok_started),
            finishedAt: new Date(r.ok_finished),
            stats: {
              listings: r.ok_listings ?? 0,
              matchedByEan: r.ok_ean ?? 0,
              matchedAuto: r.ok_auto ?? 0,
              needsReview: r.ok_review ?? 0,
              newProducts: r.ok_new ?? 0,
            },
          }
        : null;
    const lastError =
      r.err_started && r.err_finished
        ? {
            startedAt: new Date(r.err_started),
            finishedAt: new Date(r.err_finished),
            message: r.err_message ?? "",
            listings: r.err_listings ?? 0,
          }
        : null;
    const runningStarted = toDate(r.running_started);
    const latestResult = Math.max(lastOk?.startedAt.getTime() ?? 0, lastError?.startedAt.getTime() ?? 0);
    const lastUpdate = lastOk?.finishedAt ?? toDate(r.last_scraped);
    return {
      chainSlug: r.slug,
      chainName: r.name,
      lastOk,
      lastError,
      running: runningStarted && runningStarted.getTime() > latestResult ? { startedAt: runningStarted } : null,
      lastUpdate,
      pricedToday: r.priced_today,
      onSaleToday: r.on_sale_today,
      stale: isStale(lastUpdate, now),
    };
  });
  return statuses.sort((a, b) => Number(b.stale) - Number(a.stale));
}
