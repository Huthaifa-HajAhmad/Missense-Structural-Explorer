import React from "react";
import { RANK_BANDS, type RankBand } from "../../../shared/modelCalibration";

/**
 * The two axes this tab draws. Neither carries a published cut-point — every band and tick here is
 * app-defined — so neither is red or green, and every tick is dashed.
 *
 * They replaced a filled 0–100 "consensus" bar and cards tinted green/amber/red against local
 * numbers (RMSD 0.8/1.5 Å, VdW 2.0, ESM3 0.08/0.22/0.38) that looked like findings.
 */

function pct(value: number, min: number, max: number) {
  const span = max - min;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - min) / span) * 100));
}

/**
 * The variant's within-model rank on 1 (the model's top residue) … 20, with the native residue's rank
 * drawn beside it as a hollow ring. Without the native, "rank 3" read as "preferred" even where the
 * native held ~99% of the probability (SLC12A4 p.Gln867His, ESMC).
 */
export function RankRuler({
  rank,
  band,
  label,
  nativeRank = null,
  flat = false
}: {
  rank: number;
  band: RankBand | null;
  label: string;
  nativeRank?: number | null;
  flat?: boolean;
}) {
  // Rank r occupies the cell [r-1, r] of a 0–20 axis, so 1 and 20 sit inside the track.
  const cell = (r: number) => ((r - 0.5) / 20) * 100;
  return (
    <div
      className="ptb-ruler"
      data-flat={flat || undefined}
      role="img"
      aria-label={`${label}: variant rank ${rank} of 20${nativeRank !== null ? `, native rank ${nativeRank}` : ""}${flat ? "; the distribution is near-flat, so the rank is not read" : ""}; app-defined bands`}
    >
      <div className="ptb-ruler__track">
        <span className="ptb-ruler__bands">
          {RANK_BANDS.map(b => (
            <span
              key={b.band}
              className="ptb-ruler__band"
              data-band={b.band}
              data-active={(!flat && b.band === band) || undefined}
              style={{ left: `${((b.from - 1) / 20) * 100}%`, width: `${((b.to - b.from + 1) / 20) * 100}%` }}
              title={`${b.label}: rank ${b.from}–${b.to}`}
            />
          ))}
        </span>
        {nativeRank !== null && nativeRank !== rank && (
          <span className="ptb-ruler__native" style={{ left: `${cell(nativeRank)}%` }} />
        )}
        <span className="ptb-ruler__marker" data-role="variant" style={{ left: `${cell(rank)}%` }} />
      </div>
      <div className="ptb-ruler__axis" aria-hidden="true">
        <span>1 · model&apos;s top residue</span>
        <span>20</span>
      </div>
    </div>
  );
}

/** One value on its own axis, with app-defined reading marks drawn dashed. */
export function MarkRuler({
  value,
  min,
  max,
  marks,
  label,
  format = (n: number) => n.toString()
}: {
  value: number;
  min: number;
  max: number;
  marks: { value: number; label: string }[];
  label: string;
  format?: (n: number) => string;
}) {
  const off = value < min || value > max;
  return (
    <div
      className="ptb-ruler"
      role="img"
      aria-label={`${label} ${format(value)} on a ${format(min)} to ${format(max)} axis${marks.length ? `; marked: ${marks.map(m => `${m.label} (${format(m.value)})`).join(", ")}` : ""}`}
    >
      <div className="ptb-ruler__track">
        {marks.map(m => (
          <span key={m.value} className="ptb-ruler__tick" style={{ left: `${pct(m.value, min, max)}%` }} title={m.label} />
        ))}
        <span className="ptb-ruler__marker" data-role="variant" data-off-scale={off || undefined} style={{ left: `${pct(value, min, max)}%` }} />
      </div>
      <div className="ptb-ruler__axis" aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
