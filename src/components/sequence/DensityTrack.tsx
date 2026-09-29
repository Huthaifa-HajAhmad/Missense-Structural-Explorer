import React from "react";

/**
 * Profile track for the AlphaGenome exon panel, kept generic so a residue panel can reuse it and read as
 * one instrument: same gutter, height, stroke, guide style and gap semantics. It draws a line per
 * series: a profile of per-position values, not a density.
 */

export const DENSITY_TRACK_HEIGHT = 64;
export const DENSITY_COLLAPSED_HEIGHT = 22;
export const DENSITY_GUTTER_CLASS = "w-[68px] shrink-0 pr-2 text-right select-none";

/** A point is drawable only when the backend returned a finite number; absent data stays absent. */
export function isDensityPoint(value: number | null | undefined | boolean): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export type DensitySeries = {
  key: string;
  name: string;
  color: string;
  /** Non-color channel so the two series stay separable under colour-vision deficiency. */
  dash?: string;
  points: Array<number | null>;
};

export type DensityGuide = {
  value: number;
  color: string;
  label: string;
};


/**
 * Print a threshold exactly as it is compared in code. A guide labelled "AM 0.56" over a
 * cut-off of 0.564 tells a clinician the boundary lies below a score that is in fact benign.
 */
export function formatThresholdValue(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Map a value onto a fixed domain so tracks from different windows stay comparable. */
export function densityY(
  value: number,
  domain: readonly [number, number],
  height: number
): number {
  const [min, max] = domain;
  const span = max - min;
  const ratio = span <= 0 ? 0 : (value - min) / span;
  const bounded = Math.min(Math.max(0, ratio), 1);
  return height - 4 - bounded * (height - 8);
}

/**
 * Polyline segments that break wherever a value is missing. Joining across a gap would draw
 * an invented line; substituting zero for a gap would draw an invented measurement.
 */
export function buildDensitySegments(
  points: Array<number | null>,
  columnWidth: number,
  domain: readonly [number, number],
  height: number
): string {
  if (columnWidth <= 0 || height <= 0) return "";
  const segments: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 1) segments.push(`M ${current[0]} L ${current[0]}`);
    else if (current.length > 1) segments.push(`M ${current.join(" L ")}`);
    current = [];
  };
  points.forEach((point, i) => {
    if (!isDensityPoint(point)) {
      flush();
      return;
    }
    const x = i * columnWidth + columnWidth / 2;
    current.push(`${x.toFixed(1)},${densityY(point, domain, height).toFixed(1)}`);
  });
  flush();
  return segments.join(" ");
}

export interface DensityTrackProps {
  series: DensitySeries[];
  guides?: DensityGuide[];
  columnWidth: number;
  domain: readonly [number, number];
  /** Axis identity, e.g. "Phred 0–45" — the same gutter words must never mean two axes. */
  unitLabel: string;
  modeLabel?: string;
  ariaLabel: string;
  emptyNotice?: string;
}

const TRACK_LABEL = "Profile";

export function DensityTrack({
  series,
  guides = [],
  columnWidth,
  domain,
  unitLabel,
  modeLabel,
  ariaLabel,
  emptyNotice
}: DensityTrackProps) {
  const count = series[0]?.points.length ?? 0;
  const width = count * columnWidth;
  const height = DENSITY_TRACK_HEIGHT;

  const paths = series.map((s) => buildDensitySegments(s.points, columnWidth, domain, height));
  const hasData = paths.some((d) => d.length > 0);

  if (!hasData) {
    return (
      <div className="flex items-center pl-2 mb-1" style={{ height: DENSITY_COLLAPSED_HEIGHT }}>
        <div className={`${DENSITY_GUTTER_CLASS} text-[9px]`}>
          <span className="font-semibold uppercase tracking-wider text-cs-text-secondary">
            {TRACK_LABEL}
          </span>
        </div>
        <div
          className="flex items-center rounded border border-dashed border-cs-border-subtle bg-cs-surface px-2 text-[9px] font-mono text-cs-text-muted"
          style={{ width: Math.max(width, 160), height: DENSITY_COLLAPSED_HEIGHT }}
        >
          {emptyNotice || `No ${unitLabel} values returned for this window`}
        </div>
      </div>
    );
  }

  const guideLabel = (g: DensityGuide) => (
    <text
      key={`label-${g.label}`}
      x={width - 2}
      y={densityY(g.value, domain, height) - 2.5}
      textAnchor="end"
      fontSize={9}
      className="font-mono"
      fill={g.color}
      stroke="var(--cs-surface-2)"
      strokeWidth={2.5}
      style={{ paintOrder: "stroke" }}
    >
      {g.label}
    </text>
  );

  return (
    <div className="flex items-center pl-2 mb-1">
      <div className={`${DENSITY_GUTTER_CLASS} flex flex-col justify-center`}>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-cs-text-secondary">
          {TRACK_LABEL}
        </span>
        <span className="text-[9px] font-mono normal-case tracking-normal text-cs-text-muted">
          {unitLabel}
        </span>
        {modeLabel && (
          <span className="text-[9px] font-mono normal-case tracking-normal text-cs-text-muted">
            {modeLabel}
          </span>
        )}
      </div>
      <div className="relative overflow-visible" style={{ width, height }}>
        <svg
          width={width}
          height={height}
          className="overflow-visible block"
          role="img"
          aria-label={ariaLabel}
        >
          {/* Guides under the data ... */}
          {guides.map((g) => (
            <line
              key={`guide-${g.label}`}
              x1={0}
              y1={densityY(g.value, domain, height)}
              x2={width}
              y2={densityY(g.value, domain, height)}
              stroke={g.color}
              strokeWidth={0.75}
              strokeDasharray="2 2"
              opacity={0.6}
            />
          ))}
          {series.map((s, i) =>
            paths[i] ? (
              <path
                key={s.key}
                d={paths[i]}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null
          )}
          {/* ... and their labels above it, with a halo, so no curve can occlude a threshold. */}
          {guides.map(guideLabel)}
        </svg>
      </div>
    </div>
  );
}

export interface DensityLegendProps {
  series: Array<{ key: string; name: string; color: string; dash?: string }>;
  caption?: string;
  className?: string;
}

export function DensityLegend({ series, caption, className = "" }: DensityLegendProps) {
  return (
    <div className={`flex items-center gap-3 pl-2 mb-1 text-[9px] font-mono ${className}`}>
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1 text-cs-text-secondary">
          <svg width={14} height={4} aria-hidden="true" className="shrink-0 overflow-visible">
            <line
              x1={0}
              y1={2}
              x2={14}
              y2={2}
              stroke={s.color}
              strokeWidth={1.5}
              strokeDasharray={s.dash}
              strokeLinecap="round"
            />
          </svg>
          {s.name}
        </span>
      ))}
      {caption && <span className="italic text-cs-text-muted">{caption}</span>}
    </div>
  );
}
