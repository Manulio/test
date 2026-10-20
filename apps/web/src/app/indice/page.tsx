import { basketIndex, getDb, MIN_COVERAGE, type IndexSeries } from "@precios/db";
import type { Metadata } from "next";
import Link from "next/link";
import { BasketIndexChart } from "@/components/BasketIndexChart";
import { formatDate, formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Índice de la canasta" };

const pct = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
/** Cadenas que se distinguen por color en el gráfico (la paleta --series-1..5). */
const CHART_SERIES = 5;
const share = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 0 });

const last = (s: IndexSeries) => s.points.at(-1)!;
const byLatestCost = (a: IndexSeries, b: IndexSeries) => last(a).cost - last(b).cost;

export default async function IndexPage() {
  const index = await basketIndex(getDb());
  const size = index.items.length;
  const scraped = index.series.filter((s) => s.source === "scraper").sort(byLatestCost);
  const sipc = index.series.filter((s) => s.source === "sipc").sort(byLatestCost);
  const dates = [...new Set(scraped.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const withHistory = scraped.filter((s) => s.points.length > 1);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Índice de la canasta</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Cuánto cuesta en cada supermercado la misma canasta de {size} productos básicos de marca (leche, arroz, aceite, yerba,
          fideos, huevos, artículos de limpieza…), día a día. Siempre son los mismos productos, así que los cambios son cambios de
          precio y no de qué se compra.
        </p>
      </header>

      {scraped.length === 0 ? (
        <p className="py-12 text-center text-muted">
          Todavía no hay ninguna cadena con precio para al menos el {share.format(MIN_COVERAGE)} de la canasta.
        </p>
      ) : (
        <>
          {dates.length === 1 ? (
            <p className="rounded-2xl border border-accent/40 bg-accent-soft p-4 text-sm">
              <strong>Por ahora hay datos de un solo día ({formatDate(dates[0]!)}).</strong> El índice se arma con cada scrapeo
              diario: en unos días vas a ver acá cómo evoluciona el costo de la canasta en cada cadena.
            </p>
          ) : (
            withHistory.length < scraped.length && (
              <p className="rounded-2xl border border-accent/40 bg-accent-soft p-4 text-sm">
                El historial recién empieza ({dates.length} días con datos, desde el {formatDate(dates[0]!)})
                {withHistory.length === 0
                  ? "."
                  : `: por ahora solo ${withHistory.map((s) => s.chainName).join(", ")} ${withHistory.length === 1 ? "tiene" : "tienen"} más de un día relevado.`}{" "}
                La variación de las demás aparece cuando se acumulen scrapeos diarios.
              </p>
            )
          )}

          <Ranking series={scraped} size={size} />

          {dates.length > 1 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Evolución</h2>
              <div className="rounded-2xl border border-border bg-surface p-4">
                <BasketIndexChart series={scraped} basketSize={size} maxSeries={CHART_SERIES} />
              </div>
            </section>
          )}

          {sipc.length > 0 && <SipcReference series={sipc} size={size} />}
        </>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Qué hay en la canasta</h2>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {index.items.map((item) => (
            <li key={item.ean}>
              <Link href={`/producto/${item.productId}`} className="hover:text-accent hover:underline">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        {index.missing.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            No están en el catálogo y quedan fuera del índice: {index.missing.map((i) => i.label).join(", ")}.
          </p>
        )}
      </section>

      <p className="text-xs text-muted">
        Precios de las tiendas online, con la oferta del día si había; si una cadena vende el producto en varias presentaciones, se
        toma la más barata. Si un día no se pudo relevar un producto, vale el último precio de la semana anterior. Una cadena entra
        al índice solo si tiene al menos el {share.format(MIN_COVERAGE)} de la canasta, y lo que le falta se estima con el precio
        típico de ese producto ajustado a lo cara o barata que es la cadena en el resto, para que no salga más barata solo por no
        vender algo. Los precios del SIPC (datos oficiales con meses de atraso) se calculan aparte y nunca se mezclan con estos.
      </p>
    </div>
  );
}

function Ranking({ series, size }: { series: IndexSeries[]; size: number }) {
  const cheapest = last(series[0]!).cost;
  const latestDate = series.map((s) => last(s).date).sort().at(-1)!;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Costo actual</h2>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Cadena</th>
              <th className="px-4 py-2 text-right font-medium">Canasta</th>
              <th className="px-4 py-2 text-right font-medium">Sobre la más barata</th>
              <th className="px-4 py-2 text-right font-medium">Desde el primer día</th>
              <th className="px-4 py-2 text-right font-medium">Productos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {series.map((s, i) => {
              const now = last(s);
              const first = s.points[0]!;
              const diff = now.cost / cheapest - 1;
              return (
                <tr key={s.chainSlug}>
                  <td className="px-4 py-3 font-medium">
                    <span className="mr-2 inline-block w-4 text-muted tabular-nums">{i + 1}</span>
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: i < CHART_SERIES ? `var(--series-${i + 1})` : "var(--muted)" }}
                      aria-hidden
                    />
                    {s.chainName}
                    {now.date !== latestDate && <span className="ml-2 text-xs font-normal text-muted">al {formatDate(now.date)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatPrice(now.cost)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{i === 0 ? "la más barata" : pct.format(diff)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.points.length === 1 ? (
                      <span className="text-muted">un solo día</span>
                    ) : (
                      <span className={now.cost > first.cost ? "text-sale" : now.cost < first.cost ? "text-accent" : ""}>
                        {pct.format(now.cost / first.cost - 1)}{" "}
                        <span className="text-xs text-muted">desde el {formatDate(first.date)}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {now.items} <span className="text-muted">de {size}</span>
                    {now.items < size && <span className="block text-xs text-muted">resto estimado</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SipcReference({ series, size }: { series: IndexSeries[]; size: number }) {
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Referencia: datos oficiales del SIPC</h2>
      <p className="mb-3 text-sm text-muted">Precios del Sistema de Información de Precios al Consumidor, con meses de atraso. No se comparan con los de arriba.</p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Cadena</th>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 text-right font-medium">Canasta</th>
              <th className="px-4 py-2 text-right font-medium">Productos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {series.map((s) => (
              <tr key={s.chainSlug}>
                <td className="px-4 py-3 font-medium">{s.chainName}</td>
                <td className="px-4 py-3 tabular-nums">{formatDate(last(s).date)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPrice(last(s).cost)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {last(s).items} <span className="text-muted">de {size}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
