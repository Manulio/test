import {
  displayBrand,
  getDb,
  shoppingStrategies,
  type ChainCategoryAdvice,
  type OwnBrandSaving,
  type ShoppingStrategies,
  type TwoStoreStrategy,
} from "@precios/db";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estrategias de compra" };

// Los precios cambian una vez por día y el cálculo tarda varios segundos: se recalcula como mucho cada hora.
const cachedStrategies = unstable_cache(() => shoppingStrategies(getDb()), ["estrategias"], { revalidate: 3600 });

const pct = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 0 });
const int = (n: number) => n.toLocaleString("es-UY");

function ChainLinks({ slug, name }: { slug: string; name: string }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      <Link href={`/?cadena=${slug}`} className="underline hover:text-accent">
        Comprar en {name}
      </Link>
      <Link href={`/ofertas?cadena=${slug}`} className="underline hover:text-accent">
        Ofertas de {name}
      </Link>
    </span>
  );
}

export default async function StrategiesPage() {
  const data = await cachedStrategies();
  const names = Object.fromEntries(data.report.chains.map((c) => [c.slug, c.name]));

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Estrategias de compra</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Consejos para cada supermercado con los precios de hoy de las tiendas online: qué conviene comprar en otro lado, qué marcas
          propias valen la pena y cuánto se ahorra repartiendo la compra entre dos.
        </p>
      </header>

      {data.report.chains.length < 2 ? (
        <p className="py-12 text-center text-muted">Todavía no hay precios de hoy de al menos dos cadenas para comparar.</p>
      ) : (
        <>
          <Summary data={data} />
          {data.twoStore && <TwoStores strategy={data.twoStore} />}
          <section className="space-y-6">
            <h2 className="text-lg font-semibold">Cadena por cadena</h2>
            {data.categories.map((c) => (
              <ChainDetail key={c.slug} advice={c} ownBrands={data.ownBrands[c.slug] ?? []} names={names} />
            ))}
          </section>
          <p className="text-xs text-muted">
            Las categorías se comparan sobre {int(data.report.compared)} productos que se venden en al menos dos cadenas, con el mismo método
            que <Link href="/comparar" className="underline">Comparar</Link>; una categoría necesita al menos 10 productos en común. Las marcas
            propias se comparan por kg, litro o unidad contra el producto equivalente de marca que venden más cadenas, en la misma cadena; las
            diferencias de más de la mitad se descartan porque suelen ser productos distintos. La canasta es la del{" "}
            <Link href="/indice" className="underline">Índice</Link>, una unidad de cada producto.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ data }: { data: ShoppingStrategies }) {
  const lines = data.summary.filter((s) => s.sentences.length > 0);
  if (lines.length === 0) return null;
  const { twoStore } = data;
  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-soft p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent">En resumen</h2>
      {twoStore?.pair && twoStore.saving > 0 && (
        <p className="mb-4 text-lg leading-snug">
          Una canasta típica cuesta {formatPrice(twoStore.single.total)} en <strong>{twoStore.single.chains[0]!.name}</strong>, la más
          barata de las que venden todos los productos. Repartiéndola entre{" "}
          <strong>{twoStore.pair.chains.map((c) => c.name).join(" y ")}</strong> ahorrás{" "}
          <strong>
            {formatPrice(twoStore.saving)} ({pct.format(twoStore.share)})
          </strong>
          .
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {lines.map((s) => (
          <li key={s.slug} className="rounded-xl bg-surface/70 p-4">
            <h3 className="font-semibold">{s.name}</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {s.sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
            <div className="mt-2">
              <ChainLinks slug={s.slug} name={s.name} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TwoStores({ strategy }: { strategy: TwoStoreStrategy }) {
  const { single, pair, singles, partners } = strategy;
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Estrategia de dos súper</h2>
      <p className="mb-3 max-w-2xl text-sm text-muted">
        Una canasta de {int(strategy.items)} básicos de marca (leche, arroz, aceite, yerba, limpieza…), comprada toda en un súper contra
        repartida entre las dos cadenas que más convienen: cada producto en la más barata de las dos.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Todo en {single.chains[0]!.name}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatPrice(single.total)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">{pair ? `Repartida entre ${pair.chains.map((c) => c.name).join(" y ")}` : "Repartida entre dos"}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{pair ? formatPrice(pair.total) : "–"}</p>
          {pair && (
            <p className="mt-1 text-xs text-muted">
              {pair.chains.map((c) => `${c.name} ${formatPrice(c.subtotal)}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-accent/40 bg-accent-soft p-4">
          <p className="text-xs text-muted">Ahorrás</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-accent">
            {pair ? `${formatPrice(strategy.saving)} (${pct.format(strategy.share)})` : "nada"}
          </p>
          {!pair && <p className="mt-1 text-xs text-muted">Hoy ninguna combinación le gana a comprar todo en {single.chains[0]!.name}.</p>}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-medium">Si comprás en</th>
              <th className="px-3 py-2 text-right font-medium">La canasta sale</th>
              <th className="px-3 py-2 font-medium">Mejor complemento</th>
              <th className="px-4 py-2 text-right font-medium">Ahorrás</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {partners.map((p) => {
              const plan = singles.find((s) => s.chains[0]?.slug === p.slug);
              const missing = plan?.missing.length ?? 0;
              return (
                <tr key={p.slug}>
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/?cadena=${p.slug}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                    {formatPrice(p.alone)}
                    {missing > 0 && <span className="block text-xs text-muted">sin {missing} que no vende</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.partner ? (
                      <>
                        {p.partner.name} <span className="text-xs text-muted">({p.partner.moved} productos)</span>
                      </>
                    ) : (
                      <span className="text-muted">Ninguno: ya es lo más barato</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-accent">
                    {p.partner ? `${formatPrice(p.partner.saving)} (${pct.format(p.partner.share)})` : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Para comparar los mismos productos, la canasta de arriba incluye solo lo que vende {single.chains[0]!.name}, y en la tabla cada
        cadena se compara sobre lo que ella vende. Armá tu propia lista en <Link href="/lista" className="underline">Mi lista</Link> para
        calcularlo con lo que comprás vos.
      </p>
    </section>
  );
}

function ChainDetail({ advice, ownBrands, names }: { advice: ChainCategoryAdvice; ownBrands: OwnBrandSaving[]; names: Record<string, string> }) {
  return (
    <article id={advice.slug} className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{advice.name}</h3>
        <ChainLinks slug={advice.slug} name={advice.name} />
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-accent">Donde es la más barata</h4>
          {advice.cheapest.length === 0 ? (
            <p className="text-sm text-muted">En ninguna categoría le gana a todas las demás.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {advice.cheapest.map((e) => (
                <li key={e.category} className="flex justify-between gap-3">
                  <Link href={`/categoria/${e.category}?cadena=${advice.slug}`} className="hover:underline">
                    {e.name}
                  </Link>
                  <span className="text-right tabular-nums text-muted">
                    {e.lead != null && e.lead >= 0.005 ? `${pct.format(e.lead)} menos que la siguiente` : "empata con otra cadena"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold text-sale">Donde conviene ir a otra</h4>
          {advice.dearest.length === 0 ? (
            <p className="text-sm text-muted">No está más de 2% por encima de la más barata en ninguna categoría.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {advice.dearest.map((e) => (
                <li key={e.category} className="flex justify-between gap-3">
                  <span>
                    {e.name}{" "}
                    <span className="text-muted">
                      → <Link href={`/categoria/${e.category}?cadena=${e.best}`} className="underline hover:text-accent">{names[e.best] ?? e.best}</Link>
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-muted">{pct.format(e.over)} más cara</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6">
        <h4 className="mb-2 text-sm font-semibold">Marcas propias que más ahorran</h4>
        {ownBrands.length === 0 ? (
          <p className="text-sm text-muted">No encontramos productos de marca propia con un equivalente de marca para comparar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Llevá</th>
                  <th className="px-3 py-2 font-medium">En vez de</th>
                  <th className="py-2 pl-3 text-right font-medium">Ahorrás</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ownBrands.map((o) => (
                  <tr key={o.own.id}>
                    <td className="py-2.5 pr-3">
                      <Link href={`/producto/${o.own.id}`} className="hover:underline">
                        {o.own.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {formatPrice(o.own.price)}
                        {o.kind === "exclusiva" && ` · marca que solo vende ${advice.name}`}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/producto/${o.rival.id}`} className="hover:underline">
                        {o.rival.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {formatPrice(o.rival.price)}
                        {o.rival.brand && ` · ${displayBrand(o.rival.brand)}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pl-3 text-right font-semibold tabular-nums text-accent">
                      {pct.format(o.saving)}
                      <span className="block text-xs font-normal text-muted">{formatPrice(o.savingPesos)} por paquete</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </article>
  );
}
