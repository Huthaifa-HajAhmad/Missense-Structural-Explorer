import React from "react";
import { ArrowRight, Cpu, Gauge, ShieldAlert } from "lucide-react";
import type { AnalysisResult, EnergeticsData } from "../../types";
import {
  buildGuidelinesRows,
  guidelinesFinding,
  summarizeGuidelinesRows,
  type GuidelinesRow,
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

export interface GuidelinesRailProps {
  analysisResult: AnalysisResult;
  foldingDdG: number | null;
  foldingEnergetics?: EnergeticsData | null;
  onSelectEvidenceTab?: (tab: string) => void;
}

const GROUP_TINTS: Record<string, { bg: string; fg: string; border: string }> = {
  path: {
    bg: "var(--cs-bg-danger)",
    fg: "var(--cs-text-danger-on-soft)",
    border: "color-mix(in srgb, var(--cs-text-danger) 25%, transparent)",
  },
  benign: {
    bg: "var(--cs-bg-success)",
    fg: "var(--cs-text-good-on-soft)",
    border: "color-mix(in srgb, var(--cs-text-success) 25%, transparent)",
  },
  vus: {
    bg: "var(--cs-bg-warning)",
    fg: "var(--cs-text-warning-on-soft)",
    border: "color-mix(in srgb, var(--cs-text-warning) 30%, transparent)",
  },
  info: {
    bg: "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)",
    fg: "var(--cs-accent-clay)",
    border: "color-mix(in srgb, var(--cs-accent-clay) 25%, transparent)",
  },
  nodata: {
    bg: "var(--cs-surface)",
    fg: "var(--cs-text-muted)",
    border: "var(--cs-border)",
  },
};

export function GuidelinesRail({
  analysisResult,
  foldingDdG,
  foldingEnergetics,
  onSelectEvidenceTab,
}: GuidelinesRailProps) {
  const rows = buildGuidelinesRows({
    result: analysisResult,
    foldingDdG,
    foldingEnergetics,
  });
  const summary = summarizeGuidelinesRows(rows);
  const finding = guidelinesFinding(summary);

  const revelRow = rows.find(r => r.key === "revel");
  const foldxRow = rows.find(r => r.key === "foldx");

  const conservationData = analysisResult.conservationData;
  const revel = conservationData?.revel ?? null;
  const ddG = foldingDdG;

  const nPath = summary.pathSupporting.length;
  const nBenign = summary.benignSupporting.length;
  const nScored = summary.total - summary.noData.length;

  const statusTone: "neutral" | "danger" | "warning" | "good" =
    nScored === 0
      ? "neutral"
      : nPath > nBenign
      ? "danger"
      : nBenign > nPath
      ? "good"
      : nPath > 0 || nBenign > 0
      ? "warning"
      : "neutral";

  const statusText =
    nScored === 0
      ? "Awaiting Data"
      : nPath > nBenign
      ? "Pathogenic Concordance"
      : nBenign > nPath
      ? "Benign / Neutral"
      : nPath > 0 || nBenign > 0
      ? "Conflicting Signals"
      : "Indeterminate";

  const statusDesc = finding.predicate;

  const groupCount = (g: "path" | "benign" | "vus" | "info" | "nodata") =>
    g === "path"
      ? summary.pathSupporting.length
      : g === "benign"
      ? summary.benignSupporting.length
      : g === "vus"
      ? summary.vus.length
      : g === "info"
      ? summary.informational.length
      : summary.noData.length;

  const matchedLists: { key: "path" | "benign" | "info"; label: string; items: GuidelinesRow[] }[] = [
    { key: "path", label: "Pathogenic-supporting", items: summary.pathSupporting },
    { key: "benign", label: "Benign / neutral", items: summary.benignSupporting },
    { key: "info", label: "Informational-only", items: summary.informational },
  ];

  return (
    <div className="flex flex-col gap-3">
      <span className="eyebrow">
        <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" aria-hidden="true" />
        Concordance &amp; Calibration Guide
      </span>

      {/* Concordance Status Card */}
      <div className="p-3 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-2)] space-y-2">
        <div className="flex items-center justify-between gap-1">
          <span
            className="ev-tier font-mono font-bold text-[10px] uppercase"
            data-tone={statusTone}
          >
            {statusText}
          </span>
        </div>
        <p className="text-[11px] text-[var(--cs-text-secondary)] leading-snug font-sans m-0">
          {statusDesc}
        </p>
        <div className="pt-2 border-t border-[var(--cs-border-subtle)] flex flex-col gap-1 text-[10px] font-mono text-[var(--cs-text-muted)]">
          <div className="flex justify-between items-center">
            <span>REVEL Conservation:</span>
            <span className="font-semibold text-[var(--cs-text-primary)]">
              {revel !== null ? `${revel.toFixed(3)}${revelRow ? ` · ${revelRow.matchLabel}` : ""}` : "N/A"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>FoldX ΔΔG Stability:</span>
            <span className="font-semibold text-[var(--cs-text-primary)]">
              {ddG !== null ? `${ddG.toFixed(2)} kcal/mol${foldxRow ? ` · ${foldxRow.matchLabel}` : ""}` : "N/A"}
            </span>
          </div>
        </div>
      </div>

      {/* Live Threshold Matches Roll-Up */}
      <div className="p-3 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-2)] space-y-2">
        <span className="text-[10px] font-mono font-bold uppercase text-[var(--cs-text-muted)] flex items-center gap-1.5">
          <Gauge className="w-3 h-3 text-[var(--cs-accent-clay)]" aria-hidden="true" />
          Live Threshold Matches
        </span>

        <div className="flex flex-wrap gap-1">
          {(["path", "benign", "vus", "info", "nodata"] as const).map(g => {
            const tint = GROUP_TINTS[g];
            const count = groupCount(g);
            if (count === 0) return null;
            return (
              <span
                key={g}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-sans"
                style={{ background: tint.bg, color: tint.fg, borderColor: tint.border }}
                title={g === "nodata" ? "Metrics with no score for this variant" : undefined}
              >
                <span className="font-mono font-bold tabular-nums">{count}</span>
                <span>
                  {g === "path"
                    ? "path."
                    : g === "benign"
                    ? "benign"
                    : g === "vus"
                    ? "VUS"
                    : g === "info"
                    ? "info"
                    : "no data"}
                </span>
              </span>
            );
          })}
        </div>

        <div className="pt-1 space-y-1.5">
          {matchedLists.map(({ key, label, items }) => {
            if (items.length === 0) return null;
            const tint = GROUP_TINTS[key];
            return (
              <div key={key} className="space-y-0.5">
                <span className="eyebrow block">
                  {label} · {items.length}
                </span>
                {items.map(row => (
                  <div key={row.key} className="flex justify-between items-center gap-2 text-[10px]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: tint.fg }}
                      />
                      <span className="text-[var(--cs-text-secondary)] truncate">{row.name}</span>
                    </span>
                    <span className="font-mono font-semibold text-[var(--cs-text-primary)] tabular-nums shrink-0">
                      {row.display}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}

          {summary.pathSupporting.length === 0 &&
            summary.benignSupporting.length === 0 &&
            summary.informational.length === 0 && (
              <p className="text-[10px] text-[var(--cs-text-muted)] italic m-0">
                No metric reaches a calibrated cut-point yet — scores populate as pipeline stages complete.
              </p>
            )}
        </div>
      </div>

      {/* Relocated ACMG/AMP Evidence Codes Key */}
      <div
        id={INSPECTOR_SECTIONS.thresholdKey}
        tabIndex={-1}
        className="p-3 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-2)] space-y-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
      >
        <span className="text-[10px] font-mono font-bold uppercase text-[var(--cs-text-muted)] block">
          ACMG/AMP Evidence Codes Key
        </span>
        <div className="space-y-1.5 text-[11px]">
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono font-bold text-[var(--cs-accent-clay)] shrink-0">PP3 / BP4</span>
            <span className="text-[var(--cs-text-secondary)] text-right">
              Computational algorithms predict a deleterious (PP3) / neutral (BP4) effect on the protein.
            </span>
          </div>
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono font-bold text-[var(--cs-accent-clay)] shrink-0">PM1</span>
            <span className="text-[var(--cs-text-secondary)] text-right">
              Located in a mutational hot spot or a well-established functional domain without benign variation (Richards 2015). This platform tests the site reading only: an experimentally evidenced active, binding, metal or disulfide site at the residue.
            </span>
          </div>
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono font-bold text-[var(--cs-accent-clay)] shrink-0">BP3</span>
            <span className="text-[var(--cs-text-secondary)] text-right">
              In-frame deletion or insertion in a repetitive region without a known function. It does not apply to missense substitutions.
            </span>
          </div>
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono font-bold text-[var(--cs-accent-clay)] shrink-0">PP2 / BP1</span>
            <span className="text-[var(--cs-text-secondary)] text-right">
              Missense-predominant constraint (PP2) / gene where mostly truncating variants cause disease (BP1).
            </span>
          </div>
          <div className="flex justify-between items-start gap-2">
            <span className="font-mono font-bold text-[var(--cs-accent-clay)] shrink-0">Info</span>
            <span className="text-[var(--cs-text-secondary)] text-right">
              Model-native scale with no published cut-point — reported, never classified.
            </span>
          </div>
        </div>
      </div>

      {/* ClinGen Evidence Point Scale */}
      <div className="p-3 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface-2)] space-y-1.5">
        <span className="text-[10px] font-mono font-bold uppercase text-[var(--cs-text-muted)] block">
          ClinGen Evidence Point Scale
        </span>
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span className="text-[var(--cs-text-secondary)]">Very Strong (Pathogenic)</span>
            <span className="font-mono font-bold text-[var(--cs-text-danger-on-soft)]">8 points</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--cs-text-secondary)]">Strong (Pathogenic)</span>
            <span className="font-mono font-bold text-[var(--cs-text-danger)]">4 points</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--cs-text-secondary)]">Moderate (Pathogenic)</span>
            <span className="font-mono font-bold text-[var(--cs-text-warning-on-soft)]">2 points</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--cs-text-secondary)]">Supporting (Pathogenic)</span>
            <span className="font-mono font-bold text-[var(--cs-text-warning)]">1 point</span>
          </div>
        </div>
      </div>

      {/* Cross-navigation button */}
      {onSelectEvidenceTab && (
        <button
          type="button"
          onClick={() => onSelectEvidenceTab("predictors")}
          className="gt-rail-btn"
        >
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[var(--cs-accent-clay)]" aria-hidden="true" />
            <span>Open In-Silico Predictors</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
