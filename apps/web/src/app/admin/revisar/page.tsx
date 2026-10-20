import { getDb, listReviewQueue, type ReviewItem } from "@precios/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { formatDate, formatPrice, formatSize } from "@/lib/format";
import { confirmAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revisar emparejamientos", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;
const pct = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 0 });

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  merged: { text: "Listo: se unió al producto sugerido y se borró el duplicado.", ok: true },
  moved: { text: "Listo: el listado pasó al producto sugerido (su producto propio tiene otros listados y se dejó).", ok: true },
  rejected: { text: "Listo: quedan como productos distintos.", ok: true },
  clash: { text: "No se unió: esa cadena ya vende el producto sugerido por separado.", ok: false },
  "not-found": { text: "Ese caso ya no estaba pendiente (quizás lo revisó otra pestaña).", ok: false },
};

type Props = { searchParams: Promise<{ pagina?: string; hecho?: string }> };

export default async function ReviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const requested = Math.max(Number.parseInt(params.pagina ?? "1", 10) || 1, 1);
  const db = getDb();
  let queue = await listReviewQueue(db, { page: requested, pageSize: PAGE_SIZE });
  const pages = Math.max(Math.ceil(queue.total / PAGE_SIZE), 1);
  // Al revisar los últimos casos de la última página, se vuelve a la anterior.
  if (queue.items.length === 0 && requested > pages) queue = await listReviewQueue(db, { page: pages, pageSize: PAGE_SIZE });
  const page = queue.page;
  const notice = params.hecho ? NOTICES[params.hecho] : undefined;
  const hrefFor = (p: number) => (p > 1 ? `/admin/revisar?pagina=${p}` : "/admin/revisar");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Revisar emparejamientos</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Listados que el matching no se animó a unir solo. Quedan{" "}
          <strong className="text-foreground tabular-nums">{queue.total.toLocaleString("es-UY")}</strong> por revisar, de
          los más parecidos a los menos.
        </p>
      </header>

      {notice && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2 text-sm ${notice.ok ? "border-accent bg-accent-soft text-accent" : "border-sale text-sale"}`}
        >
          {notice.text}
        </p>
      )}

      {queue.items.length === 0 ? (
        <p className="py-12 text-center text-muted">No hay casos pendientes. 🎉</p>
      ) : (
        <ol className="space-y-4">
          {queue.items.map((item) => (
            <ReviewCard key={item.listing.id} item={item} page={page} />
          ))}
        </ol>
      )}

      <Pagination page={page} pages={pages} hrefFor={hrefFor} />
    </div>
  );
}

function ReviewCard({ item, page }: { item: ReviewItem; page: number }) {
  const { listing, candidate } = item;
  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          Parecido: <strong className="text-foreground tabular-nums">{pct.format(item.score)}</strong>
        </span>
        <span>Listado #{listing.id}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Side
          label={`En ${listing.chainName}`}
          name={listing.name}
          brand={listing.brand}
          ean={listing.ean}
          imageUrl={listing.imageUrl}
          href={listing.url}
          note={listing.siblings > 0 ? `Su producto propio ya tiene ${listing.siblings} listado(s) más` : null}
        >
          {listing.price != null ? (
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{formatPrice(listing.price)}</span>
              {listing.listPrice != null && listing.listPrice !== listing.price && (
                <span className="ml-1.5 text-xs text-muted line-through tabular-nums">{formatPrice(listing.listPrice)}</span>
              )}
              {listing.date && <span className="ml-1.5 text-xs text-muted">({formatDate(listing.date)})</span>}
            </p>
          ) : (
            <p className="text-sm text-muted">Sin precio</p>
          )}
        </Side>
        <Side
          label="Producto sugerido"
          name={candidate.name}
          brand={[candidate.brand, formatSize(candidate.sizeAmount, candidate.sizeUnit)].filter(Boolean).join(" · ") || null}
          ean={candidate.ean}
          imageUrl={candidate.imageUrl}
          href={`/producto/${candidate.id}`}
          note={null}
        >
          {candidate.offers.length > 0 ? (
            <ul className="space-y-0.5 text-sm">
              {candidate.offers.map((o) => (
                <li key={`${o.chainSlug}-${o.source}`} className="flex justify-between gap-2">
                  <span className="truncate text-muted">
                    {o.chainName}
                    {o.source === "sipc" && " (SIPC)"}
                  </span>
                  <span className="font-semibold tabular-nums">{formatPrice(o.price)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Sin precios vigentes</p>
          )}
        </Side>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={confirmAction}>
          <input type="hidden" name="listado" value={listing.id} />
          <input type="hidden" name="pagina" value={page} />
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:text-black">
            Es el mismo
          </button>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="listado" value={listing.id} />
          <input type="hidden" name="pagina" value={page} />
          <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-sale hover:text-sale">
            Son distintos
          </button>
        </form>
      </div>
    </li>
  );
}

function Side(props: {
  label: string;
  name: string;
  brand: string | null;
  ean: string | null;
  imageUrl: string | null;
  href: string;
  note: string | null;
  children: React.ReactNode;
}) {
  const external = props.href.startsWith("http");
  return (
    <section className="flex gap-3 rounded-xl border border-border p-3">
      <div className="size-20 shrink-0 rounded-lg bg-white p-1.5 sm:size-24">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imágenes de dominios de cada cadena
          <img src={props.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl text-neutral-300">🛒</div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</p>
        <h2 className="text-sm font-medium leading-snug">
          {external ? (
            <a href={props.href} target="_blank" rel="noreferrer" className="hover:underline">
              {props.name}
            </a>
          ) : (
            <Link href={props.href} target="_blank" className="hover:underline">
              {props.name}
            </Link>
          )}
        </h2>
        <p className="text-xs text-muted">
          {props.brand ?? "Sin marca"} · EAN {props.ean ?? "–"}
        </p>
        {props.note && <p className="text-xs text-sale">{props.note}</p>}
        {props.children}
      </div>
    </section>
  );
}
