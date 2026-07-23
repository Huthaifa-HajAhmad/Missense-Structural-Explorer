import { useState } from "react";
import { 
  Activity, 
  ShieldAlert, 
  Info, 
  ExternalLink,
  Circle,
  CheckCircle2
} from "lucide-react";
import { AnalysisState, EnergeticsData, StructuralDiffResult } from "../types";
import { useSettings } from "../context/SettingsContext";

interface EnergeticsViewProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  classBorderSec: string;
  classTextBody: string;
  classTextMute: string;
  analysisState: AnalysisState;
  foldingDdG: number | null;
  foldingStatus: "success" | "failed" | null;
  foldingEnergetics?: EnergeticsData | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | null;
  disruptionPredictor?: { level: "high" | "low"; reason: string; plddt: number } | null;
  isFolding?: boolean;
  foldingError?: string | null;
  structuralDiff?: StructuralDiffResult | null;
}

interface MetricExplanation {
  name: string;
  category: string;
  description: string;
  interpretation: string;
  paperTitle: string;
  paperUrl: string;
}

const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  foldx: {
    name: "FoldX ddG",
    category: "Force-Field Biophysics",
    description: "FoldX uses an empirical atomic force field to estimate the change in free energy (ΔΔG) upon mutation. It performs local sidechain repacking on a rigid backbone approximation of the protein structure.",
    interpretation: "ΔΔG > 1.5 kcal/mol indicates strong structural destabilization (high risk of misfolding/degradation). Note that gain-of-function variants may not be destabilizing.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  },
  dynamut2: {
    name: "DynaMut2",
    category: "Normal Mode Analysis / Machine Learning",
    description: "DynaMut2 predicts stability changes (ΔΔG) by combining normal mode analysis (NMA) metrics of protein flexibility and dynamics (using ENM models) with machine learning models trained on experimental stability data.",
    interpretation: "ΔΔG ≤ -1.0 kcal/mol indicates structural destabilization; positive scores represent stabilizing variants.",
    paperTitle: "Rodrigues et al. Bioinformatics (2020)",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btaa784"
  },
  ddmut: {
    name: "DDMut (Deep Learning)",
    category: "Graph Deep Learning / Transformers",
    description: "DDMut uses a Siamese neural network combining graph-based structural representations, convolutional layers, and Transformer encoders to predict free energy changes (ΔΔG) for single and multiple point mutations.",
    interpretation: "ΔΔG ≤ -1.0 kcal/mol indicates structural destabilization; positive scores represent stabilizing variants.",
    paperTitle: "Zhou et al. Nucleic Acids Res (2022)",
    paperUrl: "https://doi.org/10.1093/nar/gkac394"
  },
  rasp: {
    name: "RaSP (Rapid Stability Prediction)",
    category: "Structural Embeddings / MLP Stability Head",
    description: "RaSP predicts thermodynamic stability changes (ΔΔG) using ESM-IF1 structural embeddings combined with a pre-trained multi-layer perceptron head trained on ~350k experimental stability datapoints. It operates directly on 3D structure.",
    interpretation: "ΔΔG ≤ -1.0 kcal/mol indicates structural destabilization; positive scores represent stabilizing variants. Pearson r ≈ 0.57 on held-out S461 benchmark.",
    paperTitle: "Blaabjerg et al. Cell Systems (2023)",
    paperUrl: "https://doi.org/10.1016/j.cels.2023.01.001"
  },
  thermompnn: {
    name: "ThermoMPNN",
    category: "Neural Backbone Stability (ProteinMPNN)",
    description: "ThermoMPNN predicts thermodynamic stability changes (ΔΔG° = mutant - wildtype) using ProteinMPNN structural embeddings trained on >770,000 experimental measurements.",
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; negative scores represent predicted stabilizing variants.",
    paperTitle: "Pei et al. bioRxiv / Tamarind Bio (2024)",
    paperUrl: "https://docs.tamarind.bio/tools/thermompnn"
  },
  rmsd: {
    name: "Sidechain RMSD",
    category: "Structural Packing Deviation",
    description: "Root-Mean-Square Deviation (RMSD) of the mutated sidechain relative to the wildtype conformation. It reflects the degree of local packing adjustments and steric displacement needed to accommodate the mutant residue.",
    interpretation: "Values in Angstroms (Å). RMSD > 1.5 Å indicates substantial conformational repacking or steric displacements, signaling local structural rearrangement.",
    paperTitle: "Guerois et5 al. J Mol Biol (2002)",
    paperUrl: "https://doi.org/10.1006/jmbi.2002.5729"
  },
  vdw: {
    name: "VdW Clash Delta",
    category: "Steric Interaction Energy",
    description: "Van der Waals (VdW) Clash Delta measures the change in steric repulsion (Lennard-Jones potentials) upon sidechain repacking. It identifies clashes when larger or bulkier residues are introduced into confined spaces.",
    interpretation: "Delta values > 2.0 kcal/mol indicate significant steric clashes, suggesting local backbone distortion may be required to accommodate the mutant residue.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  },
  electrostatics: {
    name: "Electrostatic Delta",
    category: "Coulombic Interaction Energy",
    description: "Electrostatic Delta calculates changes in Coulombic electrostatic interactions (such as salt bridges, hydrogen bonds, and charge-charge interactions) resulting from the mutation.",
    interpretation: "Significant negative/positive deviations indicate disrupted salt bridges or altered local hydrogen bonding networks.",
    paperTitle: "Schymkowitz et al. Nucleic Acids Res (2005)",
    paperUrl: "https://doi.org/10.1093/nar/gki387"
  }
};

export default function EnergeticsView({
  isDark,
  classCard,
  classCardHeader,
  classCardTitle,
  classBorderSec,
  classTextBody,
  classTextMute,
  analysisState,
  foldingDdG,
  foldingStatus,
  foldingEnergetics,
  dynamut2Status,
  ddmutStatus,
  thermompnnStatus,
  disruptionPredictor,
  isFolding = false,
  foldingError = null,
  structuralDiff = null
}: EnergeticsViewProps) {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const { settings } = useSettings();
  const energyUnit = settings.energyUnit;
  const result = analysisState.result;

  const formatDdGValue = (val: number | null, unit: "kcal/mol" | "kJ/mol") => {
    if (val === null || val === undefined) return "N/A";
    if (unit === "kJ/mol") {
      return `${(val * 4.184).toFixed(2)} kJ/mol`;
    }
    return `${val.toFixed(2)} kcal/mol`;
  };

  const getDdGBadge = (val: number | null) => {
    if (val === null) return { label: "Not Computed", category: "Not Computed", style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold" };
    const formatted = formatDdGValue(val, energyUnit);
    if (val > 1.5) {
      return { label: `+${formatted} (Highly Destabilizing)`, category: "Highly Destabilizing", style: "bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger)] border border-rose-500/30 font-semibold" };
    }
    if (val > 0.5) {
      return { label: `+${formatted} (Moderately Destabilizing)`, category: "Moderately Destabilizing", style: "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-amber-500/30 font-semibold" };
    }
    if (val < -0.5) {
      return { label: `${formatted} (Stabilizing)`, category: "Stabilizing", style: "bg-[var(--cs-bg-success)] text-[var(--cs-text-success)] border border-emerald-500/30 font-semibold" };
    }
    return { label: `${formatted} (Neutral)`, category: "Neutral", style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-secondary)] border border-[var(--cs-border)] font-semibold" };
  };

  if (!result) {
    return (
      <div className={`${classCard} overflow-hidden flex flex-col transition-all h-full`} id="energetics-view">
        <div className="px-5 py-5 border-b flex-shrink-0" style={{ borderColor: "var(--cs-border)" }}>
          <h1 className="screen-title">Energetics</h1>
          <p className="screen-tab-description">
            Shows how each computational method estimates the free-energy cost of your substitution — positive ΔΔG values indicate predicted structural destabilization.
          </p>
        </div>
        <div className="p-5 flex-grow flex flex-col justify-center text-center py-12">
          <Activity className="w-10 h-10 mx-auto stroke-[1.5] mb-2 animate-pulse" style={{ color: "var(--cs-accent-clay)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--cs-text-muted)" }}>Submit a variant query to calculate biophysical stability metrics.</p>
        </div>
      </div>
    );
  }

  const energetics = {
    foldx: foldingEnergetics?.foldx ?? foldingDdG,
    foldxMean: foldingEnergetics?.foldxMean ?? foldingDdG,
    foldxSd: foldingEnergetics?.foldxSd ?? 0,
    vdw: foldingEnergetics?.vdw ?? 0,
    electrostatics: foldingEnergetics?.electrostatics ?? 0,
    stericClashWarning: foldingEnergetics?.stericClashWarning ?? false,
    localSidechainRmsd: foldingEnergetics?.localSidechainRmsd ?? 0.0,
    dynamut2: foldingEnergetics?.dynamut2 ?? result.dynamut2 ?? null,
    ddmut: foldingEnergetics?.ddmut ?? result.ddmut ?? null,
    rasp: foldingEnergetics?.rasp ?? result.rasp ?? null,
    thermompnn: foldingEnergetics?.thermompnn ?? result.thermompnn ?? null,
    bayesdel: result.conservationData?.bayesdel ?? null,
    consensusVerdict: foldingEnergetics?.consensusVerdict ?? null,
    raspReason: (foldingEnergetics as any)?.raspReason
  };

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all h-full font-mono text-xs`} id="energetics-view" role="region" aria-label="Biophysical Energetics Analysis">
      <div className="px-5 py-5 border-b flex-shrink-0" style={{ borderColor: "var(--cs-border)" }}>
        <h1 className="screen-title">Energetics</h1>
        <p className="screen-tab-description">
          Shows how each computational method estimates the free-energy cost of your substitution — positive ΔΔG values indicate predicted structural destabilization.
        </p>
      </div>

      <div className="p-5 flex-grow overflow-y-auto space-y-4">
        <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Consensus Biophysical Stability (ΔΔG)</h4>
        
        {disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70 && (
          <div className="p-3 rounded-lg border flex flex-col gap-1 animate-fade-in" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Low-Confidence Template Alert (pLDDT: {disruptionPredictor.plddt.toFixed(1)})</span>
            </div>
            <p className="text-[10px] leading-relaxed">
              The local template structure at this residue has low confidence (pLDDT &lt; 70). Predictions generated from rigid-backbone models or biophysical force fields (e.g. FoldX, DynaMut2) are highly speculative in disordered or low-confidence regions.
            </p>
          </div>
        )}

        {((energetics.dynamut2 === null && dynamut2Status === "unavailable") || (energetics.ddmut === null && ddmutStatus === "unavailable")) && (
          <div className="p-3 rounded-lg border flex flex-col gap-1 animate-fade-in" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <span>ΔΔG Evidence Partial (Asynchronous Services Offline)</span>
            </div>
            <p className="text-[10px] leading-relaxed">
              One or more background biophysical services (DynaMut2 or DDMut) are currently offline or failed. Displaying all available predictions.
            </p>
          </div>
        )}

        {isFolding && (
          <div className="p-3.5 rounded-lg border space-y-1 animate-fade-in" style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }} aria-live="polite">
            <div className="font-bold text-xs uppercase flex items-center gap-2">
              <Activity className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--cs-accent-clay)" }} />
              <span>Biophysical Simulation In Progress</span>
            </div>
            <p className="text-xs leading-relaxed opacity-90">
              FoldX mutant minimization, DynaMut2, and DDMut simulations are currently calculating in the background. Generating mutated structures and running atomic force fields. Please wait...
            </p>
          </div>
        )}

        {!isFolding && foldingError && (
          <div className="p-3.5 rounded-lg border space-y-1 bg-rose-50 border-rose-100 text-rose-800 animate-fade-in">
            <div className="font-bold text-xs uppercase flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500" />
              <span>Biophysical Simulation Failed</span>
            </div>
            <p className="text-xs leading-relaxed opacity-90">
              Simulation failed: <strong>{foldingError}</strong>. Displaying sequence-based and structure-based fallback predictions only.
            </p>
          </div>
        )}

        {!isFolding && !foldingError && foldingStatus === null && (
          <div className="p-3.5 rounded-lg border space-y-1 bg-amber-50 border-amber-200 text-amber-700 animate-fade-in">
            <div className="font-bold text-xs uppercase flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0" style={{ strokeWidth: 2 }} />
              <span>Biophysical Simulation Required</span>
            </div>
            <p className="text-xs leading-relaxed">
              FoldX mutant energy minimization has not been triggered for this variant yet. Please switch the 3D Molecular Viewer mode to <strong>"Mutant"</strong> or <strong>"Side-by-Side"</strong> to run local side-chain repacking simulation and compute free-energy changes (ΔΔG).
            </p>
          </div>
        )}

        {!isFolding && !foldingError && foldingStatus !== null && (!foldingEnergetics || foldingEnergetics.foldx === null) && (
          <div className="p-3.5 rounded-lg border space-y-1 bg-amber-50 border-amber-250 text-amber-800 animate-fade-in">
            <div className="font-bold text-xs uppercase flex items-center gap-1.5">
              <Info className="w-4 h-4 shrink-0 text-amber-500" />
              <span>FoldX Modeling Unavailable</span>
            </div>
            <p className="text-xs leading-relaxed opacity-90">
              The local FoldX structural calculation engine is currently unavailable or failed in this environment. Displaying sequence-based and structural-based (DynaMut2 / DDMut) fallback energetics only.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full font-sans border-collapse">
              <thead>
                <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Method</th>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-[35%] border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Type</th>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center font-mono w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>ΔΔG</th>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-[15%]" style={{ color: "var(--cs-text-secondary)" }}>Risk</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const isFoldxPending = (foldingStatus === null || isFolding) && energetics.foldxMean === null;
                  const isDynamutPending = (dynamut2Status === "pending" || (isFolding && energetics.dynamut2 === null));
                  const isDdmutPending = (ddmutStatus === "pending" || (isFolding && energetics.ddmut === null));
                  const isThermompnnPending = (thermompnnStatus === "pending" || (isFolding && energetics.thermompnn === null));

                  const pendingList: { key: string; name: string }[] = [];
                  if (isFoldxPending) pendingList.push({ key: "foldx", name: "FoldX" });
                  if (isDynamutPending) pendingList.push({ key: "dynamut2", name: "DynaMut2" });
                  if (isDdmutPending) pendingList.push({ key: "ddmut", name: "DDMut (Deep Learning)" });
                  if (isThermompnnPending) pendingList.push({ key: "thermompnn", name: "ThermoMPNN" });

                  const collapsePending = pendingList.length >= 2;

                  const items = [
                    { key: "foldx", name: "FoldX (Mean ± SD)", type: "Force Field Repacking (5 runs)", val: energetics.foldxMean, invertSign: false, isPending: isFoldxPending },
                    { key: "dynamut2", name: "DynaMut2", type: "Normal Mode Analysis / ML", val: energetics.dynamut2, invertSign: true, isPending: isDynamutPending },
                    { key: "ddmut", name: "DDMut (Deep Learning)", type: "Graph Deep Learning / Transformers", val: energetics.ddmut, invertSign: true, isPending: isDdmutPending },
                    { key: "rasp", name: "RaSP", type: "ESM-IF1 Structural Embeddings / MLP", val: energetics.rasp, invertSign: true, isPending: false },
                    { key: "thermompnn", name: "ThermoMPNN", type: "ProteinMPNN Embeddings / Deep Learning", val: energetics.thermompnn, invertSign: false, isPending: isThermompnnPending }
                  ];

                  const rows: React.ReactNode[] = [];

                  items.forEach((item, idx) => {
                    if (collapsePending && item.isPending) {
                      return;
                    }

                    let scoreText = "N/A";
                    let badge = { label: "N/A", category: "N/A", style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold" };

                    if (item.val !== null && item.val !== undefined) {
                      if (item.name.includes("FoldX") && energetics.foldxSd !== null && energetics.foldxSd !== undefined) {
                        const mean = energetics.foldxMean ?? energetics.foldx ?? 0;
                        const sd = energetics.foldxSd;
                        if (energyUnit === "kJ/mol") {
                          scoreText = `${(mean * 4.184).toFixed(2)} ± ${(sd * 4.184).toFixed(2)} kJ/mol`;
                        } else {
                          scoreText = `${mean.toFixed(2)} ± ${sd.toFixed(2)} kcal/mol`;
                        }
                      } else {
                        scoreText = formatDdGValue(item.val, energyUnit);
                      }
                      const badgeVal = item.invertSign ? -item.val : item.val;
                      badge = getDdGBadge(badgeVal);
                      if (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70) {
                        badge = {
                          ...badge,
                          category: `${badge.category} (Speculative)`,
                          style: "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-amber-500/30 font-semibold"
                        };
                      }
                    } else if (item.isPending) {
                      scoreText = "Calculating...";
                      badge = { label: "Calculating", category: "Calculating", style: "bg-[var(--cs-surface-2)] text-[var(--cs-accent-clay)] border border-[var(--cs-border)] animate-pulse font-semibold" };
                    } else {
                      scoreText = "Unavailable";
                      if (item.key === "rasp") {
                        badge = { 
                          label: "Not in Zenodo DB", 
                          category: "Not in Zenodo DB", 
                          style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold" 
                        };
                      } else {
                        badge = { label: "Unavailable", category: "Unavailable", style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold" };
                      }
                    }


                    rows.push(
                      <tr key={item.key} className="hover:bg-[var(--cs-bg-subtle)] transition-colors animate-fade-in" style={{ color: "var(--cs-text-primary)", borderBottom: idx < items.length - 1 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                        <td className="p-3 px-4 font-semibold text-[12px] text-left w-1/4 border-r border-[var(--cs-border-subtle)]">
                          <button
                            type="button"
                            onClick={() => setSelectedMetric(item.key)}
                            className="hover:underline cursor-pointer text-left font-bold flex items-center gap-1.5 focus:outline-none w-full"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span style={{ color: "var(--cs-text-primary)" }}>{item.name}</span>
                            </div>
                            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          </button>
                        </td>
                        <td className="p-3 px-4 text-[12px] text-center w-[35%] border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>{item.type}</td>
                        <td className="p-3 px-4 text-center font-mono text-[12px] w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>{scoreText}</td>
                        <td className="p-3 px-4 text-center w-[15%]">
                          <div className="flex justify-center">
                            <span className={`text-[10px] px-2 py-0.5 rounded-lg border ${badge.style}`}>
                              {badge.category}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  });

                if (collapsePending) {
                  rows.push(
                    <tr key="pending-summary" className="table-pending-summary" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                      <td colSpan={4} className="p-2.5 text-left text-xs italic font-sans" style={{ color: "var(--cs-text-muted)" }}>
                        <div className="flex items-center gap-2">
                          <span className="cs-spinner cs-spinner-sm cs-step-icon-in-progress flex-shrink-0" style={{ width: 12, height: 12 }} />
                          <span>
                            Multiple biophysical simulations calculating: {pendingList.map(p => p.name).join(", ")}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return rows;
              })()}
            </tbody>
          </table>
        </div>
      </div>

        {/* Extended Biophysical Details & Consensus Verdict */}
        {energetics.foldxMean !== null && (
          <div className="p-3.5 rounded-lg border space-y-3.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
            <div className="flex gap-2.5 p-3 rounded-lg border text-[11px] leading-relaxed mb-3.5 bg-amber-500/5 text-amber-500/90" style={{ borderColor: "rgba(245, 158, 11, 0.15)" }}>
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block mb-0.5 font-sans">Clinical Guidance: Destabilization ≠ Pathogenicity</span>
                Thermodynamic destabilization (ΔΔG) measures misfolding risk but does not equal clinical pathogenicity. Gain-of-function (GOF) or neomorphic variants (e.g. <i>FGFR3</i> p.Gly380Arg) can cause severe disease while remaining structurally stable or neutral.
              </div>
            </div>

            {(energetics as any)?.raspReason && energetics.rasp === null && (
              <div className="flex gap-2.5 p-3 rounded-lg border text-[11px] leading-relaxed mb-3.5 bg-slate-500/5 text-slate-400 border-slate-500/20" style={{ borderColor: "rgba(100, 116, 139, 0.15)" }}>
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5 font-sans">RaSP Method Notice</span>
                  {(energetics as any).raspReason}
                </div>
              </div>
            )}

            {(() => {
              const foldxMean = energetics.foldxMean ?? energetics.foldx;
              const dynamut2 = energetics.dynamut2;
              const ddmut = energetics.ddmut;
              const rasp = energetics.rasp;
              const thermompnn = energetics.thermompnn;

              const foldxDestab = foldxMean !== null && foldxMean >= 1.5;
              const dynamutDestab = dynamut2 !== null && dynamut2 <= -1.0;
              const ddmutDestab = ddmut !== null && ddmut <= -1.0;
              const raspDestab = rasp !== null && rasp <= -1.0;
              const tmDestab = thermompnn !== null && thermompnn >= 1.0;

              const votes = [
                { name: "FoldX", destab: foldxDestab, val: foldxMean },
                { name: "DynaMut2", destab: dynamutDestab, val: dynamut2 },
                { name: "DDMut (Deep Learning)", destab: ddmutDestab, val: ddmut },
                { name: "RaSP", destab: raspDestab, val: rasp },
                { name: "ThermoMPNN", destab: tmDestab, val: thermompnn }
              ];

              const activeVotes = votes.filter(v => v.val !== null);
              const positiveVotes = activeVotes.filter(v => v.destab).length;
              const totalVotes = activeVotes.length;

              return (
                <div className="flex flex-col gap-1.5 border-b pb-3 animate-fade-in" style={{ borderColor: "var(--cs-border-subtle)" }}>
                   <span className="text-[10px] font-bold uppercase tracking-wider font-mono" style={{ color: "var(--cs-text-muted)" }}>
                    {totalVotes === 5
                      ? "5-Method Consensus Stability Verdict"
                      : totalVotes === 4
                        ? "4-Method Consensus Stability Verdict"
                        : totalVotes === 3
                          ? "3-Method Consensus Stability Verdict" 
                          : totalVotes > 0 
                            ? `${totalVotes}-Method Consensus Stability Verdict` 
                            : "Consensus Stability Verdict"}:
                  </span>
                </div>
              );
            })()}

            <div className="space-y-4 pl-5">
              {(() => {
                const foldxMean = energetics.foldxMean ?? energetics.foldx;
                const dynamut2 = energetics.dynamut2;
                const ddmut = energetics.ddmut;
                const rasp = energetics.rasp;
                const thermompnn = energetics.thermompnn;

                const foldxDestab = foldxMean !== null && foldxMean >= 1.5;
                const dynamutDestab = dynamut2 !== null && dynamut2 <= -1.0;
                const ddmutDestab = ddmut !== null && ddmut <= -1.0;
                const raspDestab = rasp !== null && rasp <= -1.0;
                const tmDestab = thermompnn !== null && thermompnn >= 1.0;

                const votes = [
                  { name: "FoldX", destab: foldxDestab, val: foldxMean },
                  { name: "DynaMut2", destab: dynamutDestab, val: dynamut2 },
                  { name: "DDMut (Deep Learning)", destab: ddmutDestab, val: ddmut },
                  { name: "RaSP", destab: raspDestab, val: rasp },
                  { name: "ThermoMPNN", destab: tmDestab, val: thermompnn }
                ];

                const activeVotes = votes.filter(v => v.val !== null);
                const positiveVotes = activeVotes.filter(v => v.destab).length;
                const totalVotes = activeVotes.length;

                let label = "Low-Risk (Neutral Consensus)";
                let styleClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                let detailText = "All active methods agree on fold stability.";

                if (positiveVotes >= 2) {
                  label = "High-Risk Destabilizing (Consensus)";
                  styleClass = "bg-rose-500/10 text-rose-455 border-rose-500/20 font-bold";
                  detailText = `${positiveVotes}/${totalVotes} methods predict significant destabilization (DynaMut2/DDMut ≤ -1.0 kcal/mol or FoldX/ThermoMPNN ≥ +1.0 kcal/mol).`;
                } else if (positiveVotes === 1) {
                  label = "Moderate-Risk Conflicting Support";
                  styleClass = "bg-amber-500/10 text-amber-450 border-amber-500/20 font-bold";
                  detailText = "Conflicting evidence: 1 method predicts destabilization while others suggest neutrality.";
                } else if (totalVotes === 0) {
                  label = "UNAVAILABLE";
                  styleClass = "bg-slate-500/10 text-slate-400 border-slate-500/20";
                  detailText = "Energetics data is currently processing or unavailable.";
                }

                if (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70 && totalVotes > 0) {
                  label = `${label} (Speculative - Low pLDDT)`;
                  styleClass = "bg-amber-500/10 text-amber-455 border border-amber-500/20 font-bold";
                  detailText = `${detailText} WARNING: Template structure has low confidence (pLDDT < 70) at this residue position. Biophysical predictions are speculative and should be interpreted with caution.`;
                }

                return (
                  <div className="flex flex-col gap-1 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${styleClass}`}>
                        {label}
                      </span>
                      <span className="text-[9px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                        Votes: {positiveVotes}/{totalVotes} Destabilizing
                      </span>
                    </div>
                    <p className="text-[10px] leading-relaxed mt-1" style={{ color: "var(--cs-text-secondary)" }}>
                      {detailText}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Additional Biophysical Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[10.5px] pt-1">
              <button
                type="button"
                onClick={() => setSelectedMetric("rmsd")}
                className="p-2.5 rounded-lg border flex flex-col justify-between font-mono text-left w-full hover:border-[#C46849]/50 transition-colors cursor-pointer focus:outline-none"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="block text-[8.5px] uppercase font-bold text-slate-500 tracking-wider">Sidechain RMSD</span>
                  <Info className="w-3 h-3 text-slate-400 shrink-0" />
                </div>
                <strong className={`text-[12px] font-bold block mt-1 ${
                  energetics.localSidechainRmsd !== null && energetics.localSidechainRmsd > 1.5 
                    ? "text-rose-455" 
                    : energetics.localSidechainRmsd !== null && energetics.localSidechainRmsd > 0.8
                      ? "text-amber-500"
                      : "text-emerald-450"
                }`}>
                  {energetics.localSidechainRmsd !== null 
                    ? `${energetics.localSidechainRmsd.toFixed(2)} Å` 
                    : "N/A"}
                </strong>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetric("vdw")}
                className="p-2.5 rounded-lg border flex flex-col justify-between font-mono text-left w-full hover:border-[#C46849]/50 transition-colors cursor-pointer focus:outline-none"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="block text-[8.5px] uppercase font-bold text-slate-500 tracking-wider">VdW Clash Delta</span>
                  <Info className="w-3 h-3 text-slate-400 shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <strong className={`text-[12px] font-bold ${
                    energetics.stericClashWarning ? "text-rose-455" : "text-emerald-450"
                  }`}>
                    {energetics.vdw !== null ? `${energetics.vdw.toFixed(2)} ${settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol"}` : "N/A"}
                  </strong>
                  {energetics.stericClashWarning && (
                    <span className="text-[7px] bg-rose-500/10 border border-rose-500/20 text-rose-455 px-1 py-0.2 rounded font-bold uppercase shrink-0">
                      Clash
                    </span>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetric("electrostatics")}
                className="p-2.5 rounded-lg border flex flex-col justify-between font-mono text-left w-full hover:border-[#C46849]/50 transition-colors cursor-pointer focus:outline-none"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="block text-[8.5px] uppercase font-bold text-slate-500 tracking-wider">Electrostatic Delta</span>
                  <Info className="w-3 h-3 text-slate-400 shrink-0" />
                </div>
                <strong className="text-[12px] font-bold block mt-1" style={{ color: "var(--cs-text-primary)" }}>
                  {energetics.electrostatics !== null ? `${energetics.electrostatics.toFixed(2)} ${settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol"}` : "N/A"}
                </strong>
              </button>
            </div>
          </div>
        )}

        {structuralDiff && (
          <div className="p-3.5 rounded-lg border space-y-3.5 animate-fade-in" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
            <h5 className="font-bold text-xs uppercase tracking-wider font-mono" style={{ color: "var(--cs-text-secondary)" }}>
              Kabsch-Aligned Structural Displacements
            </h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              <div className="p-2 border rounded" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Global RMSD</div>
                <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>{structuralDiff.rmsd.toFixed(4)} Å</div>
              </div>
              <div className="p-2 border rounded" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Local RMSD</div>
                <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                  {structuralDiff.localRmsd !== null ? `${structuralDiff.localRmsd.toFixed(4)} Å` : "N/A"}
                </div>
              </div>
              <div className="p-2 border rounded" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">WT Clashes</div>
                <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>{structuralDiff.clashes.wtClashCount}</div>
              </div>
              <div className="p-2 border rounded" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}>
                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Clash Diff</div>
                <div className="text-sm font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                  <span className={structuralDiff.clashes.diff > 0 ? "text-rose-455" : "text-emerald-450"}>
                    {structuralDiff.clashes.diff > 0 ? `+${structuralDiff.clashes.diff}` : structuralDiff.clashes.diff}
                  </span>
                </div>
              </div>
            </div>
            {structuralDiff.windowDisplacements && structuralDiff.windowDisplacements.length > 0 && (
              <div className="pt-2">
                <span className="block text-[9px] uppercase font-bold text-slate-500 tracking-wider mb-2 font-mono">Local Window Displacements</span>
                <div className="flex flex-wrap gap-1.5 font-mono text-[9px]">
                  {structuralDiff.windowDisplacements.map((d, index) => (
                    <div key={index} className="px-2 py-1 rounded border flex items-center gap-1" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                      <span style={{ color: "var(--cs-text-secondary)" }}>{d.resName}{d.resSeq}:</span>
                      <span className={d.displacement > 0.5 ? "text-rose-455 font-bold" : "text-emerald-450"}>
                        {d.displacement.toFixed(2)} Å
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        
        <div className="text-[9px] p-2.5 rounded border italic" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}>
          * Consensus calculations are derived from FoldX energy grids and sequence-based evolutionary alignment dynamics.
        </div>
      </div>

      {/* Metric Explanation Modal */}
      {selectedMetric && (() => {
        const detail = METRIC_EXPLANATIONS[selectedMetric];
        if (!detail) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div 
              className="w-full max-w-md rounded-2xl border shadow-2xl p-6 relative flex flex-col gap-4 animate-slide-in"
              style={{ 
                background: isDark ? "#1C1A17" : "#FAF9F6", 
                borderColor: "var(--cs-border)",
                color: "var(--cs-text-primary)"
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[9px] uppercase font-mono font-bold tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>
                    {detail.category}
                  </span>
                  <h3 className="text-base font-black tracking-tight mt-0.5 text-left font-sans">
                    {detail.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMetric(null)}
                  className="w-6 h-6 rounded-full flex items-center justify-center border hover:bg-[var(--cs-bg-subtle)] transition-colors text-slate-450 hover:text-slate-200 cursor-pointer text-lg font-bold"
                  style={{ borderColor: "var(--cs-border-subtle)" }}
                >
                  &times;
                </button>
              </div>

              {/* Description */}
              <div className="space-y-3 text-xs leading-relaxed text-left font-sans">
                <div>
                  <span className="block text-[9px] uppercase font-bold font-mono tracking-wider opacity-60 mb-1">
                    Scientific Description
                  </span>
                  <p style={{ color: "var(--cs-text-secondary)" }}>
                    {detail.description}
                  </p>
                </div>

                <div>
                  <span className="block text-[9px] uppercase font-bold font-mono tracking-wider opacity-60 mb-1">
                    Interpretation &amp; Thresholds
                  </span>
                  <p style={{ color: "var(--cs-text-secondary)" }}>
                    {detail.interpretation}
                  </p>
                </div>

                <div className="pt-2 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <span className="block text-[9px] uppercase font-bold font-mono tracking-wider opacity-60 mb-1">
                    Reference Paper
                  </span>
                  <a
                    href={detail.paperUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-bold hover:underline"
                    style={{ color: "var(--cs-accent-clay)" }}
                  >
                    <span>{detail.paperTitle}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedMetric(null)}
                  className="px-4 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer hover:bg-[var(--cs-bg-subtle)] font-sans"
                  style={{ 
                    borderColor: "var(--cs-border-subtle)", 
                    background: "var(--cs-surface-2)",
                    color: "var(--cs-text-primary)" 
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
