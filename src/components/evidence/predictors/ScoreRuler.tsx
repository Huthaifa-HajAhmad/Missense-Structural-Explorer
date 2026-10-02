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

/** Axis ends are round numbers: "50", not "50.0" beside a "0". */
function fmtAxis(n: number) {
  return Number.isInteger(n) ? String(n) : fmtTick(n);
}

const STRENGTH_PRIORITY: Record<string, number> = { Supporting: 0, Moderate: 1, Strong: 2, VeryStrong: 3 };
/** Width of one mono digit as a share of the track; generous so labels never touch on a narrow column. */
const CHAR_PCT = 1.3;
const MAX_LANES = 3;

/**
 * The band edges as numbers, placed under the track. `entry` labels only where PP3 and BP4 begin;
 * `all` labels every strength edge. Labels that would overlap drop to a second or third lane rather
 * than disappearing, and the axis ends take a lane-0 slot so "0" never collides with "0.016".
 * Priority is Supporting first, so the edges a reader needs are the ones that always survive.
 */
function thresholdLabels(
  bands: Array<{ threshold: number; strength: string; direction: string; code: string }>,
  min: number,
  max: number,
  mode: "entry" | "all",
) {
  const wanted = bands
    .filter(b => mode === "all" || b.strength === "Supporting")
    .sort((a, b) => (STRENGTH_PRIORITY[a.strength] ?? 9) - (STRENGTH_PRIORITY[b.strength] ?? 9));
  const spans: Array<Array<[number, number]>> = Array.from({ length: MAX_LANES }, () => []);
  const claim = (lane: number, from: number, to: number) => {
    if (spans[lane].some(([a, b]) => from < b && to > a)) return false;
    spans[lane].push([from, to]);
    return true;
  };
  // The axis ends hold lane 0.
  claim(0, 0, fmtAxis(min).length * CHAR_PCT + 0.6);
  claim(0, 100 - fmtAxis(max).length * CHAR_PCT - 0.6, 100);
  const placed: Array<{ key: string; text: string; left: number; lane: number; side: "path" | "benign" }> = [];
  for (const b of wanted) {
    const left = pct(b.threshold, min, max);
    const text = fmtTick(b.threshold);
    const w = text.length * CHAR_PCT;
    const from = Math.max(0, left - w / 2);
    const to = Math.min(100, left + w / 2);
    for (let lane = 0; lane < MAX_LANES; lane++) {
      if (claim(lane, from - 0.4, to + 0.4)) {
        placed.push({ key: b.code, text, left, lane, side: b.direction === "PP3" ? "path" : "benign" });
        break;
      }
    }
  }
  return { placed, lanes: Math.max(1, ...placed.map(p => p.lane + 1)) };
}

export function ScoreRuler({ reading, thresholds }: { reading: PredictorReading; thresholds?: "entry" | "all" }) {
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

  const labels =
    thresholds && cutpoints.kind === "calibrated" && cutpoints.bands.length > 0
      ? thresholdLabels(cutpoints.bands, min, max, thresholds)
      : null;
  const offScale = score !== null && (score < min || score > max);
  const markerPct = score !== null ? pct(score, min, max) : null;

  const describe = [
    `${reading.name} ${reading.scoreText}${reading.unit ? ` ${reading.unit}` : ""} on a ${fmtTick(min)} to ${fmtTick(max)} axis`,
    cutpoints.kind === "calibrated" && reading.calibrated
      ? reading.calibrated.direction
        ? `in the ${formatEvidenceCode(reading.calibrated.code)} band`
        : "between the PP3 and BP4 bands"
      : null,
    labels
      ? `band edges ${cutpoints.bands.map(b => `${formatEvidenceCode(b.code)} ${b.direction === "PP3" ? (high ? "≥" : "≤") : high ? "≤" : "≥"} ${fmtTick(b.threshold)}`).join(", ")}`
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
      <div className="prd-ruler__axis" aria-hidden="true" data-lanes={labels?.lanes}>
        <span>{fmtAxis(min)}</span>
        <span>{fmtAxis(max)}</span>
        {labels?.placed.map(l => (
          <span
            key={l.key}
            className="prd-ruler__cut"
            data-side={l.side}
            style={{ left: `${l.left}%`, top: `${l.lane * 12}px` }}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}
