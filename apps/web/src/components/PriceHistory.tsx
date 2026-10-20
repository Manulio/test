"use client";

import type { ChainHistory } from "@precios/db";
import { useMemo, useState } from "react";
import { formatDate, formatPrice } from "@/lib/format";

/** Más cadenas no se distinguen por color: se muestran las más baratas hoy y el resto queda en la tabla. */
const MAX_SERIES = 5;
const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 56 };
const DAY = 86_400_000;

const time = (date: string) => Date.parse(`${date}T12:00:00Z`);

/** Precio vigente de una serie en una fecha: el último relevado hasta ese día (null si todavía no había). */
function priceAt(series: ChainHistory, t: number): number | null {
  let price: number | null = null;
  for (const p of series.points) {
    if (time(p.date) > t) break;
    price = p.price;
  }
  return price;
}

/** 3 o 4 marcas "redondas" para el eje de precios. */
export function niceTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, 1);
  const raw = span / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

/** Gráfico del precio de un producto en cada cadena a lo largo del tiempo. */
export function PriceHistory({ history }: { history: ChainHistory[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const chart = useMemo(() => {
    const lastPrice = (s: ChainHistory) => s.points.at(-1)!.price;
    // Con un solo precio por cadena no hay evolución que mostrar (pasa hasta que se acumulan scrapeos diarios).
    if (!history.some((s) => s.points.length > 1)) return null;
    // Primero los precios de hoy, después las cadenas con más historia y, a igualdad, de la más barata a la más cara.
    const ranked = history
      .filter((s) => s.points.length > 0)
      .sort(
        (a, b) =>
          Number(a.source === "sipc") - Number(b.source === "sipc") ||
          Number(b.points.length > 1) - Number(a.points.length > 1) ||
          lastPrice(a) - lastPrice(b),
      );
    const series = ranked.slice(0, MAX_SERIES).map((s, i) => ({ ...s, color: `var(--series-${i + 1})` }));
    const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();

    const t0 = time(dates[0]!);
    const t1 = Math.max(time(dates.at(-1)!), t0 + DAY);
    const prices = series.flatMap((s) => s.points.map((p) => p.price));
    const ticks = niceTicks(Math.min(...prices), Math.max(...prices));
    const yMin = ticks[0]!;
    const yMax = ticks.at(-1)! > yMin ? ticks.at(-1)! : yMin + 1;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    // Escalones: el precio se mantiene hasta el próximo relevamiento.
    const paths = series.map((s) => {
      let d = "";
      s.points.forEach((p, i) => {
        const px = x(time(p.date));
        const py = y(p.price);
        d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
      });
      return d;
    });

    return { series, others: ranked.slice(MAX_SERIES), dates, ticks, x, y, paths, t0, t1 };
  }, [history]);

  if (!chart) {
    return (
      <p className="text-sm text-muted">
        Todavía no hay cambios de precio registrados. El historial se arma con cada scrapeo diario: en unos días vas a ver acá cómo evoluciona.
      </p>
    );
  }

  const { series, others, dates, ticks, x, y, paths } = chart;
  const hoverDate = hover == null ? null : dates[hover]!;

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    dates.forEach((d, i) => {
      if (Math.abs(x(time(d)) - vx) < Math.abs(x(time(dates[best]!)) - vx)) best = i;
    });
    setHover(best);
  }

  return (
    <figure>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none select-none"
          role="img"
          aria-label={`Precio en ${series.map((s) => s.chainName).join(", ")} entre el ${formatDate(dates[0]!)} y el ${formatDate(dates.at(-1)!)}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">
                {formatPrice(v)}
              </text>
            </g>
          ))}
          {[dates[0]!, dates.at(-1)!].map((d, i) => (
            <text key={d} x={x(time(d))} y={H - 6} textAnchor={i === 0 ? "start" : "end"} fontSize={11} fill="var(--muted)">
              {formatDate(d)}
            </text>
          ))}
          {series.map((s, i) => (
            <path
              key={s.chainSlug}
              d={paths[i]}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              // Los del SIPC (medianas oficiales con atraso) van punteados, para no depender solo del color.
              strokeDasharray={s.source === "sipc" ? "5 4" : undefined}
            />
          ))}
          {series.map((s) =>
            s.points.length === 1 ? (
              <circle key={s.chainSlug} cx={x(time(s.points[0]!.date))} cy={y(s.points[0]!.price)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ) : null,
          )}
          {hoverDate && (
            <g>
              <line x1={x(time(hoverDate))} x2={x(time(hoverDate))} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
              {series.map((s) => {
                const price = priceAt(s, time(hoverDate));
                return price == null ? null : (
                  <circle key={s.chainSlug} cx={x(time(hoverDate))} cy={y(price)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                );
              })}
            </g>
          )}
        </svg>
        {hoverDate && (
          <div
            className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
            style={
              x(time(hoverDate)) > W / 2
                ? { right: `${(1 - x(time(hoverDate)) / W) * 100 + 2}%` }
                : { left: `${(x(time(hoverDate)) / W) * 100 + 2}%` }
            }
          >
            <p className="mb-1 font-semibold">{formatDate(hoverDate)}</p>
            {series.map((s) => {
              const price = priceAt(s, time(hoverDate));
              return price == null ? null : (
                <p key={s.chainSlug} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.chainName}
                  </span>
                  <span className="tabular-nums">{formatPrice(price)}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>

      <figcaption>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.chainSlug} className="flex items-center gap-1.5">
              <svg width="16" height="8" aria-hidden>
                <line x1="0" x2="16" y1="4" y2="4" stroke={s.color} strokeWidth={2} strokeDasharray={s.source === "sipc" ? "4 3" : undefined} />
              </svg>
              {s.chainName}
              {s.source === "sipc" && <span className="text-muted">(SIPC)</span>}
            </li>
          ))}
          {others.length > 0 && <li className="text-muted">y {others.length} más en la tabla</li>}
        </ul>
      </figcaption>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted hover:text-accent">Ver los datos</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Cadena</th>
                <th className="py-1 pr-3 font-medium">Fecha</th>
                <th className="py-1 text-right font-medium">Precio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...series, ...others].flatMap((s) =>
                [...s.points].reverse().map((p) => (
                  <tr key={`${s.chainSlug}-${p.date}`}>
                    <td className="py-1 pr-3">{s.chainName}</td>
                    <td className="py-1 pr-3">{formatDate(p.date)}</td>
                    <td className="py-1 text-right">{formatPrice(p.price)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
