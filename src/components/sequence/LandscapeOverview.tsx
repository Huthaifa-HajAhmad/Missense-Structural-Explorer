import React, { useMemo, useState } from "react";
import type {
  LandscapeContext,
  LandscapeResidueItem,
} from "../../shared/contracts";
import {
  bandKey,
  residueSummary,
  type SummaryMode,
} from "../../shared/landscapeEvidence";
import type { LandscapeViewState } from "../../stores/slices/searchSlice";
import type { DomainSpan } from "./types";
import { useMeasuredWidth } from "./useMeasuredWidth";
import { useRovingGrid } from "./useRovingGrid";
import { overviewBins, proteinTicks } from "./overviewBins";

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
  onMove: (pos: number) => void;
  onPick: (pos: number) => void;
  onRetry?: () => void;
  pageStep: number;
  onExplore?: () => void;
}
const SCORE_H = 144;
const CLASSES = [
  { key: "plp", label: "P / LP", color: "var(--ls-clinvar-plp)" },
  { key: "other", label: "VUS / other", color: "var(--cs-text-muted)" },
  { key: "blb", label: "B / LB", color: "var(--ls-bp4-strong)" },
] as const;

/** A shared protein axis with separate, explicitly labelled evidence tracks. */
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
  pageStep,
  onExplore,
}: Props) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const width = Math.max(0, measured);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const clinvarGrid = useRovingGrid<HTMLDivElement>();
  const populationGrid = useRovingGrid<HTMLDivElement>();
  const [detail, setDetail] = useState<string | null>(null);
  const [jump, setJump] = useState("");
  const unit = width / Math.max(1, length);
  const x = (pos: number) => (pos - 1) * unit;
  const posAt = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    return Math.min(
      length,
      Math.max(
        1,
        Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * length) +
          1,
      ),
    );
  };
  const bars = useMemo(
    () =>
      (positions ?? [])
        .map((p) => ({
          pos: p.residx,
          v: residueSummary(p, "alphaMissense", mode),
        }))
        .filter(
          (b): b is { pos: number; v: number } =>
            b.v !== null && b.pos >= 1 && b.pos <= length,
        ),
    [positions, mode, length],
  );
  const byPos = useMemo(() => new Map(bars.map((b) => [b.pos, b.v])), [bars]);
  const cv = useMemo(
    () =>
      CLASSES.map((cls) => ({
        ...cls,
        ...overviewBins(
          (context?.clinvar ?? []).filter((c) => c.cls === cls.key),
          length,
          width,
        ),
      })),
    [context?.clinvar, length, width],
  );
  const gn = useMemo(
    () => overviewBins(context?.gnomad ?? [], length, width),
    [context?.gnomad, length, width],
  );
  const gnMax = Math.max(
    0,
    ...gn.bins.map((b) => b.items.reduce((n, g) => n + g.variants, 0)),
  );
  const center = Math.round((window.start + window.end) / 2);
  const size = window.end - window.start + 1;
  const start =
    drag === null
      ? window.start
      : Math.min(
          Math.max(1, length - size + 1),
          Math.max(1, drag - Math.floor(size / 2)),
        );
  const box =
    drag === null ? window : { start, end: Math.min(length, start + size - 1) };
  const onKey = (e: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      PageUp: -pageStep,
      PageDown: pageStep,
    };
    if (e.key in steps)
      onMove(Math.min(length, Math.max(1, center + steps[e.key])));
    else if (e.key === "Home") onMove(1);
    else if (e.key === "End") onMove(length);
    else return;
    e.preventDefault();
  };
  const markers = (height: number) => (
    <>
      <rect
        x={x(box.start)}
        y={0}
        width={Math.max(2, (box.end - box.start + 1) * unit)}
        height={height}
        fill="var(--cs-text-primary)"
        fillOpacity={0.04}
        stroke="var(--cs-text-primary)"
        strokeOpacity={0.4}
        rx={2}
      />
      {targetPos > 0 && targetPos <= length && (
        <line
          x1={x(targetPos) + unit / 2}
          x2={x(targetPos) + unit / 2}
          y1={0}
          y2={height}
          stroke="var(--cs-accent-clay)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      )}
    </>
  );
  const track = (label: string, content: React.ReactNode) => (
    <div className="ls-overview__track">
      <span className="ls-overview__label">{label}</span>
      <div className="ls-overview__plot">{content}</div>
    </div>
  );
  const binAction = (
    items: readonly { pos: number }[],
    a: number,
    b: number,
  ) => {
    const distinct = new Set(items.map((i) => i.pos));
    if (distinct.size === 1) {
      onPick(items[0].pos);
      onExplore?.();
    } else onMove(Math.round((a + b) / 2));
  };
  const hoverText =
    hover === null
      ? `Focus ${box.start}–${box.end}`
      : `Residue ${hover} · AlphaMissense ${mode} ${byPos.has(hover) ? byPos.get(hover)!.toFixed(3) : "not scored"}`;
  return (
    <section
      className="ls-panel ls-overview"
      aria-label="Whole-protein overview"
    >
      <header className="ls-overview__header">
        <div>
          <h4>Whole protein</h4>
          <p>
            1–{length.toLocaleString()} residues · drag or click the score track
            to move the focus window
          </p>
        </div>
        <form
          className="ls-overview__jump"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(jump);
            if (Number.isInteger(n) && n >= 1 && n <= length) onMove(n);
          }}
        >
          <label>
            Go to residue
            <input
              type="number"
              min={1}
              max={length}
              step={1}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              placeholder={String(center)}
            />
          </label>
          <button type="submit" className="viz-action">
            Go
          </button>
        </form>
      </header>
      <div className="ls-overview__scope">
        <span>
          AlphaMissense · residue {mode} over scored substitutions · orientation
          only
        </span>
        <span>
          {bars.length.toLocaleString()} / {length.toLocaleString()} residues
          scored
        </span>
      </div>
      {track(
        "AM score",
        <div className="ls-overview__score-wrap">
          <div className="ls-overview__y-axis" aria-hidden="true">
            <span>1</span>
            <span>0.5</span>
            <span>0</span>
          </div>
          <div
            ref={ref}
            className="ls-overview__slider"
            style={{ height: SCORE_H, touchAction: "pan-y" }}
            role="slider"
            tabIndex={0}
            aria-label="Focus window position"
            aria-valuemin={1}
            aria-valuemax={length}
            aria-valuenow={center}
            aria-valuetext={`Residues ${window.start} to ${window.end}`}
            onKeyDown={onKey}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setDrag(posAt(e.clientX, e.currentTarget));
            }}
            onPointerMove={(e) => {
              const n = posAt(e.clientX, e.currentTarget);
              setHover(n);
              if (drag !== null) setDrag(n);
            }}
            onPointerUp={(e) => {
              if (drag !== null) onMove(posAt(e.clientX, e.currentTarget));
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            onMouseLeave={() => setHover(null)}
          >
            {status === "loading" && (
              <span className="ls-overview__state">
                Loading whole-protein scores…
              </span>
            )}
            {status === "error" && (
              <span className="ls-overview__state">
                Whole-protein scores not loaded{error ? `: ${error}` : ""}
              </span>
            )}
            {status === "ready" && bars.length === 0 && (
              <span className="ls-overview__state">
                No whole-protein AlphaMissense scores returned.
              </span>
            )}
            {width > 0 && (
              <svg width={width} height={SCORE_H} aria-hidden="true">
                {[0, 0.5, 1].map((v) => (
                  <line
                    key={v}
                    x1={0}
                    x2={width}
                    y1={1 + (1 - v) * (SCORE_H - 2)}
                    y2={1 + (1 - v) * (SCORE_H - 2)}
                    stroke="var(--cs-border-subtle)"
                    strokeDasharray={v === 0 ? undefined : "3 4"}
                  />
                ))}
                {bars.map((b) => (
                  <rect
                    key={b.pos}
                    x={x(b.pos)}
                    y={1 + (1 - b.v) * (SCORE_H - 2)}
                    width={Math.max(0.1, unit - (unit > 3 ? 0.5 : 0))}
                    height={Math.max(1, b.v * (SCORE_H - 2))}
                    fill={`var(--ls-${bandKey("alphaMissense", b.v)})`}
                  />
                ))}
                {markers(SCORE_H)}
              </svg>
            )}
          </div>
        </div>,
      )}
      {status === "error" && onRetry && (
        <button
          type="button"
          className="viz-action self-start"
          onClick={onRetry}
        >
          Retry whole-protein scores
        </button>
      )}
      {track(
        "Residue",
        width > 0 && (
          <svg
            width={width}
            height={34}
            className="ls-overview__axis"
            aria-hidden="true"
          >
            {proteinTicks(length).map((p) => (
              <g key={p}>
                <line
                  x1={x(p) + unit / 2}
                  x2={x(p) + unit / 2}
                  y1={0}
                  y2={5}
                  stroke="var(--cs-border)"
                />
                <text
                  x={p === length ? width : x(p)}
                  y={21}
                  textAnchor={
                    p === 1 ? "start" : p === length ? "end" : "middle"
                  }
                >
                  {p.toLocaleString()}
                </text>
              </g>
            ))}
          </svg>
        ),
      )}
      {domains.length > 0 &&
        track(
          "Domains",
          <div className="relative h-7">
            {domains.map((d, i) => (
              <div
                key={i}
                className="ls-domain absolute overflow-hidden"
                style={{
                  left: x(d.start),
                  width: Math.max(2, (d.end - d.start + 1) * unit),
                  height: 22,
                }}
                title={`${d.name} (${d.start}–${d.end})`}
              >
                <span className="text-[11px] px-1 truncate block">
                  {d.name}
                </span>
              </div>
            ))}
          </div>,
        )}
      {lanes.clinvar && (
        <div
          className="ls-overview__group"
          role={cv.some((c) => c.bins.length > 0) ? "group" : undefined}
          aria-label="ClinVar missense counts by assertion class"
          ref={clinvarGrid.ref}
          onFocus={clinvarGrid.onFocus}
          onKeyDown={clinvarGrid.onKeyDown}
        >
          <div className="ls-overview__scope">
            <strong>ClinVar missense</strong>
            <span>
              Records per{" "}
              {cv[0].size === 1 ? "residue" : `${cv[0].size}-residue bin`} ·
              separate assertion classes
            </span>
          </div>
          {context?.clinvar == null ? (
            <p className="ls-overview__missing">
              {status === "ready" || status === "error"
                ? "ClinVar not loaded"
                : "ClinVar context pending"}
            </p>
          ) : context.clinvar.length === 0 ? (
            <p className="ls-overview__missing">
              No ClinVar missense records returned.
            </p>
          ) : (
            cv.map((cls, rowIndex) => {
              const max = Math.max(0, ...cls.bins.map((b) => b.items.length));
              return (
                <React.Fragment key={cls.key}>
                  {track(
                    `${cls.label} · max ${max}`,
                    <svg width={width} height={32} role="presentation">
                      <line
                        x1={0}
                        x2={width}
                        y1={31}
                        y2={31}
                        stroke="var(--cs-border-subtle)"
                      />
                      {cls.bins.map((b) => {
                        const label = `Residues ${b.start}–${b.end}: ${b.items.length} ClinVar ${cls.label} records across ${new Set(b.items.map((c) => c.pos)).size} residue position(s)`;
                        return (
                          <g
                            key={b.start}
                            data-rc={`${rowIndex}:${(b.start - 1) / cls.size}`}
                            data-entry={
                              b.start <= targetPos && b.end >= targetPos
                                ? ""
                                : undefined
                            }
                            tabIndex={-1}
                            role="button"
                            aria-label={label}
                            onMouseEnter={() => setDetail(label)}
                            onMouseLeave={() => setDetail(null)}
                            onFocus={() => setDetail(label)}
                            onBlur={() => setDetail(null)}
                            className="ls-overview__bin"
                            onClick={() => binAction(b.items, b.start, b.end)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                binAction(b.items, b.start, b.end);
                              }
                            }}
                          >
                            <title>{`${label}\n${b.items.map((c) => `${c.hgvsp} · ${c.significance}${c.stars !== null ? ` · ${c.stars}★` : ""}`).join("\n")}`}</title>
                            <rect
                              x={x(b.start)}
                              y={1}
                              width={Math.max(1, (b.end - b.start + 1) * unit)}
                              height={31}
                              fill="transparent"
                            />
                            <rect
                              x={x(b.start)}
                              y={31 - (b.items.length / Math.max(1, max)) * 27}
                              width={Math.max(
                                1,
                                (b.end - b.start + 1) * unit - 1,
                              )}
                              height={(b.items.length / Math.max(1, max)) * 27}
                              rx={1}
                              fill={cls.color}
                            />
                          </g>
                        );
                      })}
                      {cls.bins.length === 0 && (
                        <text x={8} y={20} className="ls-overview__empty-class">
                          No records
                        </text>
                      )}
                      <g pointerEvents="none">{markers(32)}</g>
                    </svg>,
                  )}
                </React.Fragment>
              );
            })
          )}
          {context?.clinvar && context.clinvar.length > 0 && (
            <p className="ls-overview__missing">
              Each class has its own count scale; classifications are
              assertions, not predictor score bands. Hover or focus a bin for
              exact counts; activate it to explore its residues.
            </p>
          )}
        </div>
      )}
      {lanes.gnomad && (
        <div
          className="ls-overview__group"
          role={gn.bins.length > 0 ? "group" : undefined}
          aria-label="gnomAD missense variant counts on a logarithmic scale"
          ref={populationGrid.ref}
          onFocus={populationGrid.onFocus}
          onKeyDown={populationGrid.onKeyDown}
        >
          <div className="ls-overview__scope">
            <strong>gnomAD missense</strong>
            <span>
              Variant count per{" "}
              {gn.size === 1 ? "residue" : `${gn.size}-residue bin`} · log₁₀(1 +
              count) · max {gnMax}
            </span>
          </div>
          {context?.gnomad == null ? (
            <p className="ls-overview__missing">
              {status === "ready" || status === "error"
                ? "gnomAD not loaded"
                : "gnomAD context pending"}
            </p>
          ) : context.gnomad.length === 0 ? (
            <p className="ls-overview__missing">
              No gnomAD missense variants returned.
            </p>
          ) : (
            track(
              "Variants",
              <svg
                width={width}
                height={46}
                role="group"
                aria-label="gnomAD missense variant counts on a logarithmic scale"
              >
                <line
                  x1={0}
                  x2={width}
                  y1={45}
                  y2={45}
                  stroke="var(--cs-border-subtle)"
                />
                {gn.bins.map((b) => {
                  const count = b.items.reduce((n, g) => n + g.variants, 0);
                  const h =
                    (Math.log10(1 + count) /
                      Math.log10(1 + Math.max(1, gnMax))) *
                    40;
                  const label = `Residues ${b.start}–${b.end}: ${count} gnomAD missense variants, maximum allele count ${Math.max(...b.items.map((g) => g.maxAc))}`;
                  return (
                    <g
                      key={b.start}
                      className="ls-overview__bin"
                      data-rc={`0:${(b.start - 1) / gn.size}`}
                      data-entry={
                        b.start <= targetPos && b.end >= targetPos
                          ? ""
                          : undefined
                      }
                      tabIndex={-1}
                      role="button"
                      aria-label={label}
                      onMouseEnter={() => setDetail(label)}
                      onMouseLeave={() => setDetail(null)}
                      onFocus={() => setDetail(label)}
                      onBlur={() => setDetail(null)}
                      onClick={() => binAction(b.items, b.start, b.end)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          binAction(b.items, b.start, b.end);
                        }
                      }}
                    >
                      <title>{label}</title>
                      <rect
                        x={x(b.start)}
                        y={1}
                        width={Math.max(1, (b.end - b.start + 1) * unit)}
                        height={44}
                        fill="transparent"
                      />
                      <rect
                        x={x(b.start)}
                        y={45 - h}
                        width={Math.max(1, (b.end - b.start + 1) * unit - 1)}
                        height={h}
                        rx={1}
                        fill="var(--cs-text-muted)"
                      />
                    </g>
                  );
                })}
                <g pointerEvents="none">{markers(46)}</g>
              </svg>,
            )
          )}
        </div>
      )}
      {lanes.regions &&
        status === "ready" &&
        (context?.regions === null || (context?.regions?.length ?? 0) > 0) &&
        track(
          "Missense O/E",
          context?.regions === null ? (
            <p className="ls-overview__missing">
              {context.regionsStatus === "withheld-mapping"
                ? "Regional map withheld: transcript-to-protein mapping not verified"
                : "Regional constraint not loaded"}
            </p>
          ) : (
            <>
            <div className="relative h-7">
              {context?.regions?.map((r, i) => (
                <div
                  key={i}
                  className="absolute h-6 rounded text-[11px] px-1 overflow-hidden"
                  style={{
                    left: x(r.start),
                    width: Math.max(2, (r.end - r.start + 1) * unit),
                    background:
                      r.oe !== null && r.oe < 0.6
                        ? "var(--cs-text-secondary)"
                        : "var(--ls-indeterminate)",
                    color:
                      r.oe !== null && r.oe < 0.6
                        ? "var(--cs-surface)"
                        : "var(--cs-text-primary)",
                  }}
                  title={`Residues ${r.start}–${r.end}: O/E ${r.oe ?? "not reported"} (${context.regionsBasis})${r.pValue != null ? `, p ${r.pValue}` : ""}`}
                >
                  O/E {r.oe ?? "—"}
                </div>
              ))}
            </div>
            <p className="ls-overview__missing">
              solid bar = fewer missense observed than expected (O/E &lt; 0.6); light bar = O/E ≥ 0.6 or not reported.
              Basis: {context?.regionsBasis}
            </p>
            </>
          ),
        )}
      <footer className="ls-overview__footer">
        <span className="font-mono ls-overview__readout">
          {detail ?? hoverText}
        </span>
        {targetPos > 0 && targetPos <= length && (
          <button
            type="button"
            onClick={() => onMove(targetPos)}
            className="ls-overview__query"
          >
            ↳ Query residue {targetPos}
          </button>
        )}
        <span>Outline: focus window · dashed line: query</span>
        {onExplore && (
          <button type="button" className="viz-action" onClick={onExplore}>
            Explore focus {box.start}–{box.end} →
          </button>
        )}
      </footer>
      <p className="ls-overview__missing">
        Protein-wide context does not assign ACMG evidence. Unscored residues
        remain empty; zero is a scored value at the baseline.
      </p>
      {status === "ready" && domains.length === 0 && (
        <p className="ls-overview__missing">
          no UniProt domain or region annotated
        </p>
      )}
      {lanes.regions &&
        status === "ready" &&
        context?.regions?.length === 0 && (
          <p className="ls-overview__missing">
            no regional missense constraint call for this gene
          </p>
        )}
    </section>
  );
}
