import React from "react";
import type { PredictorReading } from "../../../shared/predictorEvidence";
import { formatEvidenceCode } from "../../../shared/thresholds";
import { edgeFormatter, fmtTick } from "../../../shared/edgeFormat";

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

/** Axis ends are round numbers: "50", not "50.0" beside a "0". */
function fmtAxis(n: number) {
  return Number.isInteger(n) ? String(n) : fmtTick(n);
}

/** Width of one mono digit as a share of the track; generous so labels never touch on a narrow column. */
const CHAR_PCT = 1.3;
/** Space kept between two labels, as a share of the track. */
const GAP_PCT = 0.8;

type Band = { threshold: number; strength: string; direction: string; code: string };
type Edge = Band & { at: number };

/** Edges closer together than one label's width share one label, in value order ("0.003 · 0.016"). */
function groupEdges(edges: Edge[], format: (n: number) => string) {
  const groups: Edge[][] = [];
  for (const e of edges) {
    const last = groups.at(-1);
    if (last && e.at - last[last.length - 1].at < format(e.threshold).length * CHAR_PCT) last.push(e);
    else groups.push([e]);
  }
  return groups;
}

/**
 * Lays the labels out in one row: each centred under its edge(s), then pushed right just enough to
 * clear the label before it, then pulled back left from the far end if the row ran past it. The axis
 * end numbers keep their places, so "0" and "1" are never covered. Each edge keeps its own tick at
 * its true place, so a label moved a little still points at the right edge.
 */
function placeLabels(groups: Edge[][], format: (n: number) => string, lo: number, hi: number) {
  const placed = groups.map(g => {
    const text = g.map(e => format(e.threshold)).join(" · ");
    const width = text.length * CHAR_PCT;
    const centre = (g[0].at + g[g.length - 1].at) / 2;
    return { key: g[0].code, text, width, from: centre - width / 2, side: g[0].direction === "PP3" ? "path" as const : "benign" as const };
  });
  placed.forEach((p, i) => { p.from = Math.max(p.from, lo, i > 0 ? placed[i - 1].from + placed[i - 1].width + GAP_PCT : lo); });
  for (let i = placed.length - 1; i >= 0; i--) {
    const limit = i < placed.length - 1 ? placed[i + 1].from - GAP_PCT : hi;
    placed[i].from = Math.min(placed[i].from, limit - placed[i].width);
  }
  return placed;
}

/**
 * The band edges as numbers under the track. `entry` labels only where PP3 and BP4 begin; `all`
 * labels every strength edge.
 */
function thresholdLabels(bands: Band[], min: number, max: number, mode: "entry" | "all", format: (n: number) => string) {
  const edges = bands
    .filter(b => mode === "all" || b.strength === "Supporting")
    .map(b => ({ ...b, at: pct(b.threshold, min, max) }))
    .sort((a, b) => a.at - b.at);
  const lo = fmtAxis(min).length * CHAR_PCT + GAP_PCT;
  const hi = 100 - fmtAxis(max).length * CHAR_PCT - GAP_PCT;
  return { edges, placed: placeLabels(groupEdges(edges, format), format, lo, hi) };
}

export function ScoreRuler({ reading, thresholds }: { reading: PredictorReading; thresholds?: "entry" | "all" }) {
  const { score, scoreRange, scale, orientation, cutpoints } = reading;
  const { min, max } = scale;
  const high = orientation === "higher";
  const isAvailable = score !== null || reading.availability.state === "available";

  const bands = cutpoints.bands.map(b => {
    // PP3 bands run toward the pathogenic end; BP4 toward the benign end.
    const towardHigh = (b.direction === "PP3") === high;
    const from = towardHigh ? b.threshold : (b.until ?? min);
    const to = towardHigh ? (b.until ?? max) : b.threshold;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const active =
      isAvailable &&
      reading.calibrated?.code === b.code;
    return { ...b, left: pct(lo, min, max), width: pct(hi, min, max) - pct(lo, min, max), active };
  });

  const fmtEdge = edgeFormatter(cutpoints.bands.map(b => b.threshold));
  const labels =
    thresholds && cutpoints.kind === "calibrated" && cutpoints.bands.length > 0
      ? thresholdLabels(cutpoints.bands, min, max, thresholds, fmtEdge)
      : null;
  const markerValues =
    score !== null ? [score]
      : scoreRange ? (scoreRange[0] === scoreRange[1] ? [scoreRange[0]] : [scoreRange[0], scoreRange[1]])
      : [];
  const rangeLeft = score === null && scoreRange && scoreRange[0] < scoreRange[1] ? pct(scoreRange[0], min, max) : null;
  const rangeRight = score === null && scoreRange && scoreRange[0] < scoreRange[1] ? pct(scoreRange[1], min, max) : null;

  const describe = [
    `${reading.name} ${reading.scoreText}${reading.unit ? ` ${reading.unit}` : ""} on a ${fmtTick(min)} to ${fmtTick(max)} axis`,
    cutpoints.kind === "calibrated" && reading.calibrated
      ? reading.calibrated.direction
        ? `in the ${formatEvidenceCode(reading.calibrated.code)} band`
        : "between the PP3 and BP4 bands"
      : null,
    labels
      ? `band edges ${cutpoints.bands.map(b => `${formatEvidenceCode(b.code)} ${b.direction === "PP3" ? (high ? "≥" : "≤") : high ? "≤" : "≥"} ${fmtEdge(b.threshold)}`).join(", ")}`
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
            title={`${formatEvidenceCode(b.code)}: ${b.direction === "PP3" ? (high ? "≥" : "≤") : high ? "≤" : "≥"} ${fmtEdge(b.threshold)}`}
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
        {rangeLeft !== null && rangeRight !== null && (
          <span
            className="prd-ruler__range"
            style={{ left: `${rangeLeft}%`, width: `${Math.max(0, rangeRight - rangeLeft)}%` }}
          />
        )}
        {markerValues.map((v, i) => (
          <span
            key={`${i}-${v}`}
            className="prd-ruler__marker"
            data-off-scale={v < min || v > max || undefined}
            style={{ left: `${pct(v, min, max)}%` }}
          />
        ))}
      </div>
      <div className="prd-ruler__axis" aria-hidden="true">
        <span>{fmtAxis(min)}</span>
        <span>{fmtAxis(max)}</span>
        {labels?.edges.map(e => (
          <span key={e.code} className="prd-ruler__edge" data-side={e.direction === "PP3" ? "path" : "benign"} style={{ left: `${e.at}%` }} />
        ))}
        {labels?.placed.map(l => (
          <span key={l.key} className="prd-ruler__cut" data-side={l.side} style={{ left: `${l.from}%` }}>
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}
