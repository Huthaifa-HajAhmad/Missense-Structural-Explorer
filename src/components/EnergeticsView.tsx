import { useState, memo } from "react";
import { 
  Activity, 
  ShieldAlert, 
  Info,
  ExternalLink,
  Circle,
  CheckCircle2,
  Database,
  FlaskConical
} from "lucide-react";
import { AnalysisState, EnergeticsData, StructureProvenance } from "../types";
import { useSettings } from "../context/SettingsContext";
import { THRESHOLDS, computeCalibratedConsensus, calibrateRawScore } from "../shared/thresholds";

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
  foldingStatus: "success" | "failed" | "unavailable" | null;
  foldingEnergetics?: EnergeticsData | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
  disruptionPredictor?: { level: "high" | "low" | "unknown"; reason: string; plddt: number | null } | null;
  isFolding?: boolean;
  foldingError?: string | null;
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
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; negative/neutral scores represent stabilizing/neutral variants. Pearson r ≈ 0.57 on held-out S461 benchmark.",
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
  stabilityoracle: {
    name: "StabilityOracle",
    category: "Graph-Transformer / Structure-Aware ML",
    description: "StabilityOracle evaluates stability changes (ΔΔG) by combining geometric graph-transformer representations of 3D protein coordinate structures with multi-task thermodynamic training.",
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; scores < +0.5 kcal/mol indicate neutral or stabilizing variants.",
    paperTitle: "StabilityOracle Consortium (2024)",
    paperUrl: "https://github.com/Huthaifa-HajAhmad/Missense-Structural-Explorer"
  },
  rmsd: {
    name: "Sidechain RMSD",
    category: "Structural Packing Deviation",
    description: "Root-Mean-Square Deviation (RMSD) of the mutated sidechain relative to the wildtype conformation. It reflects the degree of local packing adjustments and steric displacement needed to accommodate the mutant residue.",
    interpretation: "Values in Angstroms (Å). RMSD > 1.5 Å indicates substantial conformational repacking or steric displacements, signaling local structural rearrangement.",
    paperTitle: "Guerois et al. J Mol Biol (2002)",
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

const EnergeticsView = memo(function EnergeticsView({
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
  thermompnnError = null,
  disruptionPredictor,
  isFolding = false,
  foldingError = null
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
    dynamut2: foldingEnergetics?.dynamut2 ?? null,
    ddmut: foldingEnergetics?.ddmut ?? null,
    rasp: foldingEnergetics?.rasp ?? null,
    thermompnn: foldingEnergetics?.thermompnn ?? null,
    stabilityoracle: foldingEnergetics?.stabilityoracle ?? null,
    bayesdel: result.conservationData?.bayesdel ?? null,
    consensusVerdict: foldingEnergetics?.consensusVerdict ?? null,
    raspReason: (foldingEnergetics as any)?.raspReason,
    foldxRepairFailed: foldingEnergetics?.foldxRepairFailed ?? false,
    foldxBinaryMissing: (foldingEnergetics as any)?.foldxBinaryMissing ?? false
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

        {/* ── Structure Provenance Badge ──────────────────────────────────── */}
        {foldingEnergetics?.structureProvenance && !isFolding && (
          (() => {
            const prov: StructureProvenance = foldingEnergetics.structureProvenance!;
            const isExperimental = prov.source === "experimental";
            const isHomolog = prov.source === "homolog";
            const label = isExperimental
              ? "Experimental Structure"
              : isHomolog
              ? "Structural Homolog"
              : "AlphaFold Prediction";
            const methodClean = prov.method
              ? prov.method.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
              : null;
            return (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-lg border text-[10px] font-mono animate-fade-in"
                style={{
                  background: isExperimental || isHomolog
                    ? "color-mix(in srgb, var(--cs-bg-success) 30%, transparent)"
                    : "var(--cs-surface-2)",
                  borderColor: isExperimental || isHomolog
                    ? "color-mix(in srgb, var(--cs-text-success) 40%, transparent)"
                    : "var(--cs-border-subtle)"
                }}
                title="Structure template used for FoldX ΔΔG computation"
              >
                {isExperimental || isHomolog
                  ? <Database className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-text-success)" }} />
                  : <FlaskConical className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-text-muted)" }} />
                }
                <span className="font-bold" style={{ color: isExperimental || isHomolog ? "var(--cs-text-success)" : "var(--cs-text-muted)" }}>
                  {label}
                </span>
                {prov.pdbId && (
                  <a
                    href={`https://www.rcsb.org/structure/${prov.pdbId.toUpperCase()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded border font-bold uppercase hover:opacity-80 transition-opacity"
                    style={{
                      background: "var(--cs-surface)",
                      borderColor: "var(--cs-border)",
                      color: "var(--cs-accent)"
                    }}
                    title={`Open ${prov.pdbId.toUpperCase()} in RCSB PDB`}
                  >
                    {prov.pdbId.toUpperCase()}
                    {prov.chainId && <span style={{ color: "var(--cs-text-muted)" }}>:{prov.chainId}</span>}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                {methodClean && (
                  <span style={{ color: "var(--cs-text-secondary)" }}>{methodClean}</span>
                )}
                {prov.resolution != null && (
                  <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>
                    {prov.resolution.toFixed(1)} Å
                  </span>
                )}
                {isHomolog && prov.identity != null && (
                  <span style={{ color: "var(--cs-text-muted)" }}>
                    {prov.identity.toFixed(0)}% identity
                  </span>
                )}
              </div>
            );
          })()
        )}
        {/* ─────────────────────────────────────────────────────────────────── */}

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
                  const isFoldxPending = isFolding && energetics.foldxMean === null;
                  const isDynamutPending = (dynamut2Status === "pending" || (isFolding && energetics.dynamut2 === null));
                  const isDdmutPending = (ddmutStatus === "pending" || (isFolding && energetics.ddmut === null));
                  const isThermompnnPending = (thermompnnStatus === "pending" || (isFolding && energetics.thermompnn === null));
                  const isStabilityOraclePending = isFolding && energetics.stabilityoracle === null;

                  const items = [
                    { key: "foldx", name: "FoldX (Mean ± SD)", type: "Force Field Repacking (5 runs)", val: energetics.foldxMean, invertSign: false, isPending: isFoldxPending },
                    { key: "dynamut2", name: "DynaMut2", type: "Normal Mode Analysis / ML", val: energetics.dynamut2, invertSign: true, isPending: isDynamutPending },
                    { key: "ddmut", name: "DDMut (Deep Learning)", type: "Graph Deep Learning / Transformers", val: energetics.ddmut, invertSign: true, isPending: isDdmutPending },
                    { key: "rasp", name: "RaSP", type: "ESM-IF1 Structural Embeddings / MLP", val: energetics.rasp, invertSign: false, isPending: false },
                    { key: "thermompnn", name: "ThermoMPNN", type: "ProteinMPNN Embeddings / Deep Learning", val: energetics.thermompnn, invertSign: false, isPending: isThermompnnPending },
                    ...(energetics.stabilityoracle !== null ? [{ key: "stabilityoracle", name: "StabilityOracle", type: "Graph-Transformer / Structure ML", val: energetics.stabilityoracle, invertSign: false, isPending: isStabilityOraclePending }] : [])
                  ];

                  return items.map((item, idx) => {
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
                      if (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt !== null && disruptionPredictor.plddt < 70) {
                        badge = {
                          ...badge,
                          category: `${badge.category} (Speculative)`,
                          style: "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-amber-500/30 font-semibold"
                        };
                      }
                      if (item.key === "foldx" && energetics.foldxRepairFailed) {
                        badge = {
                          ...badge,
                          category: `${badge.category} (Low Confidence - Repair Failed)`,
                          style: "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-amber-500/30 font-semibold"
                        };
                      }
                    } else if (item.isPending) {
                      scoreText = "Calculating...";
                      badge = { label: "Calculating", category: "Calculating", style: "bg-[var(--cs-surface-2)] text-[var(--cs-accent-clay)] border border-[var(--cs-border)] animate-pulse font-semibold" };
                    } else {
                      scoreText = "Unavailable";
                      if (item.key === "foldx" && energetics.foldxBinaryMissing) {
                        badge = {
                          label: "Binary Not Installed",
                          category: "Binary Not Installed",
                          style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold"
                        };
                      } else if (item.key === "foldx" && (foldingStatus === "failed" || (energetics as any)?.foldxError || energetics.foldxRepairFailed)) {
                        scoreText = "Failed";
                        badge = {
                          label: "Simulation Failed",
                          category: "Simulation Failed",
                          style: "bg-rose-500/10 text-rose-500 border border-rose-500/20 font-semibold"
                        };
                      } else if (item.key === "rasp") {
                        badge = { 
                          label: "Not in Zenodo DB", 
                          category: "Not in Zenodo DB", 
                          style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold" 
                        };
                      } else if ((item.key === "dynamut2" || item.key === "ddmut") && (dynamut2Status === "unavailable" || ddmutStatus === "unavailable")) {
                        scoreText = "Queued Upstream";
                        badge = { 
                          label: "BioSig Congested", 
                          category: "BioSig Congested", 
                          style: "bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold" 
                        };
                      } else if (item.key === "thermompnn" && thermompnnStatus === "error") {
                        scoreText = "Error";
                        badge = { 
                          label: "API Error", 
                          category: "API Error", 
                          style: "bg-rose-500/10 text-rose-500 border border-rose-500/20 font-semibold" 
                        };
                      } else {
                        badge = { label: "Unavailable", category: "Unavailable", style: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)] font-semibold" };
                      }
                    }

                    return (
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
                })()}
            </tbody>
          </table>
        </div>
      </div>

        {/* Extended Biophysical Details & Consensus Verdict */}
        {(energetics.foldxMean !== null || energetics.dynamut2 !== null || energetics.ddmut !== null || energetics.rasp !== null || energetics.thermompnn !== null || energetics.stabilityoracle !== null) && (
          <div className="p-3.5 rounded-lg border space-y-3.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>

            {(() => {
              const uniprotFeatures = analysisState.result?.uniprotFeatures?.features;
              const residueIndex = analysisState.result?.metadata?.residueIndex ?? 0;
              const calConsensus = computeCalibratedConsensus(energetics, uniprotFeatures, residueIndex);
              const isFoldxExcluded = !!energetics.foldxRepairFailed || !!energetics.foldxBinaryMissing;
              const foldxMean = isFoldxExcluded ? null : (energetics.foldxMean ?? energetics.foldx);
              const dynamut2 = energetics.dynamut2;
              const ddmut = energetics.ddmut;
              const rasp = energetics.rasp;
              const thermompnn = energetics.thermompnn;
              const stabilityoracle = energetics.stabilityoracle;

              const activeToolsCount = [foldxMean, dynamut2, ddmut, rasp, thermompnn, stabilityoracle].filter(v => v !== null).length;

              let styleClass = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
              if (calConsensus.consensusVerdict.includes("Insufficient")) {
                styleClass = "bg-slate-500/10 text-slate-400 border border-slate-500/20";
              } else if (calConsensus.consensusVerdict.includes("High")) {
                styleClass = "bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold";
              } else if (calConsensus.consensusVerdict.includes("Moderate") || calConsensus.consensusVerdict.includes("Elevated")) {
                styleClass = "bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold";
              }

              const hasValidConsensus = calConsensus.consensusProbability !== null;
              const pPercent = hasValidConsensus ? Math.round(calConsensus.consensusProbability! * 100) : 0;
              const minPercent = calConsensus.consensusConfMin !== null ? Math.round(calConsensus.consensusConfMin * 100) : 0;
              const maxPercent = calConsensus.consensusConfMax !== null ? Math.round(calConsensus.consensusConfMax * 100) : 0;

              let detailText = "Variant consensus exhibits neutral biophysical stability.";
              if (calConsensus.consensusVerdict.includes("Insufficient")) {
                detailText = "Insufficient biophysical data to compute a destabilization consensus. No valid predictor models have evaluated.";
              } else if (calConsensus.consensusVerdict.includes("High")) {
                detailText = "Calibrated consensus indicates high probability of protein destabilization.";
              } else if (calConsensus.consensusVerdict.includes("Moderate") || calConsensus.consensusVerdict.includes("Elevated")) {
                detailText = "Moderate or elevated destabilization prediction warrants clinical attention.";
              }

              if (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt !== null && disruptionPredictor.plddt < 70 && activeToolsCount > 0) {
                detailText = `${detailText} WARNING: Low template confidence (pLDDT < 70) at this position; predictions are speculative.`;
              }

              return (
                <div className="flex flex-col gap-3 border-b pb-4 animate-fade-in" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider font-mono" style={{ color: "var(--cs-text-muted)" }}>
                      {activeToolsCount}-Method Calibrated Consensus
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${styleClass}`}>
                      {calConsensus.consensusVerdict}
                    </span>
                  </div>

                  {activeToolsCount > 0 && hasValidConsensus ? (
                    <div className="space-y-3 mt-1 pl-2">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span style={{ color: "var(--cs-text-secondary)" }}>Calibrated Probability of Destabilization:</span>
                        <span className="font-bold text-[var(--cs-accent-clay)]">{pPercent}%</span>
                      </div>
                      
                      {/* Gauge Bar */}
                      <div className="relative w-full h-3 rounded-full bg-slate-800/80 border border-slate-700/50 overflow-visible">
                        {/* Conformal range band */}
                        <div 
                          className="absolute h-full rounded-full opacity-35 bg-amber-500"
                          style={{
                            left: `${minPercent}%`,
                            width: `${Math.max(2, maxPercent - minPercent)}%`
                          }}
                        />
                        {/* Single Point estimate indicator */}
                        <div 
                          className="absolute w-2 h-5 -top-1 rounded bg-[var(--cs-accent-clay)] shadow-md"
                          style={{
                            left: `calc(${pPercent}% - 4px)`
                          }}
                        />
                      </div>

                      {/* Conformal Interval Details */}
                      <div className="flex justify-between items-center text-[9px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                        <span>90% Conformal Prediction Interval:</span>
                        <span>[{minPercent}% – {maxPercent}%]</span>
                      </div>
                      <p className="text-[10px] leading-relaxed mt-1" style={{ color: "var(--cs-text-secondary)" }}>
                        {detailText}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] italic text-slate-400">
                      Biophysical predictions are currently processing or unavailable.
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="space-y-2 pl-2 mt-4">
              <span className="text-[9px] font-bold uppercase tracking-wider font-mono block mb-2" style={{ color: "var(--cs-text-muted)" }}>
                Calibrated Tool Breakdown:
              </span>
              {(() => {
                const isFoldxExcluded = !!energetics.foldxRepairFailed || !!energetics.foldxBinaryMissing;
                const foldxMean = isFoldxExcluded ? null : (energetics.foldxMean ?? energetics.foldx);
                const dynamut2 = energetics.dynamut2;
                const ddmut = energetics.ddmut;
                const rasp = energetics.rasp;
                const thermompnn = energetics.thermompnn;
                const stabilityoracle = energetics.stabilityoracle;

                const toolsList = [
                  { name: "FoldX (Ensemble ddG)", val: foldxMean, key: "foldx" as const },
                  { name: "StabilityOracle (Structure ML)", val: stabilityoracle, key: "stabilityoracle" as const },
                  { name: "DynaMut2 (Normal Mode Analysis)", val: dynamut2, key: "dynamut2" as const },
                  { name: "DDMut (Deep Learning)", val: ddmut, key: "ddmut" as const },
                  { name: "RaSP (Rapid ddG)", val: rasp, key: "rasp" as const },
                  { name: "ThermoMPNN (Language Model)", val: thermompnn, key: "thermompnn" as const }
                ];

                return toolsList.map(t => {
                  if (t.val === null) return null;
                  const cal = calibrateRawScore(t.key, t.val);
                  if (!cal) return null;
                  const prob = Math.round(cal.p * 100);
                  const lower = Math.round(cal.lower * 100);
                  const upper = Math.round(cal.upper * 100);

                  return (
                    <div key={t.key} className="flex justify-between items-center text-[10px] font-mono py-1.5 border-b border-dashed" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                      <span style={{ color: "var(--cs-text-secondary)" }}>{t.name}:</span>
                      <div className="flex gap-2">
                        <span className="font-bold" style={{ color: "var(--cs-text-primary)" }}>{t.val.toFixed(2)} kcal/mol</span>
                        <span className="text-slate-400">| P: {prob}% [{lower}%–{upper}%]</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

          </div>
        )}

        <div className="text-[9px] p-2.5 rounded border italic" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}>
          * Multi-method calibrated consensus integrates physics-based force fields (FoldX), normal mode dynamics (DynaMut2), structural graph ML (StabilityOracle), deep learning (DDMut, RaSP), and language modeling (ThermoMPNN) with isotonic probability calibration.
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
                background: "var(--cs-surface-2)", 
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
})

export default EnergeticsView;
