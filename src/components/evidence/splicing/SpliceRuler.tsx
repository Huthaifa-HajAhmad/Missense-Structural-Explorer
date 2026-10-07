import React from "react";
import type { SpliceReading } from "../../../shared/splicingEvidence";

/**
 * SpliceRuler — one splice score on its 0–1 axis.
 *
 *   bands   the Walker 2023 splicing bands (SpliceAI max Δ only): BP4 at or below 0.1, PP3 from 0.2, the
 *           band the score sits in outlined; the gap between them is left bare, because it is
 *           neither;
 *   ticks   the authors' own operating points (SpliceAI 0.5 / 0.8, dbscSNV 0.6), drawn dashed —
 *           reference lines, not strengths;
 *   marker  the variant.
 *
 * It replaced filled progress bars tinted by a local copy of the thresholds, which read a delta
 * score as "how much disruption" and painted 0.1–0.2 green although no rule calls it benign.
 */
function pct(v: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

/** Axis labels: the ends, plus — on the hero ruler — every band edge and authors' tick. */
function axisValues(scale: NonNullable<SpliceReading["scale"]>, size: "row" | "hero"): number[] {
  const values = new Set<number>([scale.min, scale.max]);
  if (size === "hero") {
    for (const b of scale.bands) {
      if (b.from > scale.min) values.add(b.from);
      if (b.to < scale.max) values.add(b.to);
    }
  }
  return [...values].sort((a, b) => a - b);
}

export function SpliceRuler({ reading, size = "row" }: { reading: SpliceReading; size?: "row" | "hero" }) {
  const { score, scale } = reading;
  if (score === null || !scale) return null;
  const { min, max } = scale;
  const active = scale.bands.find(b => b.active);
  const describe = [
    `${reading.name} ${reading.scoreText} on a ${min} to ${max} axis`,
    scale.bands.length > 0 ? (active ? `in the ${active.label.split(":")[0]} band` : "between the BP4 and PP3 bands") : null,
    size === "row" && scale.ticks.length > 0 ? scale.ticks.map(t => t.label).join(", ") : null,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <div className="spl-ruler" data-size={size} role="img" aria-label={describe}>
      <div className="spl-ruler__track">
        <span className="spl-ruler__bands">
          {scale.bands.map(b => (
            <span
              key={b.label}
              className="spl-ruler__band"
              data-side={b.side}
              data-active={b.active || undefined}
              style={{ left: `${pct(b.from, min, max)}%`, width: `${pct(b.to, min, max) - pct(b.from, min, max)}%` }}
              title={b.label}
            />
          ))}
        </span>
        {(size === "hero" ? [] : scale.ticks).map(t => (
          <span key={t.label} className="spl-ruler__tick" style={{ left: `${pct(t.value, min, max)}%` }} title={t.label} />
        ))}
        <span
          className="spl-ruler__marker"
          data-off-scale={score < min || score > max || undefined}
          style={{ left: `${pct(score, min, max)}%` }}
        />
      </div>
      <div className="spl-ruler__axis" aria-hidden="true">
        {axisValues(scale, size).map(v => (
          <span key={v} style={{ left: `${pct(v, min, max)}%` }} data-edge={v === min ? "start" : v === max ? "end" : undefined}>
            {v === min || v === max ? String(v) : v.toFixed(1)}
          </span>
        ))}
      </div>
      {size === "hero" && scale.bands.length > 0 && <div className="spl-ruler__labels" aria-hidden="true">
        <span>{scale.bands[0].label}</span>
        <span>Neither: {scale.bands[0].to}–&lt;{scale.bands[1].from}</span>
        <span>{scale.bands[1].label}</span>
      </div>}
    </div>
  );
}
