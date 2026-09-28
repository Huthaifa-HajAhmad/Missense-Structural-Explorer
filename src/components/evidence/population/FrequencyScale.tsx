import React from "react";
import { THRESHOLDS } from "../../../shared/thresholds";
import { formatAlleleFrequency, type FrequencyCriterion } from "../../../shared/frequencyEvidence";

/**
 * FrequencyScale — where this variant's frequency sits against the ACMG cut-points.
 *
 * A log-scale ruler, because the cut-points span four orders of magnitude (PM2 at 0.01% to BA1 at 5%)
 * and a linear axis would put every rare-disease reading on the left pixel. The zones are drawn FROM
 * `THRESHOLDS.populationFrequency` — the constant the engine branches on — so the picture cannot show
 * a boundary the rule does not use.
 *
 * Encodings:
 *   • zone fill — which criterion that band supports; the band the reading falls in is emphasised
 *     and every zone carries its code as text, so identity is never colour alone;
 *   • filled marker + pill — the frequency the rule read;
 *   • hollow dots — each source's own reading, for tracing the rule input back to a dataset;
 *   • dashed tick — the PM2 ceiling for the OTHER inheritance reading, so a reader can see how much
 *     the pLI-based inheritance guess moved the boundary.
 *
 * A recorded absence has no position on a log axis. It is drawn as an open marker pinned to the left
 * edge with a leftward arrow ("below detection"), never as a dot at some invented tiny frequency.
 */

const MIN_EXP = -7; // 1e-7 — below the reciprocal of gnomAD v4's largest allele number (~1.6M)
const MAX_EXP = 0;

function position(af: number): number {
  if (af <= 0) return 0;
  const exp = Math.log10(af);
  return Math.min(1, Math.max(0, (exp - MIN_EXP) / (MAX_EXP - MIN_EXP))) * 100;
}

/** Axis labels as percentages, the unit the ACMG criteria are written in. */
const TICKS: ReadonlyArray<{ af: number; label: string; minor?: boolean }> = [
  { af: 1e-6, label: "0.0001%", minor: true },
  { af: 1e-5, label: "0.001%", minor: true },
  { af: 1e-4, label: "0.01%" },
  { af: 1e-3, label: "0.1%" },
  { af: 1e-2, label: "1%" },
  { af: 5e-2, label: "5%" },
  { af: 1, label: "100%" },
];

export interface ScaleReading {
  key: string;
  label: string;
  af: number;
}

interface FrequencyScaleProps {
  criterion: FrequencyCriterion;
  /** Per-source readings with a positive frequency. */
  readings: ReadonlyArray<ScaleReading>;
}

type ZoneId = "PM2" | "none" | "BS1" | "BA1";

export function FrequencyScale({ criterion, readings }: FrequencyScaleProps) {
  const FREQ = THRESHOLDS.populationFrequency;
  const ceiling = criterion.pm2Ceiling ?? FREQ.extremelyRare;
  const otherCeiling = ceiling === FREQ.extremelyRare ? FREQ.extremelyRareRecessive : FREQ.extremelyRare;
  const otherReading = ceiling === FREQ.extremelyRare ? "recessive" : "dominant";

  const zones: ReadonlyArray<{ id: ZoneId; from: number; to: number; label: string; tone: string }> = [
    { id: "PM2", from: 0, to: position(ceiling), label: "PM2", tone: "danger" },
    { id: "none", from: position(ceiling), to: position(FREQ.tooCommonForDisorder), label: "No criterion", tone: "neutral" },
    { id: "BS1", from: position(FREQ.tooCommonForDisorder), to: position(FREQ.standAloneBenign), label: "BS1", tone: "good" },
    { id: "BA1", from: position(FREQ.standAloneBenign), to: 100, label: "BA1", tone: "good-strong" },
  ];

  const af = criterion.af;
  const activeZone: ZoneId | null =
    af === null ? null
    : criterion.code === "PM2" ? "PM2"
    : criterion.code === "BS1" ? "BS1"
    : criterion.code === "BA1" ? "BA1"
    : criterion.code === "none" ? "none"
    : null;

  const markerAt = af === null ? null : position(af);
  const markerText = af === null ? null : criterion.absent ? "Not observed" : formatAlleleFrequency(af);
  const align = markerAt === null ? "center" : markerAt < 12 ? "start" : markerAt > 88 ? "end" : "center";

  const ariaLabel =
    af === null
      ? "Frequency scale: no frequency was read, so the reading is not placed against the ACMG cut-points."
      : criterion.absent
        ? `Frequency scale: not observed in gnomAD, which falls in the PM2 zone at or below ${formatAlleleFrequency(ceiling)}.`
        : `Frequency scale: the rule read ${formatAlleleFrequency(af)}, in the ${activeZone === "none" ? "no-criterion" : activeZone} zone.`;

  return (
    <figure className="pop-scale" role="img" aria-label={ariaLabel} data-testid="frequency-scale">
      {/* Marker lane: the pill naming the value the rule read. */}
      <div className="pop-scale__lane pop-scale__lane--marker" aria-hidden="true">
        {markerAt !== null && (
          <span
            className="pop-scale__pill"
            data-align={align}
            data-absent={criterion.absent || undefined}
            style={{ left: `${markerAt}%` }}
          >
            {criterion.absent && <span className="pop-scale__arrow">←</span>}
            {markerText}
          </span>
        )}
      </div>

      <div className="pop-scale__track" aria-hidden="true">
        {zones.map(zone => (
          <span
            key={zone.id}
            className="pop-scale__zone"
            data-tone={zone.tone}
            data-active={activeZone === zone.id || undefined}
            style={{ left: `${zone.from}%`, width: `${zone.to - zone.from}%` }}
          >
            <span className="pop-scale__zone-label">{zone.label}</span>
          </span>
        ))}
        <span
          className="pop-scale__alt-ceiling"
          style={{ left: `${position(otherCeiling)}%` }}
          title={`PM2 ceiling if the gene read as ${otherReading}: ${formatAlleleFrequency(otherCeiling)}`}
        />
        {markerAt !== null && (
          <span
            className="pop-scale__marker"
            data-absent={criterion.absent || undefined}
            style={{ left: `${markerAt}%` }}
          />
        )}
      </div>

      {/* Source lane: each dataset's own reading, focusable so the value is reachable by keyboard. */}
      {readings.length > 0 && (
        <div className="pop-scale__lane pop-scale__lane--sources">
          {readings.map(r => (
            <span
              key={r.key}
              className="pop-scale__dot"
              style={{ left: `${position(r.af)}%` }}
              tabIndex={0}
              role="note"
              aria-label={`${r.label}: ${formatAlleleFrequency(r.af)}`}
              title={`${r.label} · ${formatAlleleFrequency(r.af)}`}
            />
          ))}
        </div>
      )}

      <div className="pop-scale__axis" aria-hidden="true">
        {TICKS.map(t => (
          <span
            key={t.label}
            className="pop-scale__tick"
            data-minor={t.minor || undefined}
            data-edge={t.af === 1 ? "end" : undefined}
            style={{ left: `${position(t.af)}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>

      <figcaption className="pop-scale__legend">
        <span><i className="pop-key pop-key--marker" /> Rule input</span>
        {readings.length > 0 && <span><i className="pop-key pop-key--dot" /> Source reading</span>}
        <span><i className="pop-key pop-key--alt" /> PM2 ceiling if {otherReading}</span>
        <span className="pop-scale__legend-note">Log scale · allele frequency</span>
      </figcaption>
    </figure>
  );
}

export default FrequencyScale;
