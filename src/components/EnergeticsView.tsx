import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { 
  Activity, 
  Info,
  ExternalLink,
  Circle,
  Database,
  FlaskConical,
  ArrowRight
} from "lucide-react";
import { AnalysisState, EnergeticsData, StructureProvenance } from "../types";
import { useSettings } from "../context/SettingsContext";
import { computeCalibratedConsensus, calibrateRawScore } from "../shared/thresholds";
import { requestInspectorFocus, INSPECTOR_SECTIONS } from "../lib/inspectorFocus";
import {
  buildEngineOutcomes,
  describeCoverage,
  describeProvenance,
  formatDdg,
  formatDdgPair,
  summarizeCoverage,
  type EnergyEngineId,
  type EngineOutcome,
  type EngineTone,
  type ProvenanceSource,
} from "../shared/engineStatus";

const TONE_DOT: Record<EngineTone, string> = {
  good: "var(--cs-text-success)",
  warn: "var(--cs-text-warning)",
  danger: "var(--cs-text-danger)",
  neutral: "var(--cs-text-muted)",
  muted: "var(--cs-border)",
};

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
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; negative scores represent stabilizing variants. (Normalized: DynaMut2 natively reports negative values for destabilization, but values in this explorer are normalized so positive = destabilizing).",
    paperTitle: "Rodrigues et al. Bioinformatics (2020)",
    paperUrl: "https://doi.org/10.1093/bioinformatics/btaa784"
  },
  ddmut: {
    name: "DDMut (Deep Learning)",
    category: "Graph Deep Learning / Transformers",
    description: "DDMut uses a Siamese neural network combining graph-based structural representations, convolutional layers, and Transformer encoders to predict free energy changes (ΔΔG) for single and multiple point mutations.",
    interpretation: "ΔΔG ≥ +1.0 kcal/mol indicates structural destabilization; negative scores represent stabilizing variants. (Normalized: DDMut natively reports negative values for destabilization, but values in this explorer are normalized so positive = destabilizing).",
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

interface SimulationProgressBannerProps {
  onHidePendingEngines: () => void;
}

const getSimulationStage = (elapsed: number) => {
  if (elapsed < 12) return { stage: 1, label: "Queued", detail: "Worker scheduled & PDB coordinates validated" };
  if (elapsed < 40) return { stage: 2, label: "NMA / Graph Embedding", detail: "Computing normal mode elastic network & graph convolutions" };
  if (elapsed < 75) return { stage: 3, label: "Scoring & Repacking", detail: "Running atomic force field minimization & stability head" };
  return { stage: 4, label: "Finalizing", detail: "Aggregating calibrated multi-tool consensus" };
};

const SimulationProgressBanner = memo(function SimulationProgressBanner({
  onHidePendingEngines
}: SimulationProgressBannerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const current = getSimulationStage(elapsedSeconds);
  const stages = [
    { id: 1, name: "Queued" },
    { id: 2, name: "NMA / Embedding" },
    { id: 3, name: "Force Field Repack" },
    { id: 4, name: "Scoring" }
  ];

  return (
    <div className="p-4 rounded-xl border space-y-3 animate-fade-in" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-xs uppercase flex items-center gap-2">
          <Activity className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--cs-accent-clay)" }} />
          <span>Biophysical Simulation In Progress</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border)]" style={{ color: "var(--cs-accent-clay)" }}>
            Elapsed: {elapsedSeconds}s
          </span>
          {elapsedSeconds >= 45 && (
            <button
              type="button"
              onClick={onHidePendingEngines}
              title="Collapses the still-running rows so the settled results are easier to read. This does not cancel or skip any calculation."
              className="text-[11px] px-2.5 py-1 rounded-md font-semibold border transition-colors cursor-pointer"
              style={{
                background: "var(--cs-bg-warning)",
                borderColor: "var(--cs-border)",
                color: "var(--cs-text-warning)",
              }}
            >
              Hide pending engines
            </button>
          )}
        </div>
      </div>

      {/* Stage Indicator Stepper */}
      <div className="space-y-1.5 pt-1">
        <div className="grid grid-cols-4 gap-2 text-center">
          {stages.map((st) => {
            const isActive = current.stage === st.id;
            const isPast = current.stage > st.id;
            return (
              <div
                key={st.id}
                className={`text-[10px] font-mono py-1 px-1 rounded border transition-all ${
                  isActive
                    ? "bg-[var(--cs-accent-clay)] text-white border-[var(--cs-accent-clay)] font-bold animate-pulse"
                    : isPast
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-medium"
                    : "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border-[var(--cs-border-subtle)] opacity-60"
                }`}
              >
                {st.id}. {st.name}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-400 font-sans italic">
          Current stage: <span className="font-medium text-[var(--cs-text-primary)]">{current.detail}</span>
        </p>
      </div>
    </div>
  );
});

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
  /**
   * Presentation-only: collapses the rows of engines that are still running.
   *
   * This deliberately cannot change the engine count or the consensus framing. It previously
   * could — the old "Skip Slow Predictors" control only relabelled rows as "Skipped by User"
   * while the requests kept running, and it removed those engines from the pending list, so
   * clicking a button that did nothing changed the reported method count.
   */
  const [hidePendingEngines, setHidePendingEngines] = useState(false);
  const handleHidePendingEngines = useCallback(() => setHidePendingEngines(true), []);
  const { settings } = useSettings();
  const energyUnit = settings.energyUnit;
  const result = analysisState.result;

  /**
   * Severity → surface styling.
   *
   * Uses the theme's semantic tokens rather than raw palette classes. The previous hand-mixed
   * amber/slate tints were fixed to the dark surface: they failed AA in light mode and the
   * gauge vanished entirely in dark. `--cs-text-danger-on-soft` is the token the stylesheet
   * documents for text on a danger tint.
   */
  const toneBadgeClass = (tone: EngineTone) => {
    switch (tone) {
      case "good":
        return "bg-[var(--cs-bg-success)] text-[var(--cs-text-success)] border border-[var(--cs-border)]";
      case "warn":
        return "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-[var(--cs-border)]";
      case "danger":
        return "bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger-on-soft)] border border-[var(--cs-border)]";
      case "muted":
        return "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)]";
      case "neutral":
      default:
        return "bg-[var(--cs-surface-2)] text-[var(--cs-text-secondary)] border border-[var(--cs-border)]";
    }
  };

  if (!result) {
    return (
      <div className={`${classCard} overflow-hidden flex flex-col transition-all h-full`} id="energetics-view">
        <div className="px-5 py-3 border-b border-cs-border-subtle flex items-center justify-between bg-cs-surface flex-shrink-0 min-h-[52px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-cs-accent-clay/10 text-cs-accent-clay shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xs font-bold font-sans text-cs-text-primary tracking-tight">Energetics</h1>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cs-surface-2 text-cs-text-muted border border-cs-border-subtle">ΔΔG Stability</span>
              </div>
              <p className="text-[10.5px] font-sans text-cs-text-muted truncate">
                Multi-engine free-energy estimation (positive ΔΔG = predicted structural destabilization)
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 flex-grow flex flex-col justify-center text-center py-12">
          <Activity className="w-10 h-10 mx-auto stroke-[1.5] mb-2 animate-pulse" style={{ color: "var(--cs-accent-clay)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--cs-text-muted)" }}>Submit a variant query to calculate biophysical stability metrics.</p>
        </div>
      </div>
    );
  }

  const uniprotFeatures = result?.uniprotFeatures?.features;
  const residueIndex = result?.metadata?.residueIndex ?? 0;
  const foldxDdG = foldingEnergetics?.foldx ?? foldingDdG;
  const foldxMeanVal = foldingEnergetics?.foldxMean ?? foldingDdG;
  // Absent diagnostics stay `null`. They were previously coerced to 0, which made the FoldX row
  // assert "± 0.00 kcal/mol" (perfect reproducibility across five runs) from data that was
  // simply missing, and made "measured zero" indistinguishable from "not measured".
  const foldxSd = foldingEnergetics?.foldxSd ?? null;
  const vdw = foldingEnergetics?.vdw ?? null;
  const electrostatics = foldingEnergetics?.electrostatics ?? null;
  const stericClashWarning = foldingEnergetics?.stericClashWarning ?? false;
  const localSidechainRmsd = foldingEnergetics?.localSidechainRmsd ?? null;
  const dynamut2 = foldingEnergetics?.dynamut2 ?? null;
  const ddmut = foldingEnergetics?.ddmut ?? null;
  const rasp = foldingEnergetics?.rasp ?? null;
  const thermompnn = foldingEnergetics?.thermompnn ?? null;
  const stabilityoracle = foldingEnergetics?.stabilityoracle ?? null;
  const bayesdel = result?.conservationData?.bayesdel ?? null;
  const consensusVerdict = foldingEnergetics?.consensusVerdict ?? null;
  const raspReason = (foldingEnergetics as any)?.raspReason;
  const foldxRepairFailed = foldingEnergetics?.foldxRepairFailed ?? false;
  const foldxBinaryMissing = (foldingEnergetics as any)?.foldxBinaryMissing ?? false;

  const energetics = useMemo(() => ({
    foldx: foldxDdG,
    foldxMean: foldxMeanVal,
    foldxSd,
    vdw,
    electrostatics,
    stericClashWarning,
    localSidechainRmsd,
    dynamut2,
    ddmut,
    rasp,
    thermompnn,
    stabilityoracle,
    bayesdel,
    consensusVerdict,
    raspReason,
    foldxRepairFailed,
    foldxBinaryMissing
  }), [
    foldxDdG, foldxMeanVal, foldxSd, vdw, electrostatics, stericClashWarning,
    localSidechainRmsd, dynamut2, ddmut, rasp, thermompnn, stabilityoracle,
    bayesdel, consensusVerdict, raspReason, foldxRepairFailed, foldxBinaryMissing
  ]);

  const calConsensus = useMemo(() => {
    return computeCalibratedConsensus(energetics, uniprotFeatures, residueIndex, disruptionPredictor?.plddt);
  }, [energetics, uniprotFeatures, residueIndex, disruptionPredictor?.plddt]);

  /**
   * Canonical engine outcomes — the ONE place raw runtime facts become user-facing state.
   *
   * The interpretation itself lives in `buildEngineOutcomes` so the inspector renders from the
   * same rules; this component only supplies the facts it already holds.
   */
  const engineOutcomes = useMemo(
    () =>
      buildEngineOutcomes({
        foldxMean: foldxMeanVal,
        foldxDdg: foldxDdG,
        foldxSd,
        dynamut2,
        ddmut,
        rasp,
        thermompnn,
        stabilityoracle,
        dynamut2Status,
        ddmutStatus,
        thermompnnStatus,
        raspReason,
        thermompnnError,
        foldingError,
        foldingStatus,
        foldxRepairFailed,
        foldxBinaryMissing,
        isFolding,
        hidePending: hidePendingEngines,
      }),
    [
      foldxMeanVal, foldxDdG, foldxSd, dynamut2, ddmut, rasp, thermompnn, stabilityoracle,
      dynamut2Status, ddmutStatus, thermompnnStatus, raspReason, thermompnnError, foldingError,
      foldingStatus, foldxRepairFailed, foldxBinaryMissing, isFolding, hidePendingEngines,
    ]
  );

  /** Coverage is computed once, from the same outcomes the table renders. */
  const coverage = useMemo(() => summarizeCoverage(engineOutcomes), [engineOutcomes]);

  /** Engines still running — drives the "Calculating" note, from the same source as the table. */
  const pendingToolNames = useMemo(
    () =>
      coverage.running
        .map(id => engineOutcomes.find(o => o.id === id)?.engine.name)
        .filter((name): name is string => Boolean(name)),
    [coverage.running, engineOutcomes]
  );

  /**
   * Raw provider values, keyed by engine.
   *
   * The calibration curves in `stacking_config.json` are fitted in each provider's NATIVE sign
   * convention, so they must be fed the raw value — while every *display* goes through
   * `formatDdg(canonicalDdg)`. Keeping both, explicitly named, is what stops the two conventions
   * from leaking into each other again.
   */
  const rawByEngine: Record<EnergyEngineId, number | null | undefined> = useMemo(
    () => ({
      foldx: foldxMeanVal ?? foldxDdG,
      dynamut2,
      ddmut,
      rasp,
      thermompnn,
      stabilityoracle,
    }),
    [foldxMeanVal, foldxDdG, dynamut2, ddmut, rasp, thermompnn, stabilityoracle]
  );

  const calibratedBreakdownRows = useMemo(() => {
    return engineOutcomes
      .filter(o => o.contributesToConsensus && o.canonicalDdg !== null)
      .map(o => {
        const raw = rawByEngine[o.id] ?? null;
        const cal = raw === null ? null : calibrateRawScore(o.id, raw);
        return cal ? { outcome: o, cal } : null;
      })
      .filter((row): row is { outcome: EngineOutcome; cal: NonNullable<ReturnType<typeof calibrateRawScore>> } => row !== null);
  }, [engineOutcomes, rawByEngine]);

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all h-full font-mono text-xs`} id="energetics-view" role="region" aria-label="Biophysical Energetics Analysis">
      <div className="px-5 py-3 border-b border-cs-border-subtle flex items-center justify-between bg-cs-surface flex-shrink-0 min-h-[52px]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-cs-accent-clay/10 text-cs-accent-clay shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-bold font-sans text-cs-text-primary tracking-tight">Energetics</h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cs-surface-2 text-cs-text-muted border border-cs-border-subtle">ΔΔG Stability</span>
            </div>
            <p className="text-[10.5px] font-sans text-cs-text-muted truncate">
              Multi-engine free-energy estimation (positive ΔΔG = predicted structural destabilization)
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 flex-grow overflow-y-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="font-bold text-xs uppercase tracking-wider font-mono text-cs-accent-clay">
            Consensus Biophysical Stability (ΔΔG)
          </h4>

          {/* ── Structure Provenance Inline Badge ──────────────────────────────── */}
          {foldingEnergetics?.structureProvenance && !isFolding && (
            (() => {
              const prov: StructureProvenance = foldingEnergetics.structureProvenance!;
              // Provenance labels come from the shared contract. Previously a `client-provided`
              // structure fell through to "AlphaFold Prediction" — a false claim about the very
              // template the FoldX number depends on.
              const provView = describeProvenance(prov.source as ProvenanceSource, {
                pdbId: prov.pdbId,
                resolution: prov.resolution,
                identity: prov.identity,
              });
              const isTemplate = provView.isTemplate;
              const isHomolog = prov.source === "homolog";
              const label = provView.label;
              const methodClean = prov.method
                ? prov.method.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                : null;
              return (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono animate-fade-in shadow-xs"
                  style={{
                    background: isTemplate
                      ? "color-mix(in srgb, var(--cs-bg-success) 20%, var(--cs-surface-2))"
                      : "var(--cs-surface-2)",
                    borderColor: isTemplate
                      ? "color-mix(in srgb, var(--cs-text-success) 35%, var(--cs-border))"
                      : "var(--cs-border-subtle)"
                  }}
                  title="Structure template used for FoldX ΔΔG computation"
                >
                  {isTemplate
                    ? <Database className="w-3 h-3 shrink-0" style={{ color: "var(--cs-text-success)" }} />
                    : <FlaskConical className="w-3 h-3 shrink-0" style={{ color: "var(--cs-text-muted)" }} />
                  }
                  <span className="font-semibold" style={{ color: isTemplate ? "var(--cs-text-success)" : "var(--cs-text-secondary)" }}>
                    {label}
                  </span>
                  {prov.pdbId && (
                    <a
                      href={`https://www.rcsb.org/structure/${prov.pdbId.toUpperCase()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border font-bold uppercase hover:opacity-80 transition-opacity"
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
                    <span style={{ color: "var(--cs-text-muted)" }}>• {methodClean}</span>
                  )}
                  {prov.resolution != null && (
                    <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>
                      {prov.resolution.toFixed(1)} Å
                    </span>
                  )}
                  {isHomolog && prov.identity != null && (
                    <span style={{ color: "var(--cs-text-muted)" }}>
                      ({prov.identity.toFixed(0)}% id)
                    </span>
                  )}
                </div>
              );
            })()
          )}
        </div>
        {/* ─────────────────────────────────────────────────────────────────── */}

        {isFolding && !hidePendingEngines && (
          <SimulationProgressBanner onHidePendingEngines={handleHidePendingEngines} />
        )}

        <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full font-sans border-collapse">
              <thead>
                <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Method</th>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-[30%] border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Type</th>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center font-mono w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>ΔΔG</th>
                  <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-[20%]" style={{ color: "var(--cs-text-secondary)" }}>Risk</th>
                </tr>
              </thead>
              <tbody>
                {engineOutcomes.map((outcome, idx) => {
                  // ONE value string per engine, from ONE formatter in ONE sign convention.
                  // The table previously negated DynaMut2/DDMut while the breakdown panel below
                  // printed the raw sign, so one number appeared as both +0.09 and −0.09.
                  const sd = outcome.id === "foldx" ? foldxSd : null;
                  const valueText =
                    outcome.canonicalDdg === null
                      ? "—"
                      : formatDdgPair(outcome.canonicalDdg, sd, energyUnit);

                  const isComputed = outcome.state === "computed";
                  /**
                   * A value that is shown but not counted.
                   *
                   * FoldX retains its number after a failed repair for transparency, while the
                   * consensus excludes it. That exclusion used to be invisible: the row showed a
                   * danger-toned "Destabilizing" badge, the value was absent from the breakdown, and
                   * nothing said why — so the reader was invited to act on a number the app had
                   * already discarded.
                   */
                  const isExcluded = isComputed && !outcome.contributesToConsensus;

                  // Confidence is a separate note rather than a colour override: the old code
                  // restyled "(Speculative)" in amber, making "Highly Destabilizing
                  // (Speculative)" visually identical to "Moderately Destabilizing".
                  const confidenceNote = isExcluded
                    ? outcome.reason
                    : isComputed
                      ? disruptionPredictor?.plddt != null && disruptionPredictor.plddt < 70
                        ? `Low template confidence (pLDDT ${disruptionPredictor.plddt.toFixed(1)})`
                        : outcome.id === "foldx" && foldxRepairFailed
                        ? "Repair phase failed"
                        : null
                      : outcome.reason;

                  const badgeTone: EngineTone = isExcluded
                    ? "muted"
                    : isComputed
                      ? outcome.risk?.severity ?? "neutral"
                      : outcome.tone;
                  const badgeLabel = isExcluded
                    ? "Not counted"
                    : isComputed
                      ? outcome.risk?.label ?? "—"
                      : outcome.label;

                  return (
                    <tr key={outcome.id} className="hover:bg-[var(--cs-bg-subtle)] transition-colors animate-fade-in" style={{ color: "var(--cs-text-primary)", borderBottom: idx < engineOutcomes.length - 1 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                      <td className="p-3 px-4 font-semibold text-[12px] text-left w-1/4 border-r border-[var(--cs-border-subtle)]">
                        <button
                          type="button"
                          onClick={() => setSelectedMetric(outcome.id)}
                          aria-haspopup="dialog"
                          aria-label={`Explain the ${outcome.engine.name} method`}
                          className="hover:underline cursor-pointer text-left font-bold flex items-center gap-1.5 w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span style={{ color: "var(--cs-text-primary)" }}>{outcome.engine.name}</span>
                          </div>
                          <Info className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-text-muted)" }} />
                        </button>
                      </td>
                      <td className="p-3 px-4 text-[12px] text-center w-[30%] border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>{outcome.engine.taxonomy}</td>
                      <td className="p-3 px-4 text-center font-mono text-[12px] tabular-nums w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>{valueText}</td>
                      <td className="p-3 px-4 text-center w-[20%]">
                        <div className="flex flex-col items-center gap-0.5">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-lg border font-semibold ${outcome.state === "running" ? "animate-pulse" : ""} ${toneBadgeClass(badgeTone)}`}
                            title={[badgeLabel, confidenceNote, outcome.detail].filter(Boolean).join(" — ")}
                          >
                            {badgeLabel}
                          </span>
                          {confidenceNote && (
                            <span className="text-[9px] leading-tight" style={{ color: "var(--cs-text-muted)" }}>
                              {confidenceNote}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div className="px-3.5 py-2 bg-cs-surface-2 border-t border-cs-border-subtle flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-danger/60 text-cs-text-danger-on-soft border border-cs-border font-semibold">
                +ΔΔG Destabilizing
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cs-bg-success/60 text-cs-text-success border border-cs-border font-semibold">
                −ΔΔG Stabilizing
              </span>
            </div>
            <span className="text-[10px] text-cs-text-muted font-mono">
              Normalized convention · Engine-specific calibrated cut-points
            </span>
          </div>
        </div>
      </div>

        {/* Consensus verdict and per-engine breakdown.
            Always rendered: this block was previously hidden when all six engines were null,
            leaving the tab with no explanation at all in precisely the case that needed one. */}
        <div className="p-3.5 rounded-lg border space-y-3.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>

            {(() => {
              const hasValidConsensus = calConsensus.consensusProbability !== null;

              /**
               * Verdict tone.
               *
               * The default was confident emerald, which a single-tool estimate inherited — the
               * most misleading pixel on the screen. Coverage now participates: a "low risk"
               * verdict that rests on fewer than MIN_ENGINES_FOR_CONSENSUS engines is rendered
               * as provisional (dashed, warning-toned) rather than as an all-clear.
               */
              let styleClass = "bg-[var(--cs-bg-success)] text-[var(--cs-text-success)] border border-[var(--cs-border)]";
              if (calConsensus.consensusVerdict.includes("Insufficient")) {
                styleClass = "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border border-[var(--cs-border)]";
              } else if (coverage.insufficient) {
                /**
                 * Provisional FIRST, whatever the verdict text says.
                 *
                 * This branch used to be tested after "High", so a two-engine
                 * "High Misfolding Risk (Destabilizing Consensus)" — reachable, because only a
                 * single engine is remapped to the `*Single` verdicts — rendered as solid danger
                 * with no indication that it rested on two of six engines. Below
                 * MIN_ENGINES_FOR_CONSENSUS the verdict is an ensemble claim it cannot support, so
                 * the styling must not depend on how strong that claim sounds.
                 */
                styleClass = "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-dashed border-[var(--cs-border)]";
              } else if (calConsensus.consensusVerdict.includes("High")) {
                styleClass = "bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger-on-soft)] border border-[var(--cs-border)] font-bold";
              } else if (
                calConsensus.consensusVerdict.includes("Moderate") ||
                calConsensus.consensusVerdict.includes("Elevated")
              ) {
                styleClass = "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-dashed border-[var(--cs-border)]";
              }

              const pPercent = hasValidConsensus ? Math.round(calConsensus.consensusProbability! * 100) : 0;
              const minPercent = calConsensus.consensusConfMin !== null ? Math.round(calConsensus.consensusConfMin * 100) : 0;
              const maxPercent = calConsensus.consensusConfMax !== null ? Math.round(calConsensus.consensusConfMax * 100) : 0;

              let detailText = "Variant consensus exhibits neutral biophysical stability.";
              if (calConsensus.consensusVerdict.includes("Insufficient")) {
                detailText = "Insufficient biophysical data to compute a destabilization consensus.";
              } else if (calConsensus.consensusVerdict.includes("High")) {
                detailText = "Calibrated consensus indicates high probability of protein destabilization.";
              } else if (
                calConsensus.consensusVerdict.includes("Moderate") ||
                calConsensus.consensusVerdict.includes("Elevated")
              ) {
                detailText = "Moderate or elevated destabilization prediction warrants clinical attention.";
              }

              if (disruptionPredictor?.plddt != null && disruptionPredictor.plddt < 70 && coverage.computed > 0) {
                detailText = `${detailText} Low template confidence (pLDDT ${disruptionPredictor.plddt.toFixed(1)}) at this position; predictions are speculative.`;
              }

              return (
                <div className="flex flex-col gap-3 border-b pb-4 animate-fade-in" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider font-mono flex items-center gap-1.5" style={{ color: "var(--cs-text-muted)" }}>
                      {/* The number of engines is part of the headline, not a footnote. */}
                      <span>Calibrated Consensus — {coverage.label}</span>
                      {coverage.running.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning)] border border-[var(--cs-border)] font-semibold tracking-normal normal-case">
                          Calculating: {pendingToolNames.join(", ")}
                        </span>
                      )}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${styleClass}`}>
                      {calConsensus.consensusVerdict}
                    </span>
                  </div>

                  {coverage.computed > 0 && hasValidConsensus ? (
                    <div className="space-y-3 mt-1 pl-2">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span style={{ color: "var(--cs-text-secondary)" }}>Calibrated Probability of Destabilization:</span>
                        <span className="font-bold text-[var(--cs-accent-clay)]">{pPercent}%</span>
                      </div>

                      {/* Gauge Bar */}
                      <div
                        className="relative w-full h-3 rounded-full bg-[var(--cs-surface-2)] border border-[var(--cs-border)] overflow-visible"
                        role="meter"
                        aria-valuenow={pPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Calibrated probability of destabilization"
                      >
                        {/* Conformal range band */}
                        <div 
                          className="absolute h-full rounded-full opacity-35 bg-[var(--cs-accent-clay)]"
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
                      <div className="flex justify-between items-center text-[10px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
                        <span>90% Conformal Prediction Interval:</span>
                        <span>[{minPercent}% – {maxPercent}%]</span>
                      </div>
                      {/* Coverage is stated in words as well as in the header count. */}
                      <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                        {describeCoverage(coverage)}
                      </p>
                      <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                        {detailText}
                      </p>
                    </div>
                  ) : coverage.missing.length + coverage.running.length === coverage.intended ? (
                    <p className="text-[10px] italic" style={{ color: "var(--cs-text-muted)" }}>
                      No engine has returned a value yet.
                    </p>
                  ) : (
                    // A value EXISTS but none could be counted — the single-excluded-FoldX case.
                    //
                    // The test has to be value-based. `computed === 0` counts CONTRIBUTIONS and is also
                    // true here, so branching on it printed "no engine has returned a value yet" while
                    // the row 40px above displayed the number with a "Not counted" badge. That was this
                    // copy's second attempt — the first tested `hasValidConsensus`, also true here. An
                    // engine with no value is either still running or missing, so "no value at all" is
                    // exactly `missing + running === intended`.
                    <p className="text-[10px] italic" style={{ color: "var(--cs-text-muted)" }}>
                      No returned value could be counted toward a consensus.
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="mt-4 pt-3 border-t border-cs-border-subtle">
              <span className="text-[10px] font-bold uppercase tracking-wider font-mono block mb-2 text-cs-text-muted">
                Calibrated Tool Breakdown:
              </span>
              {calibratedBreakdownRows.length === 0 ? (
                <p className="text-[11px] italic py-1 text-cs-text-muted">
                  No calibrated per-engine probabilities are available for this run.
                </p>
              ) : (
                <div className="rounded-lg border border-cs-border-subtle bg-cs-surface-2 divide-y divide-cs-border-subtle/60 overflow-hidden">
                  {calibratedBreakdownRows.map(({ outcome, cal }) => (
                    <div
                      key={outcome.id}
                      className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono hover:bg-cs-bg-subtle/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-cs-text-primary">{outcome.engine.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cs-surface text-cs-text-muted border border-cs-border-subtle">
                          {outcome.engine.taxonomy}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-bold tabular-nums text-cs-text-primary">
                          {formatDdg(outcome.canonicalDdg, energyUnit)}
                        </span>
                        <span className="text-[10px] tabular-nums text-cs-text-muted">
                          P: <span className="font-semibold text-cs-text-secondary">{Math.round(cal.p * 100)}%</span> [{Math.round(cal.lower * 100)}%–{Math.round(cal.upper * 100)}%]
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

        </div>

        <div className="p-3.5 rounded-lg border border-cs-border bg-cs-surface-2 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] animate-fade-in">
          <div className="flex items-start gap-2.5 text-cs-text-secondary leading-relaxed">
            <Info className="w-4 h-4 shrink-0 text-cs-accent-clay mt-0.5" />
            <div>
              <span className="font-semibold text-cs-text-primary">Multi-Method Biophysical Consensus</span>
              <p className="text-[10px] text-cs-text-muted mt-0.5">
                Integrates physics-based force fields (FoldX), normal mode dynamics (DynaMut2), 3D graph ML (StabilityOracle), deep learning (DDMut, RaSP), and protein language modeling (ThermoMPNN) with isotonic probability calibration.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.stabilityTelemetry)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-cs-surface hover:bg-cs-bg-subtle text-cs-text-primary border border-cs-border-subtle hover:border-cs-border shadow-xs transition-[transform,colors,border-color] duration-150 shrink-0 cursor-pointer active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay"
          >
            <span>Inspect Live Telemetry</span>
            <ArrowRight className="w-3.5 h-3.5 text-cs-accent-clay" />
          </button>
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
