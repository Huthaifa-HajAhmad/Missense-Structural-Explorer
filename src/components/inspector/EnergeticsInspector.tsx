import React, { useMemo } from "react";
import { Activity, Cpu, Gauge, ShieldAlert, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { AnalysisResult, EnergeticsData } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import {
  buildEngineOutcomes,
  formatDdg,
  type EngineTone,
  type RemoteStatus,
} from "../../shared/engineStatus";

interface EnergeticsInspectorProps {
  analysisResult: AnalysisResult | null;
  foldingEnergetics?: EnergeticsData | null;
  foldingStatus?: "failed" | "success" | "unavailable" | null;
  foldingError?: string | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
  disruptionPredictor?: { plddt?: number } | null;
  isFolding?: boolean;
  /**
   * Single-value FoldX fallback, the same one the main column uses.
   *
   * Without it the two surfaces were not fed the same facts, which falsified the contract's whole
   * premise: on a bundle where `foldingDdG` is set but `energetics.foldx`/`foldxMean` is absent, the
   * table rendered its computed state with a value while telemetry rendered "No result" — for one
   * run.
   */
  foldingDdG?: number | null;
}

/**
 * Severity → dot colour. The state's *text* always accompanies the dot, so a row is never
 * colour-only: previously an 8px dot was the sole signal, and under `reduce-motion` the
 * pending/unavailable pair collapsed to near-identical amber.
 */
const TONE_DOT: Record<EngineTone, string> = {
  good: "var(--cs-text-success)",
  warn: "var(--cs-text-warning)",
  danger: "var(--cs-text-danger)",
  neutral: "var(--cs-text-muted)",
  muted: "var(--cs-border)",
};

/** States that warrant an entry in the diagnostics list. */
const NEEDS_ATTENTION = new Set([
  "failed",
  "not-installed",
  "not-covered",
  "upstream-busy",
  "upstream-error",
  "no-result",
]);

type EnergeticsExtras = EnergeticsData & {
  raspReason?: string;
  foldxBinaryMissing?: boolean;
};

export const EnergeticsInspector: React.FC<EnergeticsInspectorProps> = ({
  analysisResult,
  foldingEnergetics,
  foldingStatus,
  foldingError,
  dynamut2Status,
  ddmutStatus,
  thermompnnStatus,
  thermompnnError,
  disruptionPredictor,
  isFolding = false,
  foldingDdG = null
}) => {
  const { settings, updateSetting } = useSettings();
  const energyUnit = settings.energyUnit || "kcal/mol";

  const plddt = disruptionPredictor?.plddt ?? analysisResult?.disruptionPredictor?.plddt ?? null;
  const isLowConfidence = plddt !== null && plddt < 70;
  const energetics = foldingEnergetics as EnergeticsExtras | null | undefined;

  /**
   * The same canonical outcomes the main column renders.
   *
   * Both surfaces call one builder, so the inspector cannot claim an engine is offline while the
   * table beside it shows a value. The previous flag was `dynamut2Status === "unavailable" ||
   * ddmutStatus === "unavailable"`, so one engine's failure produced a false statement about the
   * other, and the card named both.
   */
  const outcomes = useMemo(
    () =>
      buildEngineOutcomes({
        foldxMean: energetics?.foldxMean ?? foldingDdG,
        foldxDdg: energetics?.foldx ?? foldingDdG,
        foldxSd: energetics?.foldxSd,
        dynamut2: energetics?.dynamut2,
        ddmut: energetics?.ddmut,
        rasp: energetics?.rasp,
        thermompnn: energetics?.thermompnn,
        stabilityoracle: energetics?.stabilityoracle,
        dynamut2Status: dynamut2Status as RemoteStatus,
        ddmutStatus: ddmutStatus as RemoteStatus,
        thermompnnStatus: thermompnnStatus as RemoteStatus,
        raspReason: energetics?.raspReason ?? null,
        thermompnnError,
        foldingError,
        foldingStatus,
        foldxRepairFailed: energetics?.foldxRepairFailed,
        foldxBinaryMissing: energetics?.foldxBinaryMissing,
        isFolding,
      }),
    [
      energetics, dynamut2Status, ddmutStatus, thermompnnStatus, thermompnnError,
      foldingError, foldingStatus, isFolding,
    ]
  );

  const diagnostics = useMemo(() => outcomes.filter(o => NEEDS_ATTENTION.has(o.state)), [outcomes]);

  const provenanceRows = useMemo(() => {
    const prov = energetics?.structureProvenance;
    if (!prov) return [] as Array<{ label: string; value: string }>;
    const rows: Array<{ label: string; value: string }> = [];
    if (prov.pdbId) rows.push({ label: "Template", value: `${prov.pdbId.toUpperCase()}${prov.chainId ? `:${prov.chainId}` : ""}` });
    if (prov.resolution != null) rows.push({ label: "Resolution", value: `${prov.resolution.toFixed(1)} Å` });
    if (prov.identity != null) rows.push({ label: "Sequence identity", value: `${prov.identity.toFixed(0)}%` });
    if (prov.foldxVersion) rows.push({ label: "FoldX version", value: prov.foldxVersion });
    if (prov.foldxRuns != null) rows.push({ label: "Ensemble runs", value: String(prov.foldxRuns) });
    if (prov.seed != null) rows.push({ label: "Random seed", value: String(prov.seed) });
    if (prov.raspDatasetSnapshot) rows.push({ label: "RaSP snapshot", value: prov.raspDatasetSnapshot });
    if (prov.vesmModel) rows.push({ label: "Embedding model", value: prov.vesmModel });
    if (prov.afdbVersion) rows.push({ label: "AlphaFold DB", value: prov.afdbVersion });
    if (prov.modelSha) rows.push({ label: "Model digest", value: prov.modelSha.slice(0, 12) });
    return rows;
  }, [energetics]);

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Clinical Guidance: Destabilization ≠ Pathogenicity ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" />
          Clinical Biophysics Principle
        </span>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
          <span className="font-bold text-[11px] text-cs-text-primary block">
            Destabilization ≠ Pathogenicity
          </span>
          <p className="text-[10.5px] text-cs-text-secondary leading-relaxed">
            Thermodynamic destabilization (ΔΔG) measures misfolding risk but does not equal clinical pathogenicity. Gain-of-function (GOF) or neomorphic variants (e.g. <i>FGFR3</i> p.Gly380Arg) can cause severe disease while remaining structurally stable or neutral.
          </p>
        </div>
      </div>

      {/* ── 2. Engine telemetry: one row per engine, from the canonical state ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-cs-accent-clay" />
          Stability Engine Telemetry
        </span>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          {outcomes.map(outcome => (
            <div key={outcome.id} className="flex items-start justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full shrink-0 ${outcome.state === "running" ? "animate-ping" : ""}`}
                  style={{ background: TONE_DOT[outcome.tone] }}
                />
                <span className="font-semibold text-cs-text-primary truncate">{outcome.engine.name}</span>
              </div>
              <div className="flex flex-col items-end text-right min-w-0">
                <span className="font-mono text-[10px] text-cs-text-secondary">{outcome.label}</span>
                {outcome.canonicalDdg !== null && (
                  <span className="font-mono text-[10px] text-cs-text-muted">
                    {formatDdg(outcome.canonicalDdg, energyUnit)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 3. Diagnostics: plain language, one entry per engine that needs attention ── */}
      {/*
        The low-confidence card is deliberately outside the `diagnostics.length > 0` gate.
        It used to sit inside it, so on a run where every engine returned a value — the good case —
        a low-pLDDT template produced an empty diagnostics array and the warning vanished entirely:
        the more complete the run, the less the panel said about its own reliability.
      */}
      {(diagnostics.length > 0 || isLowConfidence) && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-cs-text-warning" />
            What Is Missing, And Why
          </span>

          <div className="space-y-2">
            {isLowConfidence && (
              <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-cs-text-warning">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>Low-confidence template (pLDDT {plddt?.toFixed(1)})</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">
                  The template residue has low confidence (pLDDT &lt; 70). Rigid-backbone force-field
                  calculations are speculative in disordered loops.
                </p>
              </div>
            )}

            {diagnostics.map(outcome => (
              <div key={outcome.id} className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px]">
                  {outcome.tone === "danger" ? (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-text-danger)" }} />
                  ) : (
                    <Info className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-text-warning)" }} />
                  )}
                  <span className="text-cs-text-primary">
                    {outcome.engine.name} — {outcome.label}
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">{outcome.reason}</p>
                {outcome.detail && (
                  // Technical text stays available for diagnosis but is not shown to a clinical
                  // reader by default: this panel previously rendered raw provider errors,
                  // HTTP text and container paths directly.
                  <details className="text-[9.5px]">
                    <summary className="cursor-pointer text-cs-text-muted select-none">Technical detail</summary>
                    <p className="mt-1 font-mono break-words text-cs-text-muted">{outcome.detail}</p>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. Run provenance ── */}
      {provenanceRows.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cs-accent-clay" />
            Computation Provenance
          </span>
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
            {provenanceRows.map(row => (
              <div key={row.label} className="flex justify-between items-center gap-2">
                <span className="text-cs-text-secondary">{row.label}:</span>
                <span className="font-mono font-semibold text-cs-text-primary truncate" title={row.value}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Thermodynamic Reference Parameters ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-cs-accent-clay" />
          Physical Reference & Baseline
        </span>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Standard Temperature:</span>
            <span className="font-mono font-semibold text-cs-text-primary">298.15 K (25.0 °C)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Solvent pH Baseline:</span>
            <span className="font-mono font-semibold text-cs-text-primary">7.0 (Physiological)</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Experimental Uncertainty:</span>
            {/* Bound to the display unit: this previously stayed in kcal/mol after the user
                switched the whole tab to kJ/mol. */}
            <span className="font-mono font-semibold text-cs-text-primary">± {formatDdg(1.2, energyUnit)} (ProTherm)</span>
          </div>
        </div>
      </div>

      {/* ── 6. Unit Configuration ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
          Energy Display Units
        </span>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateSetting("energyUnit", "kcal/mol")}
            aria-pressed={energyUnit === "kcal/mol"}
            className={`py-1.5 px-2 rounded-lg border text-[11px] font-mono font-semibold cursor-pointer transition-all ${
              energyUnit === "kcal/mol"
                ? "bg-cs-accent-clay text-white border-cs-accent-clay"
                : "bg-cs-surface-2 text-cs-text-secondary border-cs-border hover:text-cs-text-primary"
            }`}
          >
            kcal/mol
          </button>
          <button
            type="button"
            onClick={() => updateSetting("energyUnit", "kJ/mol")}
            aria-pressed={energyUnit === "kJ/mol"}
            className={`py-1.5 px-2 rounded-lg border text-[11px] font-mono font-semibold cursor-pointer transition-all ${
              energyUnit === "kJ/mol"
                ? "bg-cs-accent-clay text-white border-cs-accent-clay"
                : "bg-cs-surface-2 text-cs-text-secondary border-cs-border hover:text-cs-text-primary"
            }`}
          >
            kJ/mol
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(EnergeticsInspector);
