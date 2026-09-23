import React, { useMemo } from "react";
import { Info } from "lucide-react";
import {
  deriveBurialEvidence,
  type BurialIndicator
} from "../../shared/burialEvidence";

/**
 * The residue's local environment: burial/exposure and packing density.
 *
 * Why this replaced the two KPI boxes
 * -----------------------------------
 * The previous pair of boxes printed a word ("BOUNDARY"), a count ("14 neighbors"),
 * and a prose legend defining bands the *badge had not been computed with* — the SASA
 * engine used 5%/25% RSA while the copy said 15%/35%. Neither box said which of the two
 * measurements the word came from, so on the common run where the SASA step does not
 * execute, a packing estimate was presented with the authority of a measured accessible
 * surface.
 *
 * This panel states the word once, shows both indicators with the bands drawn on their
 * own scales, and names which indicator decided the word. When the two disagree, that is
 * reported rather than silently resolved — they measure different things.
 *
 * Every threshold and band word comes from `src/shared/burialEvidence.ts`, which the
 * server's classification and `tools/sasa_eval.py` also use.
 */

export interface ResidueEnvironmentPanelProps {
  burialStatus?: string | null;
  neighbourCount?: number | null;
  /** Relative solvent accessibility as a fraction (0.12 = 12%). */
  rsa?: number | null;
  /** Opens the metric-explanation modal for one of the two indicators. */
  onExplainMetric: (metric: "burial_status" | "contact_density") => void;
}

const METRIC_FOR_INDICATOR: Record<BurialIndicator["key"], "burial_status" | "contact_density"> = {
  rsa: "burial_status",
  packing: "contact_density"
};

const INDICATOR_TITLE: Record<BurialIndicator["key"], string> = {
  rsa: "Solvent Exposure",
  packing: "Packing Density"
};

/**
 * A filled track with the band thresholds marked.
 *
 * The graphical track is hidden from assistive technology: the value, its band word and
 * the thresholds are all rendered as text in the same row, so the meter adds nothing a
 * screen reader would otherwise miss.
 */
function IndicatorMeter({ indicator }: { indicator: BurialIndicator }) {
  const { marker, domainMax, ticks } = indicator;
  const clamped = marker === null ? null : Math.max(0, Math.min(domainMax, marker));

  return (
    <div
      className="relative h-2.5 rounded-full border overflow-hidden bg-cs-bg-subtle border-cs-border-subtle"
      aria-hidden="true"
    >
      {ticks.map(tick => (
        <span
          key={tick.label}
          className="absolute top-0 bottom-0 w-px bg-cs-border"
          style={{ left: `${(tick.value / domainMax) * 100}%`, opacity: 0.7 }}
        />
      ))}
      {clamped !== null && (
        <span
          className={`absolute top-0 bottom-0 left-0 ${
            indicator.isBasis ? "bg-cs-accent-clay/50" : "bg-cs-text-muted/25"
          }`}
          style={{ width: `${(clamped / domainMax) * 100}%` }}
        />
      )}
    </div>
  );
}

function IndicatorCard({
  indicator,
  onExplain
}: {
  indicator: BurialIndicator;
  onExplain: () => void;
}) {
  const bandLabel = indicator.band ? indicator.band.toUpperCase() : "NOT MEASURED";

  return (
    <button
      type="button"
      onClick={onExplain}
      title={`${indicator.detail} Open the metric explanation.`}
      className={`p-3 rounded-lg border text-left flex flex-col gap-2 hover:border-[var(--cs-accent-clay)]/50 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] w-full ${
        indicator.isBasis ? "border-cs-border" : "border-cs-border-subtle"
      }`}
      style={{ background: "var(--cs-surface-2)" }}
    >
      <div className="flex items-center justify-between gap-2 w-full">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] uppercase font-bold tracking-wider truncate" style={{ color: "var(--cs-text-secondary)" }}>
            {INDICATOR_TITLE[indicator.key]}
          </span>
          <Info className="w-3 h-3 text-slate-400 shrink-0" />
        </span>
        {indicator.isBasis && (
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-cs-accent-clay/25 bg-cs-accent-clay/10 text-cs-accent-clay shrink-0">
            decides status
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2 w-full">
        <span className="text-xl font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>
          {indicator.valueLabel ?? "\u2014"}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color: "var(--cs-text-muted)" }}>
          {bandLabel}
        </span>
      </div>

      <IndicatorMeter indicator={indicator} />

      <div className="flex items-start justify-between gap-2 w-full">
        <span className="text-[10.5px] leading-snug" style={{ color: "var(--cs-text-secondary)" }}>
          {indicator.label}
        </span>
        <span className="text-[9.5px] font-mono shrink-0" style={{ color: "var(--cs-text-muted)" }}>
          {indicator.ticks.map(tick => tick.label).join(" / ")}
        </span>
      </div>

      {!indicator.isBasis && indicator.valueLabel !== null && (
        <span className="text-[9.5px] leading-snug" style={{ color: "var(--cs-text-muted)" }}>
          {indicator.detail}
        </span>
      )}
    </button>
  );
}

export function ResidueEnvironmentPanel({
  burialStatus,
  neighbourCount,
  rsa,
  onExplainMetric
}: ResidueEnvironmentPanelProps) {
  const evidence = useMemo(
    () => deriveBurialEvidence({ burialStatus, neighbourCount, rsa }),
    [burialStatus, neighbourCount, rsa]
  );

  const { indicators } = evidence;

  return (
    <div className="p-4 rounded-lg border space-y-3.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>
            Residue Environment
          </span>
          <p className="text-[10.5px] mt-1 leading-snug" style={{ color: "var(--cs-text-muted)" }}>
            Burial and packing of the wild-type position in the modelled structure. The two indicators
            below measure different things, and the one that decided the status is marked.
          </p>
        </div>
        <span className="badge-data-source shrink-0">{evidence.basisLabel}</span>
      </div>

      <div className="p-3 rounded-lg border space-y-1.5" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
        <div className="flex items-center gap-2">
          <span className="badge-metric-neutral text-[11px] font-black uppercase px-2 py-0.5 rounded border">
            {evidence.label}
          </span>
          <span className="text-[10px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
            {evidence.basisDetail}
          </span>
        </div>
        <p className="text-[12px] leading-relaxed font-sans" style={{ color: "var(--cs-text-secondary)" }}>
          {evidence.detail}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IndicatorCard indicator={indicators.rsa} onExplain={() => onExplainMetric(METRIC_FOR_INDICATOR.rsa)} />
        <IndicatorCard indicator={indicators.packing} onExplain={() => onExplainMetric(METRIC_FOR_INDICATOR.packing)} />
      </div>

      {evidence.disagreement ? (
        <div className="p-3 rounded-lg border text-[10.5px] leading-relaxed border-amber-500/25 bg-cs-bg-warning space-y-1">
          <span className="block font-bold text-[10.5px]" style={{ color: "var(--cs-text-primary)" }}>
            Burial and packing indicators disagree
          </span>
          <p style={{ color: "var(--cs-text-secondary)" }}>{evidence.disagreement}</p>
        </div>
      ) : evidence.caveat ? (
        <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
          {evidence.caveat}
        </p>
      ) : null}
    </div>
  );
}

export default React.memo(ResidueEnvironmentPanel);
