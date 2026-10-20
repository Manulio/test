import { getDb, scrapeStatus, STALE_AFTER_HOURS, type ChainScrapeStatus } from "@precios/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estado del scrapeo", robots: { index: false, follow: false } };

const dateTime = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const count = (n: number) => n.toLocaleString("es-UY");

/** "hace 3 h", "hace 2 días". */
function ago(date: Date, now: Date): string {
  const minutes = Math.max(Math.round((now.getTime() - date.getTime()) / 60_000), 0);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

function duration(from: Date, to: Date): string {
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export default async function StatusPage() {
  const now = new Date();
  const statuses = await scrapeStatus(getDb(), now);
  const stale = statuses.filter((s) => s.stale).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Estado del scrapeo</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Última corrida de cada cadena con scraper. Se marca en rojo la que lleva más de {STALE_AFTER_HOURS} h sin
          actualizarse.{" "}
          {stale > 0 ? (
            <strong className="text-sale">
              {stale} {stale === 1 ? "cadena desactualizada" : "cadenas desactualizadas"}.
            </strong>
          ) : (
            statuses.length > 0 && <strong className="text-accent">Todas al día.</strong>
          )}
        </p>
      </header>

      {statuses.length === 0 ? (
        <p className="py-12 text-center text-muted">Todavía no se scrapeó ninguna cadena.</p>
      ) : (
        <ul className="space-y-4">
          {statuses.map((s) => (
            <ChainRow key={s.chainSlug} status={s} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChainRow({ status: s, now }: { status: ChainScrapeStatus; now: Date }) {
  // Solo importa la falla si es posterior al último scrapeo bueno.
  const failing = s.lastError != null && (s.lastOk == null || s.lastError.startedAt > s.lastOk.startedAt);
  return (
    <li className={`rounded-2xl border bg-surface p-4 ${s.stale ? "border-sale" : "border-border"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{s.chainName}</h2>
        <div className="flex flex-wrap gap-1.5 text-xs font-medium">
          {s.running && (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-accent">
              En curso desde {dateTime.format(s.running.startedAt)}
            </span>
          )}
          {s.stale ? (
            <span className="rounded-full border border-sale px-2.5 py-0.5 text-sale">
              ⚠ {s.lastUpdate ? `Sin actualizar ${ago(s.lastUpdate, now)}` : "Nunca se actualizó"}
            </span>
          ) : (
            failing && <span className="rounded-full border border-sale px-2.5 py-0.5 text-sale">Falló la última corrida</span>
          )}
        </div>
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Último scrapeo ok</dt>
          <dd className="mt-0.5">
            {s.lastOk ? (
              <>
                <span className="font-medium">{dateTime.format(s.lastOk.finishedAt)}</span>{" "}
                <span className="text-muted">({ago(s.lastOk.finishedAt, now)})</span>
                <p className="text-xs text-muted">
                  {count(s.lastOk.stats.listings)} listados en {duration(s.lastOk.startedAt, s.lastOk.finishedAt)} ·{" "}
                  {count(s.lastOk.stats.newProducts)} nuevos · {count(s.lastOk.stats.needsReview)} a revisar
                </p>
              </>
            ) : s.lastUpdate ? (
              <span className="text-muted">Sin corridas registradas (último precio {dateTime.format(s.lastUpdate)})</span>
            ) : (
              <span className="text-muted">Nunca</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Con precio de hoy</dt>
          <dd className="mt-0.5 tabular-nums">
            <span className="font-medium">{count(s.pricedToday)}</span> {s.pricedToday === 1 ? "listado" : "listados"}
            <p className="text-xs text-muted">{count(s.onSaleToday)} en oferta</p>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Última falla</dt>
          <dd className="mt-0.5">
            {s.lastError ? (
              <span className={failing ? "font-medium text-sale" : "font-medium"}>
                {dateTime.format(s.lastError.finishedAt)}{" "}
                <span className="font-normal text-muted">
                  ({ago(s.lastError.finishedAt, now)}, {count(s.lastError.listings)} guardados)
                </span>
              </span>
            ) : (
              <span className="text-muted">Ninguna</span>
            )}
          </dd>
        </div>
      </dl>

      {s.lastError && (
        <details className="mt-3 text-sm" open={failing}>
          <summary className="cursor-pointer text-xs text-muted">Mensaje de error</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 text-xs">
            {s.lastError.message}
          </pre>
        </details>
      )}
    </li>
  );
}
