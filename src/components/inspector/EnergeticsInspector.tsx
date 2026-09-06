import React from "react";
import { Activity, Cpu, Gauge, ShieldAlert, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { AnalysisResult, EnergeticsData } from "../../types";
import { useSettings } from "../../context/SettingsContext";

interface EnergeticsInspectorProps {
  analysisResult: AnalysisResult | null;
  foldingEnergetics?: EnergeticsData | null;
  foldingStatus?: "failed" | "success" | null;
  foldingError?: string | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
  disruptionPredictor?: { plddt?: number } | null;
  isFolding?: boolean;
}

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
  isFolding = false
}) => {
  const { settings, updateSetting } = useSettings();
  const energyUnit = settings.energyUnit || "kcal/mol";

  const plddt = disruptionPredictor?.plddt ?? analysisResult?.disruptionPredictor?.plddt ?? null;
  const isLowConfidence = plddt !== null && plddt < 70;
  const foldxRepairFailed = foldingEnergetics?.foldxRepairFailed;
  const foldxBinaryMissing = (foldingEnergetics as any)?.foldxBinaryMissing;
  const isAsyncOffline = (dynamut2Status === "unavailable" || ddmutStatus === "unavailable");
  const raspReason = (foldingEnergetics as any)?.raspReason || ((foldingEnergetics?.rasp === null) ? "Protein is not present in the pre-computed database" : null);

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

      {/* ── 2. Active Engine Notices & Diagnostics ── */}
      {(thermompnnStatus === "error" || isAsyncOffline || isLowConfidence || (foldxRepairFailed && !foldxBinaryMissing) || foldxBinaryMissing || (foldingError && !foldxBinaryMissing) || raspReason) && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Active Method Diagnostics
          </span>

          <div className="space-y-2">
            {/* ThermoMPNN Error Notice */}
            {thermompnnStatus === "error" && thermompnnError && (
              <div className="p-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] uppercase tracking-wide text-rose-900 dark:text-rose-200">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>ThermoMPNN Prediction Failed</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary font-mono break-words">
                  {thermompnnError}
                </p>
              </div>
            )}

            {/* Asynchronous Services Offline */}
            {isAsyncOffline && (
              <div className="p-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-amber-900 dark:text-amber-200">
                  <Info className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>ΔΔG Partial (Async Services Offline)</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">
                  One or more remote biophysical prediction webhooks (DynaMut2 / DDMut) are currently offline. Displaying local force-field and deep learning fallback models.
                </p>
              </div>
            )}

            {/* Low-Confidence Template Alert */}
            {isLowConfidence && (
              <div className="p-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-amber-900 dark:text-amber-200">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>Low-Confidence Template (pLDDT: {plddt?.toFixed(1)})</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">
                  The local AlphaFold template residue has low confidence (pLDDT &lt; 70). Rigid-backbone force-field calculations are highly speculative in disordered loops.
                </p>
              </div>
            )}

            {/* FoldX Binary Missing Notice */}
            {foldxBinaryMissing && (
              <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-cs-text-secondary">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-cs-text-primary">
                  <Info className="w-3.5 h-3.5 shrink-0 text-cs-accent-clay" />
                  <span>FoldX 5.0 Engine Not Installed</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">
                  Local FoldX binary or parameter files are not mounted in the server container. Academic users can mount a Linux executable and parameter assets (<code className="font-mono text-[9.5px]">molecules/</code>, <code className="font-mono text-[9.5px]">rotabase.txt</code>) into <code className="font-mono text-[9.5px]">/app/tools/foldx/</code> to enable local empirical force-field calculations.
                </p>
              </div>
            )}

            {/* FoldX Repair Warning */}
            {foldxRepairFailed && !foldxBinaryMissing && (
              <div className="p-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>FoldX Repair Warning</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">
                  {(foldingEnergetics?.foldxMean ?? foldingEnergetics?.foldx) !== null && (foldingEnergetics?.foldxMean ?? foldingEnergetics?.foldx) !== undefined
                    ? "FoldX RepairPDB phase was bypassed for this structure. Calculations proceeded with un-repaired starting coordinates."
                    : "FoldX RepairPDB phase failed and un-repaired BuildModel could not produce a valid energy estimate for this structure."}
                </p>
              </div>
            )}

            {/* RaSP Method Notice */}
            {raspReason && (
              <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-cs-text-secondary">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-cs-text-primary">
                  <Info className="w-3.5 h-3.5 shrink-0 text-cs-accent-clay" />
                  <span>RaSP Database Coverage</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary">
                  {raspReason}
                </p>
              </div>
            )}

            {/* Simulation Error */}
            {foldingError && !foldxBinaryMissing && (
              <div className="p-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-rose-900 dark:text-rose-200">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>Biophysical Simulation Failed</span>
                </div>
                <p className="text-[10px] leading-relaxed text-cs-text-secondary font-mono">
                  {foldingError}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3. Engine Compute Provenance & Telemetry ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-cs-accent-clay" />
          Stability Engine Telemetry
        </span>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          {/* FoldX Local */}
          {(() => {
            const hasFoldxVal = (foldingEnergetics?.foldxMean ?? foldingEnergetics?.foldx) !== null && (foldingEnergetics?.foldxMean ?? foldingEnergetics?.foldx) !== undefined;
            return (
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    isFolding
                      ? "bg-amber-500 animate-ping"
                      : hasFoldxVal
                      ? "bg-emerald-500"
                      : foldxBinaryMissing
                      ? "bg-slate-400"
                      : foldxRepairFailed
                      ? "bg-amber-500"
                      : foldingStatus === "failed"
                      ? "bg-rose-500"
                      : "bg-slate-400"
                  }`} />
                  <span className="font-semibold text-cs-text-primary">FoldX 5.0</span>
                </div>
                <span className="font-mono text-[10px] text-cs-text-muted">
                  {isFolding
                    ? "Repacking sidechains..."
                    : hasFoldxVal
                    ? "Local Force-Field (Ready)"
                    : foldxBinaryMissing
                    ? "Not Installed (Mount Binary)"
                    : foldxRepairFailed
                    ? "Repair Failed / Unavailable"
                    : foldingStatus === "failed"
                    ? "Simulation Failed"
                    : "Idle"}
                </span>
              </div>
            );
          })()}

          {/* StabilityOracle Structure ML */}
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${foldingEnergetics?.stabilityoracle !== null && foldingEnergetics?.stabilityoracle !== undefined ? "bg-emerald-500" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">StabilityOracle</span>
            </div>
            <span className="font-mono text-[10px] text-cs-text-muted">
              {foldingEnergetics?.stabilityoracle !== null && foldingEnergetics?.stabilityoracle !== undefined ? "Structure Graph ML (Ready)" : "Not Available"}
            </span>
          </div>

          {/* DynaMut2 */}
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${dynamut2Status === "pending" ? "bg-amber-500 animate-ping" : dynamut2Status === "done" ? "bg-emerald-500" : dynamut2Status === "unavailable" ? "bg-amber-500/70" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">DynaMut2</span>
            </div>
            <span className="font-mono text-[10px] text-cs-text-muted">
              {dynamut2Status === "pending" ? "Remote NMA Server..." : dynamut2Status === "done" ? "BioSig Server (Ready)" : dynamut2Status === "unavailable" ? "BioSig Queue / Unavailable" : "Idle"}
            </span>
          </div>

          {/* DDMut Siamese Transformer */}
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${ddmutStatus === "pending" ? "bg-amber-500 animate-ping" : ddmutStatus === "done" ? "bg-emerald-500" : ddmutStatus === "unavailable" ? "bg-amber-500/70" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">DDMut</span>
            </div>
            <span className="font-mono text-[10px] text-cs-text-muted">
              {ddmutStatus === "pending" ? "Graph Deep Learning..." : ddmutStatus === "done" ? "BioSig Siamese (Ready)" : ddmutStatus === "unavailable" ? "BioSig Queue / Unavailable" : "Idle"}
            </span>
          </div>

          {/* RaSP Rapid ddG */}
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${foldingEnergetics?.rasp !== null && foldingEnergetics?.rasp !== undefined ? "bg-emerald-500" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">RaSP</span>
            </div>
            <span className="font-mono text-[10px] text-cs-text-muted">
              {foldingEnergetics?.rasp !== null && foldingEnergetics?.rasp !== undefined ? "Precomputed / Local (Ready)" : raspReason ? "Coverage Limited" : "Not Available"}
            </span>
          </div>

          {/* ThermoMPNN */}
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-cs-border-subtle">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${thermompnnStatus === "pending" ? "bg-amber-500 animate-ping" : thermompnnStatus === "done" ? "bg-emerald-500" : thermompnnStatus === "error" ? "bg-rose-500" : "bg-slate-400"}`} />
              <span className="font-semibold text-cs-text-primary">ThermoMPNN</span>
            </div>
            <span className="font-mono text-[10px] text-cs-text-muted">
              {thermompnnStatus === "pending" ? "ProteinMPNN Embeddings..." : thermompnnStatus === "done" ? "Neural Backbone (Ready)" : thermompnnStatus === "error" ? "API Limit / Failed" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      {/* ── 4. Thermodynamic Reference Parameters ── */}
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
            <span className="font-mono font-semibold text-cs-text-primary">± 1.2 kcal/mol (ProTherm)</span>
          </div>
        </div>
      </div>

      {/* ── 5. Unit Configuration ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
          Energy Display Units
        </span>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => updateSetting("energyUnit", "kcal/mol")}
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
