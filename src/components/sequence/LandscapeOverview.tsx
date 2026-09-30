import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LandscapeContext, LandscapeResidueItem } from "../../shared/contracts";
import { bandKey, residueSummary, type SummaryMode } from "../../shared/landscapeEvidence";
import type { LandscapeViewState } from "../../stores/slices/searchSlice";
import type { DomainSpan } from "./types";

interface Props {
  length: number;
  status: "loading" | "ready" | "error" | "idle";
  error?: string | null;
  positions: LandscapeResidueItem[] | null;
  context: LandscapeContext | null;
  domains: DomainSpan[];
  window: { start: number; end: number };
  targetPos: number;
  mode: SummaryMode;
  lanes: LandscapeViewState["lanes"];
  /** Moves the focus window only (strip click, arrow keys); selects nothing. */
  onMove: (pos: number) => void;
  /** Selects a residue (a ClinVar marker). */
  onPick: (pos: number) => void;
  onRetry?: () => void;
  /** Keyboard step for PageUp/PageDown: one focus width. */
  pageStep: number;
}

const GUTTER = 96;
const BAR_H = 44;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * The whole protein on one strip: domains, AlphaMissense residue summaries, ClinVar and gnomAD
 * missense positions, and regional missense constraint. The outlined box is the focus window;
 * clicking or arrow keys move it.
 */
export function LandscapeOverview({
  length,
  status,
  error,
  positions,
  context,
  domains,
  window,
  targetPos,
  mode,
  lanes,
  onMove,
  onPick,
  onRetry,
  pageStep
}: Props) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = Math.max(0, measured);
  const [hover, setHover] = useState<number | null>(null);
  const x = (pos: number) => ((pos - 1) / Math.max(1, length)) * width;
  const unit = width / Math.max(1, length);
  const posAt = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    return Math.min(length, Math.max(1, Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * length) + 1));
  };

  const bars = useMemo(() => {
    if (!positions) return [];
    return positions
      .map((p) => ({ pos: p.residx, v: residueSummary(p, "alphaMissense", mode) }))
      .filter((b): b is { pos: number; v: number } => b.v !== null);
  }, [positions, mode]);
  const byPos = useMemo(() => new Map(bars.map((b) => [b.pos, b.v])), [bars]);
  const center = Math.round((window.start + window.end) / 2);

  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -pageStep, PageDown: pageStep } as Record<string, number>;
    if (e.key in step) onMove(Math.min(length, Math.max(1, center + step[e.key])));
    else if (e.key === "Home") onMove(1);
    else if (e.key === "End") onMove(length);
    else return;
    e.preventDefault();
  };

  const hoverText = (() => {
    if (hover === null) return null;
    const v = byPos.get(hover);
    const cv = context?.clinvar?.filter((c) => c.pos === hover) ?? [];
    const gn = context?.gnomad?.find((g) => g.pos === hover);
    return [
      `Residue ${hover}`,
      v !== undefined ? `AlphaMissense ${mode} ${v.toFixed(3)}` : "no score",
      cv.length ? `ClinVar ${cv.map((c) => c.significance).join(", ")}` : null,
      gn ? `gnomAD ${gn.variants} missense (max AC ${gn.maxAc})` : null
    ]
      .filter(Boolean)
      .join(" · ");
  })();

  const laneRow = (label: string, height: number, children: React.ReactNode, note?: string | null) => (
    <div className="flex items-center">
      <span className="ls-gutter" style={{ width: GUTTER }}>{label}</span>
      <div className="relative flex-grow" style={{ height }}>
        {note ? <span className="text-[10px] text-cs-text-muted leading-none">{note}</span> : children}
      </div>
    </div>
  );

  return (
    <section className="ls-panel px-4 py-3 flex flex-col gap-1.5" aria-label="Whole-protein overview">
      <div className="flex justify-between gap-3 text-[12px] text-cs-text-secondary">
        <span className="font-semibold text-cs-text-primary">Whole protein · 1–{length} · click or use arrow keys to move the focus window</span>
        <span className="text-cs-text-muted">AlphaMissense residue {mode} over SNV-reachable substitutions</span>
      </div>

      {laneRow(
        "DOMAINS",
        14,
        width > 0 &&
          (domains.length === 0 ? (
            <span className="text-[10px] text-cs-text-muted">none annotated</span>
          ) : (
            domains.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                className="ls-domain absolute top-[2px] overflow-hidden"
                style={{ left: x(d.start), width: Math.max(2, (d.end - d.start + 1) * unit) }}
                title={`${d.name} (${d.start}–${d.end})`}
              >
                <span className="px-1 text-[9px] leading-[10px] font-mono text-cs-text-primary truncate block">{d.name}</span>
              </div>
            ))
          ))
      )}

      <div className="flex items-end">
        <span className="ls-gutter self-center" style={{ width: GUTTER }}>AM</span>
        <div
          ref={ref}
          className="relative flex-grow cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-cs-accent-clay"
          style={{ height: BAR_H }}
          role="slider"
          tabIndex={0}
          aria-label="Focus window position"
          aria-valuemin={1}
          aria-valuemax={length}
          aria-valuenow={center}
          aria-valuetext={`Residues ${window.start} to ${window.end}`}
          onKeyDown={onKey}
          onClick={(e) => onMove(posAt(e.clientX, e.currentTarget))}
          onMouseMove={(e) => setHover(posAt(e.clientX, e.currentTarget))}
          onMouseLeave={() => setHover(null)}
        >
          {status === "loading" && <span className="absolute inset-0 flex items-center text-[11px] text-cs-text-muted">Loading whole-protein scores…</span>}
          {status === "error" && (
            <span className="absolute inset-0 flex items-center gap-2 text-[11px] text-cs-text-warning">
              Whole-protein scores not loaded{error ? `: ${error}` : ""}
              {onRetry && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry();
                  }}
                  className="px-2 py-0.5 rounded border border-cs-border bg-cs-surface text-cs-text-primary cursor-pointer"
                >
                  Retry
                </button>
              )}
            </span>
          )}
          {width > 0 && (
            <svg width={width} height={BAR_H} className="block" aria-hidden="true">
              <rect x={0} y={BAR_H - 1} width={width} height={1} fill="var(--cs-border-subtle)" />
              {bars.map((b) => {
                const h = 3 + b.v * (BAR_H - 5);
                return (
                  <rect
                    key={b.pos}
                    x={x(b.pos)}
                    y={BAR_H - h}
                    width={Math.max(1, unit - (unit > 3 ? 0.5 : 0))}
                    height={h}
                    fill={`var(--ls-${bandKey("alphaMissense", b.v)})`}
                  />
                );
              })}
              <rect x={x(targetPos)} y={0} width={Math.max(1.5, unit)} height={BAR_H} fill="var(--cs-accent-clay)" opacity={0.9} />
              <rect
                x={x(window.start)}
                y={1}
                width={Math.max(3, (window.end - window.start + 1) * unit)}
                height={BAR_H - 2}
                fill="var(--cs-text-primary)"
                fillOpacity={0.05}
                stroke="var(--cs-text-primary)"
                strokeWidth={1.5}
                rx={2}
              />
            </svg>
          )}
        </div>
      </div>

      {lanes.clinvar &&
        laneRow(
          "CLINVAR",
          16,
          width > 0 && (
            <svg width={width} height={16} className="block overflow-visible" role="img" aria-label={`${context?.clinvar?.length ?? 0} ClinVar missense variants`}>
              {(context?.clinvar ?? []).map((c, i) => {
                const cx = x(c.pos) + unit / 2;
                return (
                  <g key={`${c.pos}-${i}`} className="cursor-pointer" onClick={() => onPick(c.pos)}>
                    <line x1={cx} y1={8} x2={cx} y2={16} stroke="var(--cs-text-muted)" strokeWidth={1} />
                    <circle
                      cx={cx}
                      cy={5}
                      r={3.5}
                      fill={c.cls === "plp" ? "var(--ls-pp3-strong)" : c.cls === "blb" ? "var(--cs-surface)" : "var(--cs-text-muted)"}
                      stroke={c.cls === "blb" ? "var(--ls-bp4-strong)" : "none"}
                      strokeWidth={1.5}
                    >
                      <title>{`${c.hgvsp} · ${c.significance}${c.stars !== null ? ` · ${c.stars}★` : ""}`}</title>
                    </circle>
                  </g>
                );
              })}
            </svg>
          ),
          status === "ready" && context?.clinvar === null ? "ClinVar not loaded" : null
        )}

      {lanes.gnomad &&
        laneRow(
          "GNOMAD",
          10,
          width > 0 && (
            <svg width={width} height={10} className="block" role="img" aria-label={`gnomAD missense at ${context?.gnomad?.length ?? 0} residues`}>
              {(context?.gnomad ?? []).map((g) => (
                <circle key={g.pos} cx={x(g.pos) + unit / 2} cy={5} r={Math.min(4, 1.6 + Math.log10(g.maxAc + 1))} fill="var(--cs-text-secondary)">
                  <title>{`Residue ${g.pos}: ${g.variants} missense, max AC ${g.maxAc}`}</title>
                </circle>
              ))}
            </svg>
          ),
          status === "ready" && context?.gnomad === null ? "gnomAD not loaded" : null
        )}

      {lanes.regions &&
        laneRow(
          "MISSENSE O/E",
          14,
          width > 0 &&
            (context?.regions ?? []).map((r) => {
              const low = r.oe !== null && r.oe < 0.6;
              return (
                <div
                  key={`${r.start}-${r.end}`}
                  className="absolute top-[2px] h-[10px] overflow-hidden text-[9px] leading-[10px] pl-1 font-mono rounded-sm"
                  style={{
                    left: x(r.start),
                    width: Math.max(2, (r.end - r.start + 1) * unit),
                    background: low ? "var(--cs-text-secondary)" : "var(--ls-indeterminate)",
                    color: low ? "var(--cs-surface)" : "var(--cs-text-primary)"
                  }}
                  title={`Residues ${r.start}–${r.end}: missense O/E ${r.oe ?? "—"}${r.pValue !== null ? `, p ${r.pValue}` : ""} (${context?.regionsBasis ?? ""})`}
                >
                  O/E {r.oe ?? "—"}
                </div>
              );
            }),
          status === "ready" && context?.regions === null
            ? "Regional constraint not loaded"
            : status === "ready" && context?.regions?.length === 0
              ? "no regional missense constraint call for this gene"
              : null
        )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-cs-text-muted" style={{ paddingLeft: GUTTER }}>
        <span className="min-w-[260px] font-mono text-cs-text-secondary">{hoverText ?? `Focus ${window.start}–${window.end}`}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--ls-pp3-strong)" }} />ClinVar P/LP</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full border-[1.5px]" style={{ borderColor: "var(--ls-bp4-strong)" }} />B/LB</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-cs-text-muted" />VUS / conflicting</span>
        <span>O/E: solid bar = fewer missense observed than expected (O/E &lt; 0.6) ({context?.regionsBasis ?? "gnomAD v2"})</span>
      </div>
    </section>
  );
}
