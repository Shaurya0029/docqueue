import { useState, type ReactNode } from "react";
import { cx } from "../../../components/ui";
import { useT } from "../../../lib/i18n";

/** One bar: stacked segments (series 1 at the baseline), a short label and a tooltip line. */
export interface Bar {
  key: string;
  label: string;
  /** Segment values, bottom to top: index i is drawn in --series-{i+1}. */
  values: number[];
  tooltip: string;
}

/**
 * Vertical bar chart in plain HTML: thin bars with 4px rounded data ends,
 * a 2px gap between bars and between stacked segments, a recessive grid,
 * and a hover/focus tooltip per bar. Every bar is focusable and labelled,
 * so the chart is readable by keyboard and screen reader; each chart also
 * has a table view next to it.
 */
export function ColumnChart({ bars, ariaLabel, formatAxis, minBarPx = 6, labelEvery = 1 }: {
  bars: Bar[];
  ariaLabel: string;
  formatAxis: (v: number) => string;
  minBarPx?: number;
  /** Show every nth x label (dense charts). */
  labelEvery?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.values.reduce((s, v) => s + v, 0)));
  return (
    <div className="viz-root">
      <div className="flex gap-2">
        {/* y axis: top and middle values only, recessive */}
        <div className="flex h-44 w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-muted" aria-hidden>
          <span>{formatAxis(max)}</span>
          <span>{formatAxis(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div style={{ minWidth: bars.length * (minBarPx + 2) }}>
            <div
              role="list"
              aria-label={ariaLabel}
              className="relative flex h-44 items-end gap-[2px] border-b border-slate-300"
              style={{ backgroundImage: "linear-gradient(var(--viz-grid) 1px, transparent 1px)", backgroundSize: "100% 50%" }}
              onMouseLeave={() => setActive(null)}
            >
              {bars.map((b, i) => {
                const total = b.values.reduce((s, v) => s + v, 0);
                return (
                  <div
                    key={b.key}
                    role="listitem"
                    tabIndex={0}
                    aria-label={b.tooltip}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {/* the hit target is the full column, larger than the mark */}
                    <div className={cx("flex flex-col-reverse gap-[2px]", active !== null && active !== i && "opacity-60")} style={{ height: `${(total / max) * 100}%` }}>
                      {b.values.map((v, s) =>
                        v > 0 ? (
                          <div
                            key={s}
                            className={s === b.values.length - 1 || b.values.slice(s + 1).every((x) => x === 0) ? "rounded-t-[4px]" : ""}
                            style={{ flexGrow: v, minHeight: 2, background: `var(--series-${s + 1})` }}
                          />
                        ) : null
                      )}
                    </div>
                    {active === i && (
                      <div
                        role="tooltip"
                        className={cx(
                          "pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[14rem] rounded-xl bg-ink px-2.5 py-1.5 text-xs font-medium text-surface shadow-lg",
                          i < bars.length / 3 ? "left-0" : i > (bars.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                        )}
                      >
                        {b.tooltip}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-[2px] text-[10px] text-muted" aria-hidden>
              {bars.map((b, i) => (
                // Only every nth label is shown, so it may spill over its blank neighbours instead of truncating.
                <span key={b.key} className="flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap">
                  {i % labelEvery === 0 ? b.label : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars for a few named rows (one per doctor), each with its value written beside it. */
export function BarList({ rows, ariaLabel }: {
  rows: { key: string; label: string; value: number | null; max: number; text: string; note?: string }[];
  ariaLabel: string;
}) {
  return (
    <ul className="viz-root space-y-3" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink">{r.text}</span>
          </div>
          <div className="mt-1 h-2.5 rounded-r-[4px] bg-slate-100">
            {r.value !== null && (
              <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(1, (r.value / Math.max(r.max, 1e-9)) * 100)}%`, background: "var(--series-1)" }} />
            )}
          </div>
          {r.note && <p className="mt-0.5 text-xs text-muted">{r.note}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Legend with swatches; values are in text colour, the swatch carries identity. */
export function Legend({ items }: { items: { label: string; value?: string }[] }) {
  return (
    <ul className="viz-root flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
      {items.map((it, i) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: `var(--series-${i + 1})` }} aria-hidden />
          {it.label}
          {it.value && <span className="font-semibold tabular-nums">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A chart card: title, the definition behind it, the chart, and a table of the same numbers. */
export function ChartCard({ title, how, table, children }: { title: string; how: string; table: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <section className="min-w-0 space-y-4 rounded-3xl bg-surface p-4 ring-1 ring-slate-200 sm:p-5" aria-label={title}>
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {children}
      <div className="flex flex-col gap-2 text-sm">
        <details>
          <summary className="cursor-pointer font-semibold text-brand-700">{t("How is this calculated?")}</summary>
          <p className="mt-1 text-muted">{how}</p>
        </details>
        <details>
          <summary className="cursor-pointer font-semibold text-brand-700">{t("Show as table")}</summary>
          <div className="mt-2 max-h-72 overflow-auto">{table}</div>
        </details>
      </div>
    </section>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="sticky top-0 bg-surface">
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col" className={cx("border-b border-slate-200 py-1.5 pr-3 font-semibold text-muted", i > 0 && "text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-100">
            {r.map((c, j) => (
              <td key={j} className={cx("py-1.5 pr-3 text-ink", j > 0 && "text-right tabular-nums")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
