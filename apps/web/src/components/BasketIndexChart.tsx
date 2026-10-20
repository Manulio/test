"use client";

import type { IndexSeries } from "@precios/db";
import { useMemo, useState } from "react";
import { formatDate, formatPrice } from "@/lib/format";
import { niceTicks } from "./PriceHistory";

const W = 640;
const H = 240;
const PAD = { top: 12, right: 12, bottom: 26, left: 64 };
const DAY = 86_400_000;

const time = (date: string) => Date.parse(`${date}T12:00:00Z`);
// Las marcas son redondas: sin centavos entran en el margen.
const pesos = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

/**
 * Costo de la canasta en cada cadena a lo largo del tiempo, con el mismo estilo que PriceHistory.
 * Recibe las series ya ordenadas (la primera es la más barata hoy) y les asigna los colores en ese orden; pasadas
 * `maxSeries` ya no se distinguen por color y quedan solo en la tabla.
 */
export function BasketIndexChart({ series: all, basketSize, maxSeries }: { series: IndexSeries[]; basketSize: number; maxSeries: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const chart = useMemo(() => {
    const series = all.slice(0, maxSeries).map((s, i) => ({ ...s, color: `var(--series-${i + 1})` }));
    const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    const t0 = time(dates[0]!);
    const t1 = Math.max(time(dates.at(-1)!), t0 + DAY);
    const costs = series.flatMap((s) => s.points.map((p) => p.cost));
    const ticks = niceTicks(Math.min(...costs), Math.max(...costs));
    const yMin = ticks[0]!;
    const yMax = ticks.at(-1)! > yMin ? ticks.at(-1)! : yMin + 1;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
    const paths = series.map((s) => s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(time(p.date))},${y(p.cost)}`).join(""));
    return { series, others: all.slice(maxSeries), dates, ticks, x, y, paths };
  }, [all, maxSeries]);

  const { series, others, dates, ticks, x, y, paths } = chart;
  const hoverDate = hover == null ? null : dates[hover]!;
  const costAt = (s: IndexSeries, date: string) => s.points.find((p) => p.date === date)?.cost ?? null;

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
          aria-label={`Costo de la canasta en ${series.map((s) => s.chainName).join(", ")} entre el ${formatDate(dates[0]!)} y el ${formatDate(dates.at(-1)!)}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">
                $ {pesos.format(v)}
              </text>
            </g>
          ))}
          {[...new Set([dates[0]!, dates.at(-1)!])].map((d, i) => (
            <text key={d} x={x(time(d))} y={H - 6} textAnchor={i === 0 ? "start" : "end"} fontSize={11} fill="var(--muted)">
              {formatDate(d)}
            </text>
          ))}
          {series.map((s, i) => (
            <path key={s.chainSlug} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) =>
            s.points.length === 1 ? (
              <circle key={s.chainSlug} cx={x(time(s.points[0]!.date))} cy={y(s.points[0]!.cost)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ) : null,
          )}
          {hoverDate && (
            <g>
              <line x1={x(time(hoverDate))} x2={x(time(hoverDate))} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
              {series.map((s) => {
                const cost = costAt(s, hoverDate);
                return cost == null ? null : (
                  <circle key={s.chainSlug} cx={x(time(hoverDate))} cy={y(cost)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
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
            {series
              .map((s) => ({ s, cost: costAt(s, hoverDate) }))
              .filter((r) => r.cost != null)
              .sort((a, b) => a.cost! - b.cost!)
              .map(({ s, cost }) => (
                <p key={s.chainSlug} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.chainName}
                  </span>
                  <span className="tabular-nums">{formatPrice(cost!)}</span>
                </p>
              ))}
          </div>
        )}
      </div>

      <figcaption>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.chainSlug} className="flex items-center gap-1.5">
              <svg width="16" height="8" aria-hidden>
                <line x1="0" x2="16" y1="4" y2="4" stroke={s.color} strokeWidth={2} />
              </svg>
              {s.chainName}
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
                <th className="py-1 pr-3 text-right font-medium">Productos</th>
                <th className="py-1 pr-3 text-right font-medium">Relevado</th>
                <th className="py-1 text-right font-medium">Canasta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {all.flatMap((s) =>
                [...s.points].reverse().map((p) => (
                  <tr key={`${s.chainSlug}-${p.date}`}>
                    <td className="py-1 pr-3">{s.chainName}</td>
                    <td className="py-1 pr-3">{formatDate(p.date)}</td>
                    <td className="py-1 pr-3 text-right">
                      {p.items} de {basketSize}
                    </td>
                    <td className="py-1 pr-3 text-right">{formatPrice(p.observed)}</td>
                    <td className="py-1 text-right">{formatPrice(p.cost)}</td>
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
