import { useState } from "react";
import { 
  Database, 
  Cpu, 
  Compass, 
  Activity, 
  Share2, 
  ShieldAlert, 
  ArrowRight,
  TrendingUp,
  Percent,
  Layers,
  Info,
  ExternalLink,
  Circle
} from "lucide-react";
import { AnalysisState, PocketResult, EnergeticsData, StructuralDiffResult } from "../types";
import { AMINO_ACID_PROPERTIES, AMINO_ACID_NAMES_MAP } from "../useVariantAnalysis";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { useSettings } from "../context/SettingsContext";
import { THRESHOLDS, countPredictorConcordance } from "../shared/thresholds";
import { PredictorSpecialistPanels } from "./PredictorSpecialistPanels";

interface EvidenceDashboardCardProps {
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
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  disruptionPredictor?: { level: "high" | "low"; reason: string; plddt: number } | null;
  isFolding?: boolean;
  foldingError?: string | null;
  structuralDiff?: StructuralDiffResult | null;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

type TabType = "clinical" | "predictors" | "structure" | "function" | "interactions" | "guidelines";

interface MetricExplanation {
  name: string;
  category: string;
  description: string;
  interpretation: string;
  paperTitle: string;
  paperUrl: string;
}

const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  am: {
    name: "AlphaMissense",
    category: "AI Pathogenicity Predictor",
    description: "AlphaMissense adapts AlphaFold structural representation learning to predict the pathogenicity of missense variants. It leverages an unsupervised protein language model trained on evolutionary sequences alongside structural embeddings to score candidate substitutions.",
    interpretation: "Scores range from 0 (benign) to 1 (pathogenic). Classifications include 'likely_benign' (≤ 0.340), 'uncertain', and 'likely_pathogenic' (≥ 0.564). ClinGen-calibrated thresholds are 0.983 (pathogenic) and 0.063 (benign).",
    paperTitle: "Cheng et al. Science (2023)",
    paperUrl: "https://doi.org/10.1126/science.adg7492"
  },
  cadd: {
    name: "CADD PHRED",
    category: "Genomic Annotation Integrator",
    description: "Combined Annotation Dependent Depletion (CADD) is a framework for integrating diverse genomic annotations (conservation, epigenetic, functional) into a single score of relative deleteriousness.",
    interpretation: "PHRED-scaled scores range from 0 to 99. A score ≥ 20 indicates the variant is predicted to be in the top 1% of most deleterious substitutions; ≥ 30 indicates the top 0.1%.",
    paperTitle: "Kircher et al. Nat Genet (2014)",
    paperUrl: "https://doi.org/10.1038/ng.2892"
  },
  revel: {
    name: "REVEL",
    category: "Ensemble Pathogenicity Predictor",
    description: "Rare Exome Variant Ensemble Learner (REVEL) is an ensemble method that integrates pathogenicity predictions from 13 individual in-silico predictors (including SIFT, PolyPhen, MutationTaster, and GERP++).",
    interpretation: "Scores range from 0 to 1. ClinGen SVI guidelines recommend REVEL ≥ 0.75 as strong evidence of pathogenicity (PP3_Strong), and < 0.15 as benign evidence (BP4).",
    paperTitle: "Ioannidis et al. Am J Hum Genet (2016)",
    paperUrl: "https://doi.org/10.1016/j.ajhg.2016.08.016"
  },
  eve: {
    name: "EVE Model",
    category: "Evolutionary Generative Model",
    description: "Evolutionary Model of Variant Effect (EVE) uses deep generative models (variational autoencoders) trained on evolutionary sequence families to model the fitness landscape and predict pathogenicity.",
    interpretation: "Continuous score from 0 (benign) to 1 (pathogenic), alongside classification classes: 'Benign' (≤ 0.25), 'Uncertain', or 'Pathogenic' (≥ 0.75).",
    paperTitle: "Frazer et al. Nature (2021)",
    paperUrl: "https://doi.org/10.1038/s41586-021-04043-8"
  },
  esm2: {
    name: "VESM Co-distilled LLR",
    category: "Protein Language Model",
    description: "VESM (Variant Effect ESM) is a co-distilled protein language model that compresses the collective knowledge of the ESM family. It computes a log-likelihood ratio (LLR) reflecting variant effect predictions on ProteinGym without external structural or evolutionary inputs.",
    interpretation: "LLR values range from -20 to +5. Informational only — no validated clinical threshold is applied, and it is excluded from ACMG concordance voting.",
    paperTitle: "Ntranos Lab, bioRxiv (2024)",
    paperUrl: "https://github.com/ntranoslab/vesm"
  },
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
  bayesdel: {
    name: "BayesDel (noAF)",
    category: "Meta-Predictor Integration",
    description: "BayesDel is a meta-predictor that integrates multiple individual in-silico tools (including conservation and functional annotations) using a Bayesian approach. We use the version without allele frequency (noAF) to prevent double-counting frequency evidence.",
    interpretation: "Scores range from -1.0 to 1.0. A score ≥ 0.133 indicates pathogenic support (PP3_Supporting), and ≤ -0.0404 indicates benign support (BP4).",
    paperTitle: "Feng et al. Hum Mutat (2021)",
    paperUrl: "https://doi.org/10.1002/humu.24155"
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
  },
  contact_density: {
    name: "Cα Contact Density",
    category: "Local Structural Density",
    description: "Contact density counts the number of Cα atoms within a 10Å radius of the mutation site. This quantifies whether the residue is located in a densely packed core or a flexible surface loop.",
    interpretation: "Core residues have ≥ 15 neighbors, boundary residues have 8-14, and surface residues have < 8 neighbors.",
    paperTitle: "Pejaver et al. Nat Methods (2020)",
    paperUrl: "https://doi.org/10.1038/s41592-020-0962-8"
  }
};

export default function EvidenceDashboardCard({
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
  computedPocket,
  isPocketLoading,
  pocketError,
  disruptionPredictor,
  isFolding = false,
  foldingError = null,
  structuralDiff = null,
  activeTab: activeTabProp,
  onTabChange
}: EvidenceDashboardCardProps) {
  const [localActiveTab, setLocalActiveTab] = useState<TabType>("clinical");
  const activeTab = (activeTabProp as TabType) || localActiveTab;
  const setActiveTab = (onTabChange as any) || setLocalActiveTab;
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

  if (!result) {
    // Loading state — data is being fetched in the background
    if (analysisState.isLoading) {
      return (
        <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
          <div className="p-6 flex-1 flex flex-col gap-5 overflow-y-auto">
            {/* Live Module Readiness Status Bar */}
            <div className="p-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(196,104,73,0.12)" }}>
                  <Database className="w-4 h-4 animate-pulse" style={{ color: "var(--cs-accent-clay)" }} />
                </div>
                <div>
                  <h4 className="text-xs font-bold tracking-tight" style={{ color: "var(--cs-text-primary)" }}>Loading Evidence Modules</h4>
                  <p className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Populating multi-modal dataset groups sequentially based on API readiness...</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono flex-wrap justify-end">
                <span className="px-2 py-1 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold">
                  ✓ Coordinates
                </span>
                <span className="px-2 py-1 rounded border bg-amber-500/10 text-amber-500 border-amber-500/20 font-bold animate-pulse">
                  ⚡ Clinical &amp; Frequencies
                </span>
                <span className="px-2 py-1 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-bold">
                  ⏳ Biophysics (Background)
                </span>
              </div>
            </div>

            {/* Skeleton cards row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-4 rounded-xl border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                  <div className="h-2 w-24 rounded animate-pulse mb-4" style={{ background: "var(--cs-surface-2)" }} />
                  <div className="space-y-2">
                    <div className="h-7 rounded animate-pulse" style={{ background: "var(--cs-surface-2)" }} />
                    <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--cs-surface-2)" }} />
                    <div className="h-3 w-1/2 rounded animate-pulse" style={{ background: "var(--cs-surface-2)" }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Skeleton second row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[1, 2].map(i => (
                <div key={i} className="p-4 rounded-xl border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                  <div className="h-2 w-20 rounded animate-pulse mb-3" style={{ background: "var(--cs-surface-2)" }} />
                  <div className="space-y-1.5">
                    {[1,2,3,4].map(j => (
                      <div key={j} className="h-2.5 rounded animate-pulse" style={{ background: "var(--cs-surface-2)", width: `${60 + j * 8}%` }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Status text */}
            <p className="text-[11px] font-mono text-center animate-pulse" style={{ color: "var(--cs-text-muted)" }}>
              Fetching clinical annotations, ClinVar, gnomAD &amp; All of Us frequencies…
            </p>
          </div>
        </div>
      );
    }

    // Empty state — no query run yet
    return (
      <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
        <div className="p-5 flex-1 flex flex-col justify-center text-center py-12 text-slate-500">
          <Database className="w-10 h-10 mx-auto text-indigo-500 stroke-[1.5] mb-2 animate-pulse" />
          <p className="text-sm font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Evidence Dashboard Ready</p>
          <div className="w-16 h-[1px] bg-slate-800/10 dark:bg-slate-800/60 mx-auto my-3"></div>
          <p className="text-xs max-w-sm mx-auto mt-1 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
            Submit a variant query to load multi-modal predictors, conservation, energetics and structural pocket evidence.
          </p>
        </div>
      </div>
    );
  }

  // Score badge helpers
  const getAMBadge = (pathogenicity: number | null, cls: string | null) => {
    if (pathogenicity === null && !cls) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    const scoreStr = pathogenicity !== null ? ` (AM: ${pathogenicity.toFixed(3)})` : "";
    
    // ClinGen SVI: path >= 0.983 (Supporting), benign <= 0.063 (Benign Supporting)
    const isPathogenic = cls?.toLowerCase().includes("pathogenic") || (pathogenicity !== null && pathogenicity >= 0.983);
    const isBenign = cls?.toLowerCase().includes("benign") || (pathogenicity !== null && pathogenicity <= 0.063);

    if (isPathogenic) {
      return { label: `Supporting Path.${scoreStr}`, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
    }
    if (isBenign) {
      return { label: `Supporting Benign${scoreStr}`, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label: `VUS${scoreStr}`, style: "bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold" };
  };

  const getCADDBadge = (phred: number | null) => {
    if (phred === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    // ClinGen SVI: >= 25.3 -> Moderate, >= 15.0 -> Supporting, <= 10 -> Supporting Benign
    if (phred >= 25.3) {
      return { label: `Moderate Path. (PHRED: ${phred.toFixed(1)})`, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (phred >= 15.0) {
      return { label: `Supporting Path. (PHRED: ${phred.toFixed(1)})`, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
    }
    if (phred <= 10.0) {
      return { label: `Supporting Benign (PHRED: ${phred.toFixed(1)})`, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label: `VUS (PHRED: ${phred.toFixed(1)})`, style: "bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold" };
  };

  const getREVELBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "badge-metric-neutral" };
    // ClinGen SVI: >= 0.77 -> Moderate, >= 0.65 -> Supporting, <= 0.15 -> Supporting Benign
    if (score >= 0.77) {
      return { label: `Moderate Path. (Score: ${score.toFixed(3)})`, style: "badge-metric-neutral" };
    }
    if (score >= 0.65) {
      return { label: `Supporting Path. (Score: ${score.toFixed(3)})`, style: "badge-metric-neutral" };
    }
    if (score <= 0.15) {
      return { label: `Supporting Benign (Score: ${score.toFixed(3)})`, style: "badge-metric-neutral" };
    }
    return { label: `VUS (Score: ${score.toFixed(3)})`, style: "badge-metric-neutral" };
  };

  const getEVEBadge = (score: number | null | undefined, cls: string | null | undefined) => {
    if (score === null || score === undefined) return { label: "N/A", style: "badge-metric-neutral" };
    const classStr = cls ? ` (${cls})` : "";
    const label = `Score: ${score.toFixed(3)}${classStr}`;

    const isPathogenic = cls?.toLowerCase().includes(THRESHOLDS.eve.pathogenicClass) || score >= THRESHOLDS.eve.pathogenic;
    const isBenign = cls?.toLowerCase().includes(THRESHOLDS.eve.benignClass) || score <= THRESHOLDS.eve.benign;

    if (isPathogenic) {
      return { label: `Supporting Path. (Score: ${score.toFixed(3)})`, style: "badge-metric-neutral" };
    }
    if (isBenign) {
      return { label: `Supporting Benign (Score: ${score.toFixed(3)})`, style: "badge-metric-neutral" };
    }
    return { label, style: "badge-metric-neutral" };
  };

  const getESM2Badge = (llr: number | null | undefined) => {
    if (llr === null || llr === undefined) return { label: "N/A", style: "badge-metric-neutral" };
    // VESM SVI calibration: <= -5.0 -> Supporting Pathogenic, >= -2.0 -> Supporting Benign
    if (llr <= -5.0) {
      return { label: `Supporting Path. (LLR: ${llr.toFixed(2)})`, style: "badge-metric-neutral" };
    }
    if (llr >= -2.0) {
      return { label: `Supporting Benign (LLR: ${llr.toFixed(2)})`, style: "badge-metric-neutral" };
    }
    return { label: `VUS (LLR: ${llr.toFixed(2)})`, style: "badge-metric-neutral" };
  };

  const getBayesdelBadge = (score: number | null | undefined) => {
    if (score === null || score === undefined) return { label: "N/A", style: "badge-metric-neutral" };
    const label = `Score: ${score.toFixed(3)}`;
    if (score >= THRESHOLDS.bayesdel.pathogenic) {
      return { label: `Supporting Path. (${label})`, style: "badge-metric-neutral" };
    }
    if (score <= THRESHOLDS.bayesdel.benign) {
      return { label: `Supporting Benign (${label})`, style: "badge-metric-neutral" };
    }
    return { label: `VUS (${label})`, style: "badge-metric-neutral" };
  };

  const getGERPBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "badge-metric-neutral" };
    if (score >= THRESHOLDS.gerp.conserved) {
      return { label: `GERP++: ${score.toFixed(2)} (Conserved)`, style: "badge-metric-neutral" };
    }
    return { label: `GERP++: ${score.toFixed(2)} (Neutral)`, style: "badge-metric-neutral" };
  };

  const getPhyloPBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "badge-metric-neutral" };
    if (score >= THRESHOLDS.phylop.conserved) {
      return { label: `phyloP: ${score.toFixed(2)} (Conserved)`, style: "badge-metric-neutral" };
    }
    return { label: `phyloP: ${score.toFixed(2)} (Variable)`, style: "badge-metric-neutral" };
  };

  const getDdGBadge = (val: number | null) => {
    if (val === null) return { label: "Not Computed", category: "Not Computed", style: "badge-metric-neutral" };
    const formatted = formatDdGValue(val, energyUnit);
    if (val > 1.5) {
      return { label: `+${formatted} (Highly Destabilizing)`, category: "Highly Destabilizing", style: "badge-metric-neutral" };
    }
    if (val > 0.5) {
      return { label: `+${formatted} (Moderately Destabilizing)`, category: "Moderately Destabilizing", style: "badge-metric-neutral" };
    }
    if (val < -0.5) {
      return { label: `${formatted} (Stabilizing)`, category: "Stabilizing", style: "badge-metric-neutral" };
    }
    return { label: `${formatted} (Neutral)`, category: "Neutral", style: "badge-metric-neutral" };
  };

  const renderContrastBar = (wtVal: number, mutVal: number) => {
    const minVal = Math.min(wtVal, mutVal);
    const maxVal = Math.max(wtVal, mutVal);
    const isDecrease = wtVal > mutVal;
    const baseColor = "bg-[#ad5e6d]/90";
    const changeColor = isDecrease ? "bg-[#50c8a5]" : "bg-[#ff6f91]";
    return (
      <div className="relative h-2 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
        <div 
          className={`absolute h-full left-0 ${baseColor}`} 
          style={{ width: `${minVal}%` }} 
        />
        <div 
          className={`absolute h-full ${changeColor}`} 
          style={{ left: `${minVal}%`, width: `${maxVal - minVal}%` }} 
        />
      </div>
    );
  };

  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: "clinical", label: "Databases", icon: Database },
    { id: "predictors", label: "Predictors", icon: Cpu },
    { id: "structure", label: "Structure", icon: Layers },
    { id: "function", label: "Function", icon: TrendingUp },
    { id: "interactions", label: "Interactions", icon: Share2 },
    { id: "guidelines", label: "Threshold Guide", icon: ShieldAlert }
  ];

  const consurfVal = result.conservationData?.consurf;

  // Resolve 1-letter residue abbreviations for property calculations (normalize casing to TitleCase first)
  const normalWt = result.metadata?.wildType ? (result.metadata.wildType.charAt(0).toUpperCase() + result.metadata.wildType.slice(1).toLowerCase()) : "";
  const normalMut = result.metadata?.mutant ? (result.metadata.mutant.charAt(0).toUpperCase() + result.metadata.mutant.slice(1).toLowerCase()) : "";
  const wt1 = normalWt.length === 3 ? AMINO_ACID_3_TO_1[normalWt] : normalWt;
  const mut1 = normalMut.length === 3 ? AMINO_ACID_3_TO_1[normalMut] : normalMut;
  const wtProp = wt1 ? AMINO_ACID_PROPERTIES[wt1] : null;
  const mutProp = mut1 ? AMINO_ACID_PROPERTIES[mut1] : null;

  // Local calculations for consensus biophysical energetics table
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
    ddgun: foldingEnergetics?.ddgun ?? null,
    bayesdel: result.conservationData?.bayesdel ?? null,
    consensusVerdict: foldingEnergetics?.consensusVerdict ?? null
  };

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">

      {result.isDemoData && (
        <div className={`mx-5 mt-4 p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed transition-all flex items-center gap-2 ${
          isDark 
            ? "bg-amber-500/10 border-amber-500/20 text-amber-300" 
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <span>⚠ Demo data — example preset; not a live backend analysis</span>
        </div>
      )}


      {/* Tab Content Panels — scrollable */}
      <div className="p-5 flex-1 font-mono text-xs overflow-y-auto">
        {activeTab === "clinical" && (
          <div className="space-y-4">
            <div>
              <h1 className="screen-title">Databases</h1>
              <p className="screen-tab-description">ClinVar clinical classifications, gnomAD v4.0 population allele counts, and All of Us cohort frequencies.</p>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Column 1: ClinVar Interpretation */}
              {result.clinvar && result.clinvar.classification && !result.clinvar.classification.toLowerCase().includes("not found") ? (
                <div 
                  className="p-4 rounded-xl border transition-all duration-300 flex flex-col justify-between"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div>
                    <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>ClinVar Interpretation</span>
                    {(() => {
                      const c = result.clinvar.classification.toLowerCase();
                      let badgeStyle = {};
                      if (c.includes("likely pathogenic")) {
                        badgeStyle = { color: "var(--cs-text-warning)", backgroundColor: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)" };
                      } else if (c.includes("pathogenic")) {
                        badgeStyle = { color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "var(--cs-text-danger)" };
                      } else if (c.includes("likely benign") || c.includes("benign")) {
                        badgeStyle = { color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "var(--cs-text-success)" };
                      } else {
                        badgeStyle = { color: "var(--cs-text-secondary)", backgroundColor: "var(--cs-surface-2)", borderColor: "var(--cs-border)" };
                      }
                      
                      return (
                        <span 
                          className="inline-block mt-2 px-2.5 py-1 rounded-lg text-xs font-bold border"
                          style={badgeStyle}
                        >
                          {result.clinvar.classification}
                        </span>
                      );
                    })()}
                  </div>
                  
                  <div className="mt-3 rounded-lg p-2.5 border font-sans text-xs space-y-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                    <div className="border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <span className="block text-[9px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Review Status</span>
                      <span className="text-[11px] font-semibold leading-relaxed" style={{ color: "var(--cs-text-primary)" }}>{result.clinvar.reviewStatus}</span>
                    </div>
                    <div className="border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <span className="block text-[9px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Associated Trait</span>
                      <span className="text-[11px] font-semibold leading-relaxed block truncate" style={{ color: "var(--cs-text-primary)" }} title={result.clinvar.trait}>{result.clinvar.trait || "N/A"}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Last Evaluated</span>
                      <span className="font-mono font-medium" style={{ color: "var(--cs-text-primary)" }}>
                        {result.clinvar.lastEvaluated && !isNaN(new Date(result.clinvar.lastEvaluated).getTime()) ? new Date(result.clinvar.lastEvaluated).toLocaleDateString() : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div 
                  className="p-4 rounded-xl border transition-all duration-300 flex flex-col justify-between"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                    ClinVar Interpretation
                  </span>
                  <div className="mt-3 rounded-lg p-2.5 border border-dashed font-sans text-xs italic flex items-center justify-center min-h-[70px] text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-muted)" }}>
                    Absent from NCBI ClinVar database (rare/novel variant).
                  </div>
                </div>
              )}

              {/* Column 2: gnomAD Allele Count */}
              <div
                className="p-4 rounded-xl border transition-all duration-300"
                style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
              >
                <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>gnomAD Allele Count</span>

                {result.gnomadFrequency && (
                  (result.gnomadFrequency.genomeAC !== null && result.gnomadFrequency.genomeAC !== undefined) ||
                  (result.gnomadFrequency.exomeAC !== null && result.gnomadFrequency.exomeAC !== undefined)
                ) ? (
                  <div className="mt-3 space-y-2">
                    {/* Genome AC/AN */}
                    {result.gnomadFrequency.genomeAC !== null && result.gnomadFrequency.genomeAC !== undefined && (
                      <div className="rounded-lg p-2.5 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Genomes (v4.0)</span>
                          <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                            {result.gnomadFrequency.genomeAC.toLocaleString()}
                          </span>
                        </div>
                        {result.gnomadFrequency.genomeAN !== null && result.gnomadFrequency.genomeAN !== undefined && (
                          <div className="flex justify-between items-center text-[10px] mt-1">
                            <span style={{ color: "var(--cs-text-muted)" }}>Allele Number</span>
                            <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                              {result.gnomadFrequency.genomeAN.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Exome AC/AN */}
                    {result.gnomadFrequency.exomeAC !== null && result.gnomadFrequency.exomeAC !== undefined && (
                      <div className="rounded-lg p-2.5 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Exomes (v4.0)</span>
                          <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                            {result.gnomadFrequency.exomeAC.toLocaleString()}
                          </span>
                        </div>
                        {result.gnomadFrequency.exomeAN !== null && result.gnomadFrequency.exomeAN !== undefined && (
                          <div className="flex justify-between items-center text-[10px] mt-1">
                            <span style={{ color: "var(--cs-text-muted)" }}>Allele Number</span>
                            <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                              {result.gnomadFrequency.exomeAN.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Homozygote count */}
                    {result.gnomadFrequency.nHomozygous !== null && result.gnomadFrequency.nHomozygous !== undefined && result.gnomadFrequency.nHomozygous > 0 && (
                      <div className="flex justify-between items-center text-[10px] pt-1">
                        <span style={{ color: "var(--cs-text-muted)" }}>Homozygotes observed</span>
                        <span className="font-mono font-bold" style={{ color: "var(--cs-danger)" }}>
                          {result.gnomadFrequency.nHomozygous}
                        </span>
                      </div>
                    )}
                  </div>
                ) : result.clinvar && result.clinvar.alleleFrequencies && result.clinvar.alleleFrequencies.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {result.clinvar.alleleFrequencies.map((freq: any, fIdx: number) => (
                      <div key={fIdx} className="flex justify-between items-center text-xs">
                        <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>{freq.source}:</span>
                        <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                          {(() => {
                            const num = parseFloat(freq.value);
                            return isNaN(num) ? "N/A" : num.toExponential(3);
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state-box mt-3 text-xs">
                    Absent from gnomAD population database (rare/novel variant).
                  </div>
                )}
              </div>

              {/* Column 3: All of Us Allele Count */}
              <div
                className="p-4 rounded-xl border transition-all duration-300"
                style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
              >
                <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>All of Us Allele Count</span>
                {result.aouFrequency && (result.aouFrequency.aouAC !== null || result.aouFrequency.aouAN !== null) ? (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg p-2.5 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Total Alleles (AC)</span>
                        <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                          {result.aouFrequency.aouAC !== null && result.aouFrequency.aouAC !== undefined ? result.aouFrequency.aouAC.toLocaleString() : "0"}
                        </span>
                      </div>
                      {result.aouFrequency.aouAN !== null && result.aouFrequency.aouAN !== undefined && (
                        <div className="flex justify-between items-center text-[10px] mt-1">
                          <span style={{ color: "var(--cs-text-muted)" }}>Allele Number (AN)</span>
                          <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                            {result.aouFrequency.aouAN.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg p-2.5 border space-y-1.5" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Heterozygotes (Het)</span>
                        <span className="font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>
                          {result.aouFrequency.aouHet !== null && result.aouFrequency.aouHet !== undefined ? result.aouFrequency.aouHet.toLocaleString() : "0"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Homozygotes (Hom)</span>
                        <span className="font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>
                          {result.aouFrequency.aouHom !== null && result.aouFrequency.aouHom !== undefined ? result.aouFrequency.aouHom.toLocaleString() : "0"}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state-box mt-3 text-xs">
                    Absent from All of Us population database (rare/novel variant).
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "predictors" && (
          <div className="space-y-4">
            <div>
              <h1 className="screen-title">Predictors</h1>
              <p className="screen-tab-description">In-silico pathogenicity predictors with ACMG/AMP-calibrated thresholds and concordance voting.</p>
            </div>
            
            {/* Transcript Context & Warning (TRANSCRIPT-BANNER) */}
            {result.transcriptId && (
              <div className={`p-3 rounded-lg border text-xs leading-relaxed ${
                result.isCanonical
                  ? "bg-slate-500/5 text-slate-400 border-slate-500/10"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}>
                <div className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[9px] font-mono">
                  <span>Transcript Info</span>
                </div>
                <p className="mt-1 text-[10px] opacity-90">
                  Mapped using transcript ID: <span className="font-mono font-bold">{result.transcriptId}</span>
                  {result.isCanonical ? " (canonical MANE / Ensembl select isoform)." : " (non-canonical fallback)."}
                </p>
                {result.transcriptWarning && (
                  <p className="mt-1 text-[10px] text-amber-500 font-semibold">{result.transcriptWarning}</p>
                )}
              </div>
            )}

            {/* Unified In-Silico Consensus & Coverage Card */}
            {(() => {
              const cadd = result.predictorData?.caddPhred;
              const revel = result.conservationData?.revel;
              const amScore = result.predictorData?.amPathogenicity;
              const amClass = result.predictorData?.amClass;
              const bayesdel = result.conservationData?.bayesdel;
              const esmLlr = result.conservationData?.esm1b;

              const concordance = countPredictorConcordance(cadd, revel, amScore, amClass, bayesdel, esmLlr, {
                metarnn: result.conservationData?.metarnn,
                clinpred: result.conservationData?.clinpred,
                eigenPhred: result.conservationData?.eigenPhred,
                dann: result.conservationData?.dann,
                popeve: result.conservationData?.popeve,
              });
              const total = concordance.available.length;
              if (total === 0) return null;

              let verdictTitle = "VUS / Conflicting Evidence";
              let verdictBadgeLabel = "VUS";
              let verdictBadgeStyle: React.CSSProperties = { color: "var(--cs-text-warning)", backgroundColor: "var(--cs-bg-warning)", borderColor: "rgba(217,119,6,0.3)" };
              
              const activeVotingTotal = concordance.pathogenicTools.filter(t => !t.isInformationalOnly).length +
                                       concordance.benignTools.filter(t => !t.isInformationalOnly).length +
                                       concordance.vusTools.filter(t => !t.isInformationalOnly).length;

              const votingPathogenicCount = concordance.pathogenicTools.filter(t => !t.isInformationalOnly).length;
              const infoPathogenicCount = concordance.pathogenicTools.filter(t => t.isInformationalOnly).length;

              const votingBenignCount = concordance.benignTools.filter(t => !t.isInformationalOnly).length;
              const infoBenignCount = concordance.benignTools.filter(t => t.isInformationalOnly).length;

              if (concordance.nPathogenic > activeVotingTotal / 2) {
                verdictTitle = `Concordant Pathogenic (${concordance.nPathogenic}/${activeVotingTotal} consensus tools)`;
                verdictBadgeLabel = "Pathogenic";
                verdictBadgeStyle = { color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "rgba(220,38,38,0.3)" };
              } else if (concordance.nBenign > activeVotingTotal / 2) {
                verdictTitle = `Concordant Benign (${concordance.nBenign}/${activeVotingTotal} consensus tools)`;
                verdictBadgeLabel = "Benign";
                verdictBadgeStyle = { color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "rgba(22,163,74,0.3)" };
              } else {
                verdictTitle = `Conflicting Evidence (${concordance.nPathogenic} pathogenic, ${concordance.nBenign} benign, ${concordance.nVus} VUS)`;
              }

              return (
                <div 
                  className="p-4.5 rounded-xl border flex flex-col gap-4 mb-4 animate-fade-in shadow-sm"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="block text-[10px] uppercase font-bold tracking-wider font-mono opacity-70" style={{ color: "var(--cs-text-muted)" }}>
                        🧬 In-Silico Pathogenicity Consensus
                      </span>
                      <h4 className="text-sm font-bold mt-1" style={{ color: "var(--cs-text-primary)" }}>
                        {verdictTitle}
                      </h4>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0" style={verdictBadgeStyle}>
                      {verdictBadgeLabel}
                    </span>
                  </div>

                  {/* 3-Container Grid Layout (Pathogenic, Benign, VUS/Intermediate) - Centered between top & bottom separators */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-3.5 border-y border-[var(--cs-border-subtle)] text-[11px]">
                    {/* Container 1: Pathogenic Support */}
                    <div className="p-3 rounded-lg border bg-rose-500/5 border-rose-500/20 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between font-black text-[10.5px] uppercase tracking-wide text-[var(--cs-text-primary)] mb-2" style={{ color: "var(--cs-text-primary)" }}>
                          <span>Pathogenic Support ({votingPathogenicCount}{infoPathogenicCount > 0 ? ` + ${infoPathogenicCount} info` : ""})</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 font-mono border border-rose-500/30 font-black text-[var(--cs-text-primary)]" style={{ color: "var(--cs-text-primary)" }}>Concordant</span>
                        </div>
                        {concordance.pathogenicTools.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {concordance.pathogenicTools.map((t) => (
                              <span key={t.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-mono font-black bg-rose-500/25 border border-rose-500/40 shadow-xs" style={{ color: "var(--cs-text-primary)" }}>
                                <span style={{ color: "var(--cs-text-primary)" }}>{t.name}</span>
                                {t.isInformationalOnly && (
                                  <span className="text-[8px] px-1 py-0.2 rounded bg-rose-500/40 font-black uppercase tracking-tighter" style={{ color: "var(--cs-text-primary)" }}>Info</span>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] italic text-[var(--cs-text-muted)] block mt-1">No tools predicting pathogenic</span>
                        )}
                      </div>
                    </div>

                    {/* Container 2: Benign Support */}
                    <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between font-black text-[10.5px] uppercase tracking-wide text-[var(--cs-text-primary)] mb-2" style={{ color: "var(--cs-text-primary)" }}>
                          <span>Benign Support ({votingBenignCount}{infoBenignCount > 0 ? ` + ${infoBenignCount} info` : ""})</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 font-mono border border-emerald-500/30 font-black text-[var(--cs-text-primary)]" style={{ color: "var(--cs-text-primary)" }}>Discordant</span>
                        </div>
                        {concordance.benignTools.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {concordance.benignTools.map((t) => (
                              <span key={t.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-mono font-black bg-emerald-500/25 border border-emerald-500/40 shadow-xs" style={{ color: "var(--cs-text-primary)" }}>
                                <span style={{ color: "var(--cs-text-primary)" }}>{t.name}</span>
                                {t.isInformationalOnly && (
                                  <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/40 font-black uppercase tracking-tighter" style={{ color: "var(--cs-text-primary)" }}>Info</span>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] italic text-[var(--cs-text-muted)] block mt-1">No tools predicting benign</span>
                        )}
                      </div>
                    </div>

                    {/* Container 3: VUS / Intermediate */}
                    <div className="p-3 rounded-lg border bg-amber-500/5 border-amber-500/20 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between font-black text-[10.5px] uppercase tracking-wide text-[var(--cs-text-primary)] mb-2" style={{ color: "var(--cs-text-primary)" }}>
                          <span>VUS / Intermediate ({concordance.vusTools.length})</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 font-mono border border-amber-500/30 font-black text-[var(--cs-text-primary)]" style={{ color: "var(--cs-text-primary)" }}>Indeterminate</span>
                        </div>
                        {concordance.vusTools.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {concordance.vusTools.map((t) => (
                              <span key={t.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-mono font-black bg-amber-500/25 border border-amber-500/40 shadow-xs" style={{ color: "var(--cs-text-primary)" }}>
                                <span style={{ color: "var(--cs-text-primary)" }}>{t.name}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] italic text-[var(--cs-text-muted)] block mt-1">No intermediate tools</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] leading-relaxed space-y-1 text-[var(--cs-text-secondary)] pt-1">
                    <p>
                      Calculated from <span className="font-semibold text-[var(--cs-text-primary)]">{total} available in-silico predictors</span> ({activeVotingTotal} consensus voting tools + {concordance.available.length - activeVotingTotal} informational model).
                      {concordance.unavailable.length > 0 && (
                        <span> Unavailable: <span className="font-mono text-[10px]">{concordance.unavailable.join(", ")}</span>.</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })()}

            <PredictorSpecialistPanels 
              predictorData={result.predictorData}
              conservationData={result.conservationData}
              esm2Score={result.esm2?.llr}
            />
          </div>
        )}

        {activeTab === "structure" && (
          <div className="space-y-4">
            <div>
              <h1 className="screen-title">Structure</h1>
              <p className="screen-tab-description">Residue property shifts, burial status, contact density, and pocket proximity derived from the folded 3D model.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Wild-Type Residue</span>
                <span className="text-3xl font-black text-emerald-500 mt-1">{normalWt}</span>
                <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
                  {AMINO_ACID_NAMES_MAP[wt1] || wt1}
                </p>
              </div>

              <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Mutant Substitution</span>
                <span className="text-3xl font-black text-rose-500 mt-1">{normalMut}</span>
                <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
                  {AMINO_ACID_NAMES_MAP[mut1] || mut1}
                </p>
              </div>
            </div>

            {wtProp && mutProp && (
              <div className="p-4 rounded-lg border space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Biochemical Property Contrast (Scale: 0-100)</span>
                
                {/* Hydrophobicity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Hydrophobicity</span>
                    <span className="font-bold">{wtProp.hydrophobicity} → {mutProp.hydrophobicity}</span>
                  </div>
                  {renderContrastBar(wtProp.hydrophobicity, mutProp.hydrophobicity)}
                </div>

                {/* Size */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Residue Volume / Size</span>
                    <span className="font-bold">{wtProp.size} → {mutProp.size}</span>
                  </div>
                  {renderContrastBar(wtProp.size, mutProp.size)}
                </div>

                {/* Polarity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Polarity</span>
                    <span className="font-bold">{wtProp.polarity} → {mutProp.polarity}</span>
                  </div>
                  {renderContrastBar(wtProp.polarity, mutProp.polarity)}
                </div>

                {/* Charge */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)", cursor: "help" }} title="Normalized scale: 0 = negative, 50 = neutral, 100 = positive">Isoelectric Charge Index ⓘ</span>
                    <span className="font-bold">{wtProp.charge} → {mutProp.charge}</span>
                  </div>
                  {renderContrastBar(wtProp.charge, mutProp.charge)}
                </div>
              </div>
            )}

            {result.insights?.biochemicalShift && (
              <div className="p-3 rounded-lg border text-[12px] font-sans leading-relaxed" style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }}>
                <span className="font-bold block uppercase text-[11px] mb-1 tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Biochemical Shift Narrative:</span>
                {result.insights.biochemicalShift}
              </div>
            )}

            {/* Burial Status & Neighbor Density */}
            {result.disruptionPredictor && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedMetric("contact_density")}
                  className="p-4 rounded-lg border text-left flex flex-col justify-between hover:border-[#C46849]/50 transition-all cursor-pointer focus:outline-none w-full"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div className="w-full">
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="block text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Burial / Exposure Status</span>
                      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded border badge-metric-neutral">
                        {result.disruptionPredictor.burialStatus ?? "Unknown"}
                      </span>
                      {result.disruptionPredictor.rsa !== undefined && result.disruptionPredictor.rsa !== null && (
                        <span className="text-[11px] font-mono opacity-80" style={{ color: "var(--cs-text-secondary)" }}>
                          RSA: {(result.disruptionPredictor.rsa * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] leading-relaxed mt-2 font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                      {result.disruptionPredictor.burialStatus === "core"
                        ? "Deeply buried core residue. High structural stability role; mutations highly likely to cause misfolding."
                        : result.disruptionPredictor.burialStatus === "boundary"
                        ? "Boundary/intermediate exposure. Moderate tolerance to hydrophobic-to-polar shifts."
                        : "Surface-exposed residue. High tolerance to substitution unless in active sites or binding interfaces."}
                      {result.disruptionPredictor.sasa !== undefined && result.disruptionPredictor.sasa !== null && (
                        <span className="block mt-1.5 text-[11px] font-mono text-muted">
                          SASA: {result.disruptionPredictor.sasa.toFixed(1)} Å² (Calculated locally via Shrake-Rupley algorithm)
                        </span>
                      )}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedMetric("contact_density")}
                  className="p-4 rounded-lg border text-left flex flex-col justify-between hover:border-[#C46849]/50 transition-all cursor-pointer focus:outline-none w-full"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div className="w-full">
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="block text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Cα Contact Density</span>
                      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-lg font-black" style={{ color: "var(--cs-accent-clay)" }}>
                        {result.disruptionPredictor.neighborCount ?? "N/A"}
                      </span>
                      <span className="text-[10px] font-medium" style={{ color: "var(--cs-text-muted)" }}>neighbors (&lt;10Å)</span>
                    </div>
                    <p className="text-[10px] leading-normal mt-2" style={{ color: "var(--cs-text-secondary)" }}>
                      Quantifies local packing density. Core is defined as &ge; 15 neighbors, boundary as 8-14, and surface as &lt; 8.
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "function" && (
          <div className="space-y-4">
            <div>
              <h1 className="screen-title">Function</h1>
              <p className="screen-tab-description">Ligand-binding pocket proximity (P2Rank / heuristic fallback) and UniProt-curated functional site annotations at this residue.</p>
            </div>
            {isPocketLoading ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mb-2" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
                <span className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Calculating ligand-binding pockets via P2Rank/Heuristic...</span>
              </div>
            ) : pocketError ? (
              <div className="p-3 text-center text-rose-455 border border-dashed border-rose-500/20 bg-rose-500/5 rounded-lg">
                <ShieldAlert className="w-5 h-5 mx-auto mb-1 text-rose-500" />
                <span>Failed to calculate pockets: {pocketError}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {computedPocket ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>P2Rank Ligand-Binding Pocket Distance</h4>
                      <span className="badge-data-source">
                        {computedPocket.status === "success" ? "P2Rank Live" : "Heuristic Fallback"}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="metric-card">
                        <span className="metric-card-label">Pocket Distance</span>
                        <span className={`metric-card-value ${
                          computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance < 10
                            ? "text-[var(--cs-text-danger)]"
                            : ""
                        }`}>
                          {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                            ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                            : "N/A"}
                        </span>
                        <span className="metric-card-desc">Distance to pocket centroid</span>
                      </div>

                      <div className="metric-card">
                        <span className="metric-card-label">Binding Probability</span>
                        <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                          {computedPocket.status === "success" ? `${computedPocket.pocketScore}%` : "N/A"}
                        </span>
                        <span className="metric-card-desc">P2Rank affinity index</span>
                      </div>

                      <div className="metric-card">
                        <span className="metric-card-label">Pocket Volume</span>
                        <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                          {computedPocket.pocketVolume ? `${computedPocket.pocketVolume} Å³` : "N/A"}
                        </span>
                        <span className="metric-card-desc">Spatial cavity volume</span>
                      </div>
                    </div>

                    {computedPocket.status !== "success" && (
                      <div className="p-3 rounded-lg border text-[11px] leading-relaxed" style={{ background: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)", color: "var(--cs-text-warning)" }}>
                        <span className="font-bold block uppercase text-[9px] mb-1 tracking-wider">ML Model Offline:</span>
                        P2Rank machine learning service is currently offline. Pocket affinity scores and cavity volumes are unavailable. Utilizing sequence-based functional proximity heuristics.
                      </div>
                    )}

                    <div className="p-3.5 rounded-xl border space-y-2.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium font-sans text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>Likely Co-Factor / Target Ligand:</span>
                        <span className="font-semibold font-mono text-[12px]" style={{ color: "var(--cs-text-primary)" }}>{computedPocket.likelyCofactor}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium font-sans text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>Spatial Classification:</span>
                        <span className="badge-data-source">
                          {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance <= 8.0
                            ? "ACTIVE_SITE_PROXIMATE"
                            : "DISTAL_SURFACE"}
                        </span>
                      </div>
                    </div>

                    {computedPocket.pocketResidues && computedPocket.pocketResidues.length > 0 && (
                      <div className="space-y-2 mt-3.5">
                        <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
                          Pocket Lining Residues (Top 7)
                        </h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {computedPocket.pocketResidues.slice(0, 7).map((res: any, idx: number) => (
                            <div key={idx} className="p-2.5 px-3.5 rounded-lg flex justify-between items-center transition-all border border-[var(--cs-border)] bg-[var(--cs-bg-subtle)] shadow-none">
                              <span style={{ fontSize: "var(--cs-font-size-numeric)", fontFamily: "var(--cs-font-mono)", fontWeight: "var(--cs-font-weight-semibold)", color: "var(--cs-text-primary)" }}>{res.name}{res.index}</span>
                              <span style={{ fontSize: "var(--cs-font-size-caption)", fontFamily: "var(--cs-font-mono)", color: "var(--cs-text-muted)" }}>Dist: {res.distance} Å</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-state-box">
                    No active pocket computations found. Click 3D coordinates on the model to trigger solver.
                  </div>
                )}

                {/* UniProt Curated Features */}
                {(() => {
                  const features = result.uniprotFeatures?.features ?? [];
                  const pos = result.metadata?.residueIndex;
                  if (pos === null || pos === undefined) return null;

                  const matchingFeatures = features.filter(
                    (f) => pos >= f.start && pos <= f.end
                  );

                  return (
                    <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <h4 className="text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
                        UniProt Curated Site & Interface Annotations
                      </h4>

                      {matchingFeatures.length > 0 ? (
                        <div className="space-y-2">
                          {matchingFeatures.map((f, idx) => {
                            let badgeColor = "badge-metric-neutral";

                            return (
                              <div
                                key={idx}
                                className="p-3 rounded-lg border leading-relaxed text-xs shadow-sm transition-all"
                                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono uppercase ${badgeColor}`}>
                                    {f.type}
                                  </span>
                                  <span className="text-[10px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                                    Residue {f.start === f.end ? f.start : `${f.start}-${f.end}`}
                                  </span>
                                </div>
                                <p className="mt-1.5 text-xs font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                                  {f.description || "Curated functional feature at this site."}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="empty-state-box">
                          No curated UniProt functional features (active sites, metal bindings, interface regions) recorded at residue {pos}.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === "interactions" && (
          <div className="space-y-4">
            <div>
              <h1 className="screen-title">Interactions</h1>
              <p className="screen-tab-description">Top functional protein-protein interaction partners and confidence scores from STRING DB.</p>
            </div>
            
            {(() => {
              const interactions = result.stringInteractions;
              if (interactions && interactions.length > 0) {
                return (
                  <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
                    <div className="overflow-x-auto">
                      <table className="w-full font-sans border-collapse">
                        <thead>
                          <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                            <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left w-1/3 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Associated Partner</th>
                            <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-1/3 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Score</th>
                            <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-1/3" style={{ color: "var(--cs-text-secondary)" }}>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {interactions.map((partner, pIdx) => {
                            const pct = (partner.score * 100).toFixed(0);
                            const isHigh = partner.score >= 0.7;
                            return (
                              <tr key={pIdx} className="hover:bg-[var(--cs-bg-subtle)] transition-colors" style={{ color: "var(--cs-text-primary)", borderBottom: pIdx < interactions.length - 1 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                                <td className="p-3 px-4 text-[12px] font-semibold text-left w-1/3 border-r border-[var(--cs-border-subtle)]">
                                  <span style={{ color: "var(--cs-text-primary)" }}>{partner.partner}</span>
                                </td>
                                <td className="p-3 px-4 text-center font-mono text-[12px] w-1/3 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>
                                  {partner.score.toFixed(3)}
                                </td>
                                <td className="p-3 px-4 text-center w-1/3">
                                  <div className="inline-flex items-center justify-center gap-2 w-full">
                                    <span className="font-mono text-xs" style={{ color: "var(--cs-text-secondary)" }}>{pct}%</span>
                                    <span className="badge-data-source">
                                      {isHigh ? "High" : "Medium"}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              }
              return (
                <div className="empty-state-box">
                  No STRING DB interaction partners found for gene {result.metadata?.gene}.
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "guidelines" && (
          <div className="space-y-4">
            <div>
              <h1 className="screen-title">Threshold Guide</h1>
              <p className="screen-tab-description">ACMG/AMP evidence code thresholds for each computational predictor, with live match highlighting for the current variant.</p>
            </div>
            
            {/* Dynamic Alert Banner */}
            {(() => {
              const revel = result.conservationData?.revel ?? null;
              const ddG = foldingDdG;
              let statusStyle = {};
              let statusText = "CONCORDANCE UNCERTAIN";
              let statusDesc = "The scores and stability changes fall into intermediate ranges or present conflicting evidence, requiring further functional validation.";
              
              if (revel !== null && revel >= 0.75 && ddG !== null && ddG > 1.5) {
                statusText = "Destabilization + Conservation Concordant (High Risk)";
                statusStyle = { color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "var(--cs-text-danger)" };
                statusDesc = "Both sequence-based conservation (REVEL >= 0.75) and structural energetics (FoldX ddG > 1.5 kcal/mol) suggest severe risk of loss-of-function due to misfolding. NOTE: Destabilization ≠ Pathogenicity; some pathogenic variants (e.g. gain-of-function or neomorphic) do not cause structural destabilization.";
              } else if ((revel !== null && revel >= 0.5) || (ddG !== null && ddG > 1.5)) {
                statusText = "MODERATE-RISK CONCORDANCE (Pathogenic / Destabilizing Support)";
                statusStyle = { color: "var(--cs-text-warning)", backgroundColor: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)" };
                statusDesc = "At least one biophysical indicator (REVEL >= 0.5 or FoldX ddG > 0.5 kcal/mol) shows significant aberration, suggesting functional or structural impact.";
              } else if (revel !== null && revel < 0.15 && ddG !== null && ddG < 0.5 && ddG > -0.5) {
                statusText = "LOW-RISK CONCORDANCE (Likely Benign / Tolerated)";
                statusStyle = { color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "var(--cs-text-success)" };
                statusDesc = "Consensus indicators fall within benign boundaries. The variant is structurally neutral and evolutionary conservation does not suggest strict constraint.";
              } else {
                statusStyle = { color: "var(--cs-text-secondary)", backgroundColor: "var(--cs-surface-2)", borderColor: "var(--cs-border)" };
              }
              
              return (
                <div className="p-3 rounded-lg border leading-relaxed text-xs" style={statusStyle}>
                  <div className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{statusText}</span>
                  </div>
                  <p className="mt-1 text-[10px] opacity-90">{statusDesc}</p>
                </div>
              );
            })()}

            {/* Threshold Table */}
            <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
              <div className="overflow-x-auto">
                <table className="w-full font-sans border-collapse">
                  <thead>
                    <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                      <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Assay / Metric</th>
                      <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Score</th>
                      <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Benign ≤</th>
                      <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Pathogenic ≥</th>
                      <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>ACMG Code</th>
                      <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center" style={{ color: "var(--cs-text-secondary)" }}>Match</th>
                    </tr>
                  </thead>
                <tbody>
                  {(() => {
                    const caddVal = result.predictorData?.caddPhred ?? null;
                    const revelVal = result.conservationData?.revel ?? null;
                    const amVal = result.predictorData?.amPathogenicity ?? null;
                    const amCls = result.predictorData?.amClass ?? null;
                    const eveVal = result.predictorData?.eveScore ?? result.conservationData?.popeve ?? null;
                    const eveCls = result.predictorData?.eveClass ?? null;
                    const bayesdelVal = result.conservationData?.bayesdel ?? null;
                    const metarnnVal = result.conservationData?.metarnn ?? null;
                    const clinpredVal = result.conservationData?.clinpred ?? null;
                    const eigenVal = result.conservationData?.eigenPhred ?? null;
                    const dannVal = result.conservationData?.dann ?? null;
                    const popeveVal = result.conservationData?.popeve ?? null;
                    const esmVal = result.conservationData?.esm1b ?? null;

                    const foldxVal = foldingDdG ?? null;
                    const dynamut2Val = result.dynamut2 ?? foldingEnergetics?.dynamut2 ?? null;
                    const ddmutVal = result.ddmut ?? foldingEnergetics?.ddmut ?? null;
                    const ddgunVal = foldingEnergetics?.ddgun ?? null;
                    const raspVal = result.rasp ?? foldingEnergetics?.rasp ?? null;

                    const gerpVal = result.conservationData?.gerp ?? null;
                    const phylopVal = result.conservationData?.phylop ?? null;
                    const misZVal = (result as any)?.misZ ?? (result as any)?.gnomadMisZ ?? null;
                    const loeufVal = (result as any)?.loeuf ?? (result as any)?.gnomadLoeuf ?? null;

                    const renderCategoryHeader = (catKey: string, catTitle: string) => (
                      <tr key={catKey} className="bg-[var(--cs-surface-2)]">
                        <td colSpan={6} className="p-2 px-4 text-[10.5px] font-bold uppercase tracking-wider text-left border-b border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-accent-clay)" }}>
                          {catTitle}
                        </td>
                      </tr>
                    );

                    const renderRow = (
                      key: string,
                      name: string,
                      val: number | null | undefined,
                      valDisplay: string,
                      benignText: string,
                      pathText: string,
                      acmgCode: string,
                      status: "path_strong" | "path" | "benign" | "neutral" | "vus" | "none",
                      matchBadgeLabel: string
                    ) => {
                      const isPath = status === "path_strong" || status === "path";
                      const isBenign = status === "benign";
                      const codes = acmgCode.split('/');
                      const pathCode = codes[0]?.trim() || acmgCode;
                      const benignCode = codes[1]?.trim() || acmgCode;

                      return (
                        <tr key={key} className="hover:bg-[var(--cs-bg-subtle)] transition-colors" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                          <td className="p-3 px-4 text-[12px] font-semibold text-left border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>{name}</td>
                          <td className="p-3 px-4 text-center font-mono text-[12px] border-r border-[var(--cs-border-subtle)]">{val !== null && val !== undefined ? valDisplay : "—"}</td>
                          <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-muted)" }}>{benignText}</td>
                          <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-muted)" }}>{pathText}</td>
                          <td className="p-3 px-4 text-center font-bold font-mono text-xs border-r border-[var(--cs-border-subtle)]">
                            {isPath ? (
                              <span className="px-2 py-0.5 rounded border font-bold" style={{ color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "var(--cs-text-danger)" }}>{pathCode}</span>
                            ) : isBenign ? (
                              <span className="px-2 py-0.5 rounded border font-bold" style={{ color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "var(--cs-text-success)" }}>{benignCode}</span>
                            ) : (
                              <span className="opacity-40" style={{ color: "var(--cs-text-muted)" }}>{acmgCode}</span>
                            )}
                          </td>
                          <td className="p-3 px-4 text-center">
                            {val !== null && val !== undefined ? (
                              <span className="badge-data-source">{matchBadgeLabel}</span>
                            ) : (
                              <span style={{ color: "var(--cs-text-muted)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    };

                    const rows: React.ReactNode[] = [];

                    // --- CATEGORY 1: In-Silico Pathogenicity Predictors ---
                    rows.push(renderCategoryHeader("cat-path", "1. In-Silico Pathogenicity & Machine Learning"));

                    // REVEL
                    const revelStatus = revelVal !== null ? (revelVal >= 0.75 ? "path_strong" : revelVal >= 0.5 ? "path" : revelVal < 0.15 ? "benign" : "vus") : "none";
                    rows.push(renderRow("revel", "REVEL", revelVal, revelVal?.toFixed(3) ?? "—", "< 0.15", ">= 0.50 (strong >= 0.75)", "PP3 / BP4", revelStatus, revelStatus === "path_strong" ? "Strong Path." : revelStatus === "path" ? "Path. Supp." : revelStatus === "benign" ? "Benign" : "VUS"));

                    // AlphaMissense
                    const amStatus = (amCls?.toLowerCase().includes("pathogenic") || (amVal !== null && amVal >= 0.983)) ? "path_strong" : (amCls?.toLowerCase().includes("benign") || (amVal !== null && amVal <= 0.063)) ? "benign" : "vus";
                    rows.push(renderRow("am", "AlphaMissense", amVal, amVal?.toFixed(3) ?? "—", "<= 0.063", ">= 0.983 (supp >= 0.564)", "PP3 / BP4", amVal !== null || amCls !== null ? amStatus : "none", amStatus === "path_strong" ? "Pathogenic" : amStatus === "benign" ? "Benign" : "VUS"));

                    // CADD
                    const caddStatus = caddVal !== null ? (caddVal >= 25 ? "path_strong" : caddVal >= 20 ? "path" : caddVal <= 10 ? "benign" : "vus") : "none";
                    rows.push(renderRow("cadd", "CADD PHRED", caddVal, caddVal?.toFixed(1) ?? "—", "<= 10.0", ">= 20.0 (strong >= 25)", "PP3 / BP4", caddStatus, caddStatus === "path_strong" ? "Strong Path." : caddStatus === "path" ? "Path. Supp." : caddStatus === "benign" ? "Benign" : "Moderate"));

                    // BayesDel
                    const bayesdelStatus = bayesdelVal !== null ? (bayesdelVal >= 0.133 ? "path" : bayesdelVal <= -0.0404 ? "benign" : "vus") : "none";
                    rows.push(renderRow("bayesdel", "BayesDel (noAF)", bayesdelVal, bayesdelVal?.toFixed(3) ?? "—", "<= -0.0404", ">= 0.133", "PP3 / BP4", bayesdelStatus, bayesdelStatus === "path" ? "Pathogenic" : bayesdelStatus === "benign" ? "Benign" : "VUS"));

                    // MetaRNN
                    const metarnnStatus = metarnnVal !== null ? (metarnnVal >= 0.5 ? "path" : "benign") : "none";
                    rows.push(renderRow("metarnn", "MetaRNN", metarnnVal, metarnnVal?.toFixed(3) ?? "—", "< 0.50", ">= 0.50", "PP3 / BP4", metarnnStatus, metarnnStatus === "path" ? "Deleterious" : "Tolerated"));

                    // ClinPred
                    const clinpredStatus = clinpredVal !== null ? (clinpredVal >= 0.5 ? "path" : "benign") : "none";
                    rows.push(renderRow("clinpred", "ClinPred", clinpredVal, clinpredVal?.toFixed(3) ?? "—", "< 0.50", ">= 0.50", "PP3 / BP4", clinpredStatus, clinpredStatus === "path" ? "Deleterious" : "Tolerated"));

                    // Eigen
                    const eigenStatus = eigenVal !== null ? (eigenVal >= 4.0 ? "path" : "benign") : "none";
                    rows.push(renderRow("eigen", "Eigen PHRED", eigenVal, eigenVal?.toFixed(1) ?? "—", "< 4.0", ">= 4.0", "PP3 / BP4", eigenStatus, eigenStatus === "path" ? "Pathogenic" : "Benign"));

                    // DANN
                    const dannStatus = dannVal !== null ? (dannVal >= 0.96 ? "path" : dannVal <= 0.5 ? "benign" : "vus") : "none";
                    rows.push(renderRow("dann", "DANN", dannVal, dannVal?.toFixed(3) ?? "—", "<= 0.50", ">= 0.96", "PP3 / BP4", dannStatus, dannStatus === "path" ? "Pathogenic" : dannStatus === "benign" ? "Benign" : "Moderate"));

                    // popEVE
                    const popeveStatus = popeveVal !== null ? (popeveVal < 0 ? (popeveVal <= -4.617 ? "path_strong" : popeveVal <= -2.0 ? "path" : popeveVal >= -1.0 ? "benign" : "vus") : (popeveVal >= 0.75 ? "path_strong" : popeveVal <= 0.25 ? "benign" : "vus")) : "none";
                    rows.push(renderRow("popeve", "popEVE", popeveVal, popeveVal?.toFixed(3) ?? "—", "<= 0.25 (LLR >= -1.0)", ">= 0.75 (LLR <= -4.617 severe)", "PP3 / BP4", popeveStatus, popeveStatus === "path_strong" ? "Severe Path." : popeveStatus === "path" ? "Pathogenic" : popeveStatus === "benign" ? "Benign" : "VUS"));

                    // ESM-1b / VESM
                    const esmStatus = esmVal !== null ? (esmVal <= -5.0 ? "path" : esmVal >= -2.0 ? "benign" : "vus") : "none";
                    rows.push(renderRow("esm", "ESM-1b (VESM)", esmVal, esmVal?.toFixed(2) ?? "—", ">= -2.0", "<= -5.0", "Info / -", esmStatus, esmStatus === "path" ? "Deleterious" : esmStatus === "benign" ? "Tolerated" : "Neutral"));

                    // --- CATEGORY 2: Biophysical & Structural Energetics ---
                    rows.push(renderCategoryHeader("cat-biophys", "2. Biophysical & Structural Energetics"));

                    // FoldX
                    const foldxStatus = foldxVal !== null ? (foldxVal > 1.5 ? "path_strong" : foldxVal > 0.5 ? "path" : foldxVal >= -0.5 ? "benign" : "neutral") : "none";
                    rows.push(renderRow("foldx", "FoldX ΔΔG", foldxVal, foldxVal ? `${foldxVal.toFixed(2)} kcal/mol` : "—", "-0.5 to +0.5", "> 0.50 (severe > 1.50)", "PM1 / BP3", foldxStatus, foldxStatus === "path_strong" ? "Severe Destab." : foldxStatus === "path" ? "Destab." : foldxStatus === "benign" ? "Neutral" : "Stabilizing"));

                    // DynaMut2
                    const dynamut2Status = dynamut2Val !== null ? (dynamut2Val <= -1.0 ? "path" : "benign") : "none";
                    rows.push(renderRow("dynamut2", "DynaMut2 ΔΔG", dynamut2Val, dynamut2Val ? `${dynamut2Val.toFixed(2)} kcal/mol` : "—", "> -1.0", "<= -1.0 kcal/mol", "PM1 / BP3", dynamut2Status, dynamut2Status === "path" ? "Destabilizing" : "Neutral"));

                    // DDMut
                    const ddmutStatus = ddmutVal !== null ? (ddmutVal <= -1.0 ? "path" : "benign") : "none";
                    rows.push(renderRow("ddmut", "DDMut ΔΔG", ddmutVal, ddmutVal ? `${ddmutVal.toFixed(2)} kcal/mol` : "—", "> -1.0", "<= -1.0 kcal/mol", "PM1 / BP3", ddmutStatus, ddmutStatus === "path" ? "Destabilizing" : "Neutral"));

                    // DDGun-Seq
                    const ddgunStatus = ddgunVal !== null ? (ddgunVal <= -1.0 ? "path" : "benign") : "none";
                    rows.push(renderRow("ddgun", "DDGun-Seq ΔΔG", ddgunVal, ddgunVal ? `${ddgunVal.toFixed(2)} kcal/mol` : "—", "> -1.0", "<= -1.0 kcal/mol", "PM1 / BP3", ddgunStatus, ddgunStatus === "path" ? "Destabilizing" : "Neutral"));

                    // RaSP
                    const raspStatus = raspVal !== null ? (raspVal > 0.5 ? "path" : "benign") : "none";
                    rows.push(renderRow("rasp", "RaSP ΔΔG", raspVal, raspVal ? `${raspVal.toFixed(2)} kcal/mol` : "—", "-0.5 to +0.5", "> 0.50 kcal/mol", "PM1 / BP3", raspStatus, raspStatus === "path" ? "Destabilizing" : "Neutral"));

                    // --- CATEGORY 3: Evolutionary Conservation & Population Constraint ---
                    rows.push(renderCategoryHeader("cat-cons", "3. Evolutionary Conservation & Population Intolerance"));

                    // GERP++
                    const gerpStatus = gerpVal !== null ? (gerpVal >= 2.0 ? "path" : "benign") : "none";
                    rows.push(renderRow("gerp", "GERP++ RS", gerpVal, gerpVal?.toFixed(2) ?? "—", "< 2.00", ">= 2.00 (conserved)", "PP3 / BP4", gerpStatus, gerpStatus === "path" ? "Conserved" : "Neutral"));

                    // phyloP 100-way
                    const phylopStatus = phylopVal !== null ? (phylopVal >= 1.5 ? "path" : "benign") : "none";
                    rows.push(renderRow("phylop", "phyloP 100-way", phylopVal, phylopVal?.toFixed(2) ?? "—", "< 1.50", ">= 1.50 (conserved)", "PP3 / BP4", phylopStatus, phylopStatus === "path" ? "Conserved" : "Variable"));

                    // Missense Z
                    const misZStatus = misZVal !== null ? (misZVal >= 3.09 ? "path_strong" : misZVal >= 2.0 ? "path" : "benign") : "none";
                    rows.push(renderRow("misZ", "gnomAD Missense Z", misZVal, misZVal?.toFixed(2) ?? "—", "< 2.00", ">= 2.00 (strong >= 3.09)", "PP2 / BP1", misZStatus, misZStatus === "path_strong" ? "Depleted (Strong)" : misZStatus === "path" ? "Constrained" : "Unconstrained"));

                    // LOEUF
                    const loeufStatus = loeufVal !== null ? (loeufVal < 0.35 ? "path_strong" : loeufVal < 0.60 ? "path" : "benign") : "none";
                    rows.push(renderRow("loeuf", "gnomAD LOEUF", loeufVal, loeufVal?.toFixed(2) ?? "—", ">= 0.60", "< 0.35 (mod < 0.60)", "PP2 / BP1", loeufStatus, loeufStatus === "path_strong" ? "Severe Intolerant" : loeufStatus === "path" ? "Mod. Intolerant" : "Tolerated"));

                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>

            <div className="p-3 rounded-lg border text-[12px] font-sans leading-relaxed shadow-sm" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
              <h5 className="font-bold text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: "var(--cs-text-primary)" }}>ACMG/AMP Evidence Codes Key:</h5>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>PP3 (Pathogenic Supporting)</strong> {"/"} <strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>BP4 (Benign Supporting)</strong>: Computational algorithms predict a deleterious/neutral effect on the protein.</li>
                <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>PM1 (Pathogenic Moderate)</strong>: Mutational hot-spot or critical functional domain (e.g. binding pocket interface) without benign variation.</li>
                <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>BP3 (Benign Supporting)</strong>: In-frame deletion/insertion in a repetitive region, or structurally neutral substitution.</li>
              </ul>
            </div>
          </div>
        )}

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
                    <h3 className="text-base font-black tracking-tight mt-0.5 text-left">
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
                <div className="space-y-3 text-xs leading-relaxed text-left">
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

                  <div className="pt-2 border-t animate-fade-in" style={{ borderColor: "var(--cs-border-subtle)" }}>
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
                    className="px-4 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer hover:bg-[var(--cs-bg-subtle)]"
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
    </div>
  );
}

