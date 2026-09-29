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

/** The mutant's within-model rank on 1 (most preferred) … 20 (least), bands by preference. */
export function RankRuler({ rank, band, label }: { rank: number; band: RankBand | null; label: string }) {
  // Rank r occupies the cell [r-1, r] of a 0–20 axis, so 1 and 20 sit inside the track.
  const cell = (r: number) => ((r - 0.5) / 20) * 100;
  return (
    <div
      className="ptb-ruler"
      role="img"
      aria-label={`${label}: rank ${rank} of 20, ${band ? RANK_BANDS.find(b => b.band === band)!.label.toLowerCase() : "no band"}; app-defined bands`}
    >
      <div className="ptb-ruler__track">
        <span className="ptb-ruler__bands">
          {RANK_BANDS.map(b => (
            <span
              key={b.band}
              className="ptb-ruler__band"
              data-band={b.band}
              data-active={b.band === band || undefined}
              style={{ left: `${((b.from - 1) / 20) * 100}%`, width: `${((b.to - b.from + 1) / 20) * 100}%` }}
              title={`${b.label}: rank ${b.from}–${b.to}`}
            />
          ))}
        </span>
        <span className="ptb-ruler__marker" style={{ left: `${cell(rank)}%` }} />
      </div>
      <div className="ptb-ruler__axis" aria-hidden="true">
        <span>1 · most preferred</span>
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
      aria-label={`${label} ${format(value)} on a ${format(min)} to ${format(max)} axis; ${marks.length ? `local reading marks at ${marks.map(m => format(m.value)).join(", ")}` : "no reading marks"}`}
    >
      <div className="ptb-ruler__track">
        {marks.map(m => (
          <span key={m.value} className="ptb-ruler__tick" style={{ left: `${pct(m.value, min, max)}%` }} title={m.label} />
        ))}
        <span className="ptb-ruler__marker" data-off-scale={off || undefined} style={{ left: `${pct(value, min, max)}%` }} />
      </div>
      <div className="ptb-ruler__axis" aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
