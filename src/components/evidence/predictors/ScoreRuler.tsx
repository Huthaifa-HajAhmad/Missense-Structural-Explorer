import React from "react";
import type { PredictorReading } from "../../../shared/predictorEvidence";
import { formatEvidenceCode } from "../../../shared/thresholds";

/**
 * ScoreRuler — one tool's score on its own axis, with its cut-points drawn by provenance.
 *
 *   calibrated  the ClinGen bands, each strength a deeper tint, the band the score sits in outlined;
 *   authors     the authors' cut-point(s) as ticks, no bands (they are not strengths);
 *   local       ticks drawn DASHED — a local reference line, not a published cut-point;
 *   none        a bare axis and the score.
 *
 * The old cards drew every tool on a filled progress bar tinted red or green, which read as "how
 * pathogenic" for scores that are not probabilities, and whose tint came from a second, local copy
 * of each tool's thresholds (the popEVE bar passed its two cut-points swapped and painted a
 * "Deleterious" score green). This draws only what the model hands it.
 */

function pct(value: number, min: number, max: number) {
  const span = max - min;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - min) / span) * 100));
}

function fmtTick(n: number) {
  return Math.abs(n) >= 10 ? n.toFixed(1) : Number(n.toFixed(3)).toString();
}

export function ScoreRuler({ reading }: { reading: PredictorReading }) {
  const { score, scale, orientation, cutpoints } = reading;
  const { min, max } = scale;
  const high = orientation === "higher";

  const bands = cutpoints.bands.map(b => {
    // PP3 bands run toward the pathogenic end; BP4 toward the benign end.
    const towardHigh = (b.direction === "PP3") === high;
    const from = towardHigh ? b.threshold : (b.until ?? min);
    const to = towardHigh ? (b.until ?? max) : b.threshold;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const active =
      score !== null &&
      reading.calibrated?.code === b.code;
    return { ...b, left: pct(lo, min, max), width: pct(hi, min, max) - pct(lo, min, max), active };
  });

  const offScale = score !== null && (score < min || score > max);
  const markerPct = score !== null ? pct(score, min, max) : null;

  const describe = [
    `${reading.name} ${reading.scoreText}${reading.unit ? ` ${reading.unit}` : ""} on a ${fmtTick(min)} to ${fmtTick(max)} axis`,
    cutpoints.kind === "calibrated" && reading.calibrated
      ? reading.calibrated.direction
        ? `in the ${formatEvidenceCode(reading.calibrated.code)} band`
        : "between the PP3 and BP4 bands"
      : null,
    cutpoints.kind === "authors" ? `authors' cut-point ${cutpoints.marks.map(m => m.label).join(", ")}` : null,
    cutpoints.kind === "local" ? "local reference lines only" : null,
    cutpoints.kind === "none" ? "no published cut-point" : null,
  ].filter(Boolean).join("; ");

  return (
    <div className="prd-ruler" role="img" aria-label={describe} data-kind={cutpoints.kind}>
      <div className="prd-ruler__track">
        <span className="prd-ruler__bands">
        {bands.map(b => (
          <span
            key={b.code}
            className="prd-ruler__band"
            data-side={b.direction === "PP3" ? "path" : "benign"}
            data-strength={b.strength}
            data-active={b.active || undefined}
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
            title={`${formatEvidenceCode(b.code)}: ${b.direction === "PP3" ? (high ? "≥" : "≤") : high ? "≤" : "≥"} ${fmtTick(b.threshold)}`}
          />
        ))}
        </span>
        {cutpoints.marks.map(m => (
          <span
            key={`${m.value}-${m.label}`}
            className="prd-ruler__tick"
            data-side={m.side}
            style={{ left: `${pct(m.value, min, max)}%` }}
            title={m.label}
          />
        ))}
        {markerPct !== null && (
          <span
            className="prd-ruler__marker"
            data-off-scale={offScale || undefined}
            style={{ left: `${markerPct}%` }}
          />
        )}
      </div>
      <div className="prd-ruler__axis" aria-hidden="true">
        <span>{fmtTick(min)}</span>
        <span>{fmtTick(max)}</span>
      </div>
    </div>
  );
}
