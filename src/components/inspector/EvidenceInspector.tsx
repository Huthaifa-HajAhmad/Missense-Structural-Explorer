import React from "react";
import {
  ShieldAlert,
  Zap,
  Box,
  Layers,
  Info,
  Cpu,
  Sparkles,
  ArrowRight,
  Gauge
} from "lucide-react";
import { AnalysisResult, EnergeticsData } from "../../types";
import {
  THRESHOLDS,
  STRING_CONFIDENCE_BANDS,
  buildGuidelinesRows,
  summarizeGuidelinesRows
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { humaniseAnyRefusal } from "../../shared/evidenceAvailability";
import { FeaturePaletteLegend } from "./FeaturePaletteLegend";
import { PopulationRail } from "./PopulationRail";
import { PredictorsRail } from "./PredictorsRail";
import { AlphaGenomeRail } from "./AlphaGenomeRail";

interface EvidenceInspectorProps {
  analysisResult: AnalysisResult | null;
  activeEvidenceTab?: string;
  onSelectEvidenceTab?: (tab: string) => void;
  foldingDdG?: number | null;
  /** ΔΔG engine results backing the Thresholds pane's live match roll-up. */
  foldingEnergetics?: EnergeticsData | null;
}

export const EvidenceInspector: React.FC<EvidenceInspectorProps> = ({
  analysisResult,
  activeEvidenceTab = "clinical",
  onSelectEvidenceTab,
  foldingDdG = null,
  foldingEnergetics = null
}) => {
  if (!analysisResult) {
    return (
      <div className="text-xs text-cs-text-muted italic p-2">
        Awaiting variant analysis data...
      </div>
    );
  }

  /** Per-source build-gate refusals recorded server-side (unmapping defect F-13). */
  const assemblyRefusals = analysisResult.conservationData?.assemblyRefusals ?? null;
  const conservationData = analysisResult.conservationData;
  const multimerData = analysisResult.multimerData;
  const subunitComment = multimerData?.subunitComment || analysisResult.uniprotFeatures?.subunitComment;

  // Compute dynamic concordance state for threshold view
  const revel = conservationData?.revel ?? null;
  const ddG = foldingDdG;
  let statusBadgeStyle = "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
  let statusText = "Concordance Uncertain";
  let statusDesc = "The scores and stability changes fall into intermediate ranges or present conflicting evidence, requiring further functional validation.";
  
  if (revel !== null && revel >= 0.75 && ddG !== null && ddG > 1.5) {
    statusText = "Destabilization + Conservation Concordant (High Risk)";
    statusBadgeStyle = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
    statusDesc = "Both sequence conservation (REVEL >= 0.75) and structural energetics (FoldX ddG > 1.5 kcal/mol) suggest severe risk of misfolding loss-of-function.";
  } else if ((revel !== null && revel >= 0.5) || (ddG !== null && ddG >= 0.5)) {
    statusText = "Moderate-Risk Concordance (Pathogenic Support)";
    statusBadgeStyle = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    statusDesc = "At least one biophysical indicator (REVEL >= 0.5 or FoldX ddG > 0.5 kcal/mol) shows significant aberration, supporting potential functional disruption.";
  } else if (revel !== null && revel < 0.15 && ddG !== null && ddG < 0.5 && ddG > -0.5) {
    statusText = "Low-Risk Concordance (Likely Benign)";
    statusBadgeStyle = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
    statusDesc = "Consensus indicators fall within benign boundaries. The variant is structurally neutral and evolutionary conservation shows no strict constraint.";
  }

  // Active subtab category normalization
  const tab = activeEvidenceTab?.toLowerCase() || "clinical";

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Dynamic Tab-Aware Contextual Intelligence ── */}
      {tab === "interactions" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Zap className="w-3.5 h-3.5 text-cs-accent-clay" />
            PPI &amp; Interface Methodology
          </span>

          {/* Functional vs Physical Networks */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[11px]">
              <Info className="w-3.5 h-3.5 text-cs-accent-clay shrink-0" />
              <span>Functional vs. Physical Networks</span>
            </div>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              <strong>STRING-db</strong> quantifies proteome-wide functional associations inferred from co-expression, shared pathways, and literature citations.
            </p>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              In contrast, <strong>OpenBind-0</strong> directly calculates atomistic steric clashes, electrostatic shifts, and binding free energy changes (&Delta;&Delta;G_bind) across the physical 3D subunit interface.
            </p>
          </div>

          {/* Confidence Score Thresholds */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              STRING Score Confidence Tiers
            </span>
            {/* Rendered from the shared band table rather than re-written here: this
                card and the PPI table's row badges describe the same classifier, and
                as a hand-written copy this legend listed three bands while the table
                could report a fourth. */}
            <div className="space-y-1 text-[11px] font-mono">
              {STRING_CONFIDENCE_BANDS.map((band, idx) => {
                const upper = idx === 0 ? null : STRING_CONFIDENCE_BANDS[idx - 1].min;
                return (
                  <div key={band.id} className="flex justify-between items-center">
                    <span className="text-cs-text-secondary">
                      {upper === null
                        ? `≥ ${band.min.toFixed(3)}`
                        : `${band.min.toFixed(3)} – ${(upper - 0.001).toFixed(3)}`}
                    </span>
                    <span className="ev-tier" data-tone={band.id}>{band.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quaternary Complex Quick Link */}
          {onSelectEvidenceTab && (
            <button
              type="button"
              onClick={() => onSelectEvidenceTab("multimers")}
              className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-between text-[11px] font-medium transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-indigo-400" />
                <span>Open Quaternary Assembly (Multimers)</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">STRING-db</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v12.0 · Homo sapiens (9606)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">OpenBind-0</span>
              <span className="font-mono text-[10px] text-cs-text-muted">Tier 1 · JapanFold</span>
            </div>
          </div>
        </div>
      )}

      {tab === "multimers" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Box className="w-3.5 h-3.5 text-cs-accent-clay" />
            Quaternary Structure Methodology
          </span>

          {/* ipTM & Quality Metrics */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              Interface Quality (ipTM)
            </span>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              <strong>ipTM &ge; 0.80</strong> indicates high-confidence subunit interface geometry. <strong>Overall pTM</strong> measures whole-complex structural topology.
            </p>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              Inter-chain contact boundary is evaluated at heavy-atom distance &le; 4.5 &Aring;.
            </p>
          </div>

          {/* Curated Subunit Annotation */}
          {subunitComment && (
            <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
                Swiss-Prot SUBUNIT Curation
              </span>
              <p className="text-[11px] text-cs-text-primary italic leading-relaxed">
                &ldquo;{subunitComment}&rdquo;
              </p>
            </div>
          )}

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">Boltz-2 / OpenFold3</span>
              <span className="font-mono text-[10px] text-cs-text-muted">Tier 1 · JapanFold</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">UniProtKB</span>
              <span className="font-mono text-[10px] text-cs-text-muted">Swiss-Prot Curated</span>
            </div>
          </div>
        </div>
      )}

      {tab === "function" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Layers className="w-3.5 h-3.5 text-cs-accent-clay" />
            Domain &amp; Feature Architecture
          </span>

          {/* Feature Legend — rendered from the palette the track paints with, instead of a second
              hand-written list. That list had four of five swatches wrong (indigo domains, amber
              binding sites, emerald PTMs, cyan disulfides) and no entry at all for transmembrane
              regions or the other curated sites, so reading it to interpret the track misled. */}
          <FeaturePaletteLegend />

          {/* Interactive Navigation Guide */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              Inspection &amp; Zoom Controls
            </span>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              Use the zoom slider or zoom buttons to focus on specific sequence windows. Clicking domain cards dynamically highlights and scrolls to corresponding SVG pins.
            </p>
          </div>

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">UniProtKB Feature Table</span>
              <span className="font-mono text-[10px] text-cs-text-muted">Swiss-Prot Verified</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">InterPro / Pfam</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v2024</span>
            </div>
          </div>
        </div>
      )}

      {tab === "clinical" && <PopulationRail analysisResult={analysisResult} />}

      {tab === "predictors" && <PredictorsRail analysisResult={analysisResult} />}

      {(tab === "thresholds" || tab === "guidelines") && (() => {
        // Same builder the Threshold Guide table renders from — the inspector
        // roll-up can never drift from the table's verdicts.
        const rows = buildGuidelinesRows({ result: analysisResult, foldingDdG, foldingEnergetics });
        const summary = summarizeGuidelinesRows(rows);
        const groupCount = (g: "path" | "benign" | "vus" | "info" | "nodata") =>
          g === "path" ? summary.pathSupporting.length
          : g === "benign" ? summary.benignSupporting.length
          : g === "vus" ? summary.vus.length
          : g === "info" ? summary.informational.length
          : summary.noData.length;
        const groupTint: Record<string, { bg: string; fg: string; border: string }> = {
          path: { bg: "var(--cs-bg-danger)", fg: "var(--cs-text-danger-on-soft)", border: "color-mix(in srgb, var(--cs-text-danger) 25%, transparent)" },
          benign: { bg: "var(--cs-bg-success)", fg: "var(--cs-text-success)", border: "color-mix(in srgb, var(--cs-text-success) 25%, transparent)" },
          vus: { bg: "var(--cs-bg-warning)", fg: "var(--cs-text-warning)", border: "color-mix(in srgb, var(--cs-text-warning) 30%, transparent)" },
          info: { bg: "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)", fg: "var(--cs-accent-clay)", border: "color-mix(in srgb, var(--cs-accent-clay) 25%, transparent)" },
          nodata: { bg: "var(--cs-surface)", fg: "var(--cs-text-muted)", border: "var(--cs-border)" }
        };
        const matchedLists: { key: "path" | "benign" | "info"; label: string }[] = [
          { key: "path", label: "Pathogenic-supporting" },
          { key: "benign", label: "Benign / neutral" },
          { key: "info", label: "Informational-only" }
        ];

        return (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" />
            Concordance &amp; Calibration Guide
          </span>

          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${statusBadgeStyle}`}>
                {statusText}
              </span>
            </div>
            <p className="text-[11px] text-cs-text-secondary leading-snug font-sans">
              {statusDesc}
            </p>
            <div className="pt-2 border-t border-cs-border-subtle flex flex-col gap-1 text-[10px] font-mono text-cs-text-muted">
              <div className="flex justify-between">
                <span>REVEL Conservation:</span>
                <span className="font-semibold text-cs-text-primary">{revel !== null ? revel.toFixed(3) : "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span>FoldX ΔΔG Stability:</span>
                <span className="font-semibold text-cs-text-primary">{ddG !== null ? `${ddG.toFixed(2)} kcal/mol` : "N/A"}</span>
              </div>
            </div>
          </div>

          {/* Live roll-up over all 20 guide metrics, driven by the same row
              builder as the main-column table. */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted flex items-center gap-1.5">
              <Gauge className="w-3 h-3 text-cs-accent-clay" />
              Live Threshold Matches
            </span>
            <div className="flex flex-wrap gap-1">
              {(["path", "benign", "vus", "info", "nodata"] as const).map(g => {
                const tint = groupTint[g];
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
                    <span>{g === "path" ? "path." : g === "benign" ? "benign" : g === "vus" ? "VUS" : g === "info" ? "info" : "no data"}</span>
                  </span>
                );
              })}
            </div>
            <div className="pt-1 space-y-1.5">
              {matchedLists.map(({ key, label }) => {
                const items = summary[key === "path" ? "pathSupporting" : key === "benign" ? "benignSupporting" : "informational"];
                if (items.length === 0) return null;
                return (
                  <div key={key} className="space-y-0.5">
                    <span className="eyebrow block">
                      {label} · {items.length}
                    </span>
                    {items.map(row => {
                      const tint = groupTint[key];
                      return (
                        <div key={row.key} className="flex justify-between items-center gap-2 text-[10px]">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tint.fg }} />
                            <span className="text-cs-text-secondary truncate">{row.name}</span>
                          </span>
                          <span className="font-mono font-semibold text-cs-text-primary tabular-nums shrink-0">{row.display}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {summary.pathSupporting.length === 0 && summary.benignSupporting.length === 0 && summary.informational.length === 0 && (
                <p className="text-[10px] text-cs-text-muted italic m-0">
                  No metric reaches a calibrated cut-point yet — scores populate as pipeline stages complete.
                </p>
              )}
            </div>
          </div>

          {/* Relocated from the main column: the verbose evidence-code
              definitions, now the inspector's reference card. */}
          <div
            id={INSPECTOR_SECTIONS.thresholdKey}
            tabIndex={-1}
            className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/40"
          >
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              ACMG/AMP Evidence Codes Key
            </span>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-cs-accent-clay shrink-0">PP3 / BP4</span>
                <span className="text-cs-text-secondary text-right">Computational algorithms predict a deleterious (PP3) / neutral (BP4) effect on the protein.</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-cs-accent-clay shrink-0">PM1</span>
                <span className="text-cs-text-secondary text-right">Mutational hot-spot or critical functional domain (e.g. binding pocket interface) without benign variation.</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-cs-accent-clay shrink-0">BP3</span>
                <span className="text-cs-text-secondary text-right">In-frame deletion/insertion in a repetitive region, or structurally neutral substitution.</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-cs-accent-clay shrink-0">PP2 / BP1</span>
                <span className="text-cs-text-secondary text-right">Missense-predominant constraint (PP2) / gene where mostly truncating variants cause disease (BP1).</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-cs-accent-clay shrink-0">Info</span>
                <span className="text-cs-text-secondary text-right">Model-native scale with no published cut-point — reported, never classified.</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              ClinGen Evidence Point Scale
            </span>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-cs-text-secondary">Very Strong (Pathogenic)</span>
                <span className="font-mono font-bold text-rose-500">8 points</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cs-text-secondary">Strong (Pathogenic)</span>
                <span className="font-mono font-bold text-rose-400">4 points</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cs-text-secondary">Moderate (Pathogenic)</span>
                <span className="font-mono font-bold text-amber-500">2 points</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cs-text-secondary">Supporting (Pathogenic)</span>
                <span className="font-mono font-bold text-amber-400">1 point</span>
              </div>
            </div>
          </div>

          {/* Cross-navigation, same pattern as the Interactions pane's multimer link. */}
          {onSelectEvidenceTab && (
            <button
              type="button"
              onClick={() => onSelectEvidenceTab("predictors")}
              className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 flex items-center justify-between text-[11px] font-medium transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span>Open In-Silico Predictors</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        );
      })()}

      {tab === "alphagenome" && <AlphaGenomeRail analysisResult={analysisResult} />}

      {/* Baseline fallback for tabs under subsequent evaluation */}
      {tab !== "interactions" && tab !== "multimers" && tab !== "function" && tab !== "clinical" && tab !== "predictors" && tab !== "alphagenome" && tab !== "thresholds" && tab !== "guidelines" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Sparkles className="w-3.5 h-3.5 text-cs-accent-clay" />
            Evidence Subtab Telemetry
          </span>
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[11px] text-cs-text-secondary">
            {/*
              * This box previously claimed "Deep-dive domain calibrations and metrics are populated
              * dynamically from live backend microservices" while rendering a static sentence with
              * one interpolated tab id — a placeholder asserting that it was a feature, on the very
              * tab where the pipeline had refused to compute anything. It now says what it is, and
              * reports the refusals the server actually recorded.
              */}
            <p>This panel carries no per-tab telemetry yet — what you see here is a placeholder, not a measurement.</p>
            {assemblyRefusals && assemblyRefusals.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
                  Sources that declined this coordinate
                </p>
                {assemblyRefusals.map((refusal) => (
                  <p key={refusal.source} className="text-[11px] text-cs-text-muted leading-snug">
                    {humaniseAnyRefusal(refusal.reason)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default React.memo(EvidenceInspector);


