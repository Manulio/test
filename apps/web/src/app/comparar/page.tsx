import { compareChains, getDb, listChains, MIN_SAMPLE, type ComparisonReport } from "@precios/db";
import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { compareQueryString, parseCompareParams, SCOPES, type CompareParams } from "./filters";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comparar supermercados" };

const pct = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const share = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 0 });
const int = (n: number) => n.toLocaleString("es-UY");

/** "+3,2%" sobre el más barato; "más barato" si es el de referencia. */
function overCheapest(index: number | null) {
  if (index == null) return "–";
  const diff = index / 100 - 1;
  return diff < 0.0005 ? "el más barato" : `${pct.format(diff)}`;
}

type Props = { searchParams: Promise<CompareParams> };

export default async function ComparePage({ searchParams }: Props) {
  const { scope, chains: selectedChains, query, scopeLabel } = parseCompareParams(await searchParams);
  const db = getDb();
  const [allChains, report] = await Promise.all([listChains(db), compareChains(db, query)]);
  const names = Object.fromEntries(allChains.map((c) => [c.slug, c.name]));
  const qs = compareQueryString(scope, selectedChains);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Comparar supermercados</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Compara los precios de hoy de cada cadena sobre los <strong className="text-foreground">mismos productos</strong>, así la
          diferencia no depende de qué vende cada una. La cadena más barata queda como referencia y las demás muestran
          cuánto más caras son.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-2xl border border-border bg-surface p-4">
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
          <span className="text-muted">Qué comparar</span>
          <select name="ambito" defaultValue={scope} className="w-full max-w-full rounded-lg border border-border bg-background px-2 py-1.5">
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-muted">Cadenas (ninguna marcada = todas)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {allChains.map((c) => (
              <label key={c.slug} className="flex items-center gap-1.5">
                <input type="checkbox" name="cadenas" value={c.slug} defaultChecked={selectedChains.includes(c.slug)} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-black">
            Actualizar
          </button>
          <a href={`/comparar/csv${qs ? `?${qs}` : ""}`} className="text-sm underline hover:text-accent">
            Descargar planilla (CSV)
          </a>
        </div>
      </form>

      {report.compared === 0 ? (
        <p className="py-12 text-center text-muted">
          Todavía no hay productos de {scopeLabel} que se vendan en al menos dos de las cadenas elegidas.
        </p>
      ) : (
        <>
          <Verdict report={report} scopeLabel={scopeLabel} />
          <Ranking report={report} />
          <HeadToHead report={report} names={names} />
          <ByCategory report={report} />
          <Gaps report={report} names={names} />
          <p className="text-xs text-muted">
            Precios de las tiendas online de los últimos 7 días; si una cadena vende el mismo producto en varias presentaciones,
            se toma la más barata. El nivel de cada cadena se estima con todos los productos en común a la vez (un modelo de precio por
            producto y por cadena), así una cadena no queda mejor o peor solo por con quién comparte productos.
            {report.excluded > 0 &&
              ` Se descartaron ${int(report.excluded)} productos con diferencias de más del doble, que suelen ser productos distintos mal emparejados.`}{" "}
            Disco, Devoto y Geant publican sus descuentos como promociones con tarjeta, por eso no figuran en la columna de ofertas.
          </p>
        </>
      )}
    </div>
  );
}

const plain = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 1 });

function othersText(bestIndex: number, rest: { name: string; index: number | null }[]): string {
  const diffs = rest.map((c) => c.index! / bestIndex - 1);
  if (rest.length === 1) return `${rest[0]!.name} sale ${plain.format(diffs[0]!)} más cara`;
  return `las demás salen entre ${plain.format(Math.min(...diffs))} y ${plain.format(Math.max(...diffs))} más caras`;
}

function Verdict({ report, scopeLabel }: { report: ComparisonReport; scopeLabel: string }) {
  const reliable = report.chains.filter((c) => c.index != null && c.compared >= MIN_SAMPLE);
  const [best, ...rest] = reliable;
  const picks = report.categories.filter((c) => c.best);
  if (!best) return null;
  const spread = rest.length > 0 ? rest.at(-1)!.index! / best.index! - 1 : 0;

  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-soft p-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">Conclusión</h2>
      <p className="text-lg leading-snug">
        Para {scopeLabel}, <strong>{best.name}</strong> es la opción más barata
        {rest.length > 0 && `: comparando producto por producto, ${othersText(best.index!, rest)}`}.
        {spread < 0.02 && rest.length > 0 && (
          <span className="mt-1 block text-base text-muted">
            Igual, hoy las diferencias son chicas: elegir supermercado pesa menos que elegir bien cada producto (mirá abajo dónde
            más se ahorra).
          </span>
        )}
      </p>
      {picks.length > 1 && (
        <p className="mt-3 text-sm">
          <span className="text-muted">Si podés repartir la compra, por rubro conviene: </span>
          {picks.map((c, i) => (
            <span key={c.category}>
              {i > 0 && " · "}
              {c.name} en <strong>{report.chains.find((ch) => ch.slug === c.best)?.name}</strong>
            </span>
          ))}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Basado en {int(report.compared)} productos que se venden en al menos dos de las cadenas comparadas.
        {best.compared < 50 &&
          ` ${best.name} comparte solo ${int(best.compared)} productos con las demás, así que tomalo con cautela.`}
      </p>
    </section>
  );
}

function Ranking({ report }: { report: ComparisonReport }) {
  const maxDiff = Math.max(...report.chains.map((c) => (c.index ?? 100) - 100), 1);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Ranking de precios</h2>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Cadena</th>
              <th className="px-4 py-2 font-medium">Sobre el más barato</th>
              <th className="px-4 py-2 text-right font-medium">Más barata o igual en</th>
              <th className="px-4 py-2 text-right font-medium">Productos comparados</th>
              <th className="px-4 py-2 text-right font-medium">En oferta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.chains.map((c, i) => {
              const few = c.compared < MIN_SAMPLE;
              return (
                <tr key={c.slug} className={few ? "text-muted" : ""}>
                  <td className="px-4 py-3 font-medium">
                    <span className="mr-2 inline-block w-4 text-muted tabular-nums">{i + 1}</span>
                    {c.name}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-border">
                        <div
                          className={`h-full rounded-full ${i === 0 ? "bg-accent" : "bg-sale"}`}
                          style={{ width: `${Math.max(((c.index ?? 100) - 100) / maxDiff, 0.03) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums">{few ? "pocos datos" : overCheapest(c.index)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.cheapestShare == null ? "–" : `${share.format(c.cheapestShare)} de los productos`}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {int(c.compared)} <span className="text-muted">de {int(c.products)}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{share.format(c.onSaleShare)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HeadToHead({ report, names }: { report: ComparisonReport; names: Record<string, string> }) {
  const pairs = report.pairs.filter((p) => p.shared >= MIN_SAMPLE).sort((a, b) => b.shared - a.shared);
  if (pairs.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Mano a mano</h2>
      <p className="mb-3 text-sm text-muted">Cada par de cadenas, solo en los productos que venden las dos.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pairs.map((p) => {
          const aWins = (p.aVsB ?? 0) <= 0;
          const [winner, loser] = aWins ? [p.a, p.b] : [p.b, p.a];
          const diff = Math.abs(aWins ? (p.aVsB ?? 0) : 1 / (1 + p.aVsB!) - 1);
          const total = p.shared;
          return (
            <article key={`${p.a}-${p.b}`} className="rounded-2xl border border-border bg-surface p-4">
              <h3 className="font-medium">
                {names[p.a]} <span className="text-muted">vs</span> {names[p.b]}
              </h3>
              <p className="mt-1 text-sm">
                {diff < 0.0005 ? (
                  "Prácticamente el mismo precio."
                ) : (
                  <>
                    <strong>{names[winner]}</strong> es {plain.format(diff)} más barato que {names[loser]}.
                  </>
                )}
              </p>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
                <div className="bg-accent" style={{ width: `${(p.aCheaper / total) * 100}%` }} />
                <div className="bg-border" style={{ width: `${(p.ties / total) * 100}%` }} />
                <div className="bg-sale" style={{ width: `${(p.bCheaper / total) * 100}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {int(total)} productos en común: más barato en {names[p.a]} {int(p.aCheaper)}, igual {int(p.ties)}, más barato en{" "}
                {names[p.b]} {int(p.bCheaper)}.
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ByCategory({ report }: { report: ComparisonReport }) {
  const rows = report.categories.filter((c) => c.compared >= MIN_SAMPLE);
  if (rows.length < 2) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Por categoría</h2>
      <p className="mb-3 text-sm text-muted">Cuánto más cara está cada cadena que la más barata, en cada rubro.</p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Categoría</th>
              {report.chains.map((c) => (
                <th key={c.slug} className="px-3 py-2 text-right font-medium">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((cat) => (
              <tr key={cat.category}>
                <td className="px-4 py-2.5">
                  {cat.name} <span className="text-xs text-muted">({int(cat.compared)})</span>
                </td>
                {report.chains.map((c) => {
                  const v = cat.byChain[c.slug];
                  const enough = v && v.index != null && v.compared >= MIN_SAMPLE;
                  const best = cat.best === c.slug;
                  return (
                    <td key={c.slug} className="px-3 py-2.5 text-right tabular-nums">
                      {enough ? (
                        <span className={best ? "rounded-md bg-accent-soft px-2 py-0.5 font-semibold text-accent" : ""}>
                          {best ? "más barata" : overCheapest(v.index)}
                        </span>
                      ) : (
                        <span className="text-muted" title={`Solo ${v?.compared ?? 0} productos en común`}>
                          –
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Gaps({ report, names }: { report: ComparisonReport; names: Record<string, string> }) {
  if (report.gaps.length === 0) return null;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Donde más se ahorra</h2>
      <p className="mb-3 text-sm text-muted">Los productos con mayor diferencia en pesos entre la cadena más barata y la más cara.</p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 font-medium">Más barato</th>
              <th className="px-3 py-2 font-medium">Más caro</th>
              <th className="px-4 py-2 text-right font-medium">Ahorrás</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.gaps.map((g) => (
              <tr key={g.productId}>
                <td className="px-4 py-2.5">
                  <Link href={`/producto/${g.productId}`} className="hover:underline">
                    {g.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {names[g.cheapest.chain]} <span className="text-muted">{formatPrice(g.cheapest.price)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {names[g.priciest.chain]} <span className="text-muted">{formatPrice(g.priciest.price)}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-accent">
                  {formatPrice(g.saving)} <span className="text-xs font-normal text-muted">({pct.format(g.gap)})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
