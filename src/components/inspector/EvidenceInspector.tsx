import React from "react";
import {
  Database,
  Dna,
  ShieldAlert,
  ExternalLink,
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
  buildGuidelinesRows,
  summarizeGuidelinesRows
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

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

  const transcriptId = analysisResult.transcriptId ?? analysisResult.predictorData?.transcriptId ?? null;
  const isManeSelect = analysisResult.isManeSelect ?? analysisResult.predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult.isManePlusClinical ?? analysisResult.predictorData?.isManePlusClinical ?? false;
  const isCanonical = analysisResult.isCanonical ?? analysisResult.predictorData?.isCanonical ?? false;
  const maneRefSeqId = analysisResult.maneRefSeqId ?? analysisResult.predictorData?.maneRefSeqId ?? null;
  const transcriptWarning = analysisResult.transcriptWarning ?? analysisResult.predictorData?.transcriptWarning ?? null;
  const clinvar = analysisResult.clinvar;
  const conservationData = analysisResult.conservationData;
  const multimerData = analysisResult.multimerData;
  const subunitComment = multimerData?.subunitComment || analysisResult.uniprotFeatures?.subunitComment;

  const clinvarUid = clinvar?.uid != null ? String(clinvar.uid) : null;
  const clinvarVcv = clinvarUid ? (clinvarUid.startsWith("VCV") ? clinvarUid : `VCV${clinvarUid.padStart(9, "0")}`) : null;

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
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-cs-accent-clay" />
            PPI &amp; Interface Methodology
          </span>

          {/* Functional vs Physical Networks */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[11px]">
              <Info className="w-3.5 h-3.5 text-cs-accent-clay shrink-0" />
              <span>Functional vs. Physical Networks</span>
            </div>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              <strong>STRING-db</strong> quantifies proteome-wide functional associations inferred from co-expression, shared pathways, and literature citations.
            </p>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              In contrast, <strong>OpenBind-0</strong> directly calculates atomistic steric clashes, electrostatic shifts, and binding free energy changes (&Delta;&Delta;G_bind) across the physical 3D subunit interface.
            </p>
          </div>

          {/* Confidence Score Thresholds */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              STRING Score Confidence Tiers
            </span>
            <div className="space-y-1 text-[10.5px] font-mono">
              <div className="flex justify-between items-center">
                <span className="text-cs-text-secondary">&ge; 0.900</span>
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Highest</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-cs-text-secondary">0.700 – 0.899</span>
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">High</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-cs-text-secondary">0.400 – 0.699</span>
                <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">Medium</span>
              </div>
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
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">STRING-db</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v12.0 · Homo sapiens (9606)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">OpenBind-0</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">Tier 1 · JapanFold</span>
            </div>
          </div>
        </div>
      )}

      {tab === "multimers" && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5 text-cs-accent-clay" />
            Quaternary Structure Methodology
          </span>

          {/* ipTM & Quality Metrics */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              Interface Quality (ipTM)
            </span>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              <strong>ipTM &ge; 0.80</strong> indicates high-confidence subunit interface geometry. <strong>Overall pTM</strong> measures whole-complex structural topology.
            </p>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              Inter-chain contact boundary is evaluated at heavy-atom distance &le; 4.5 &Aring;.
            </p>
          </div>

          {/* Curated Subunit Annotation */}
          {subunitComment && (
            <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
                Swiss-Prot SUBUNIT Curation
              </span>
              <p className="text-[10.5px] text-cs-text-primary italic leading-relaxed">
                &ldquo;{subunitComment}&rdquo;
              </p>
            </div>
          )}

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">Boltz-2 / OpenFold3</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">Tier 1 · JapanFold</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">UniProtKB</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">Swiss-Prot Curated</span>
            </div>
          </div>
        </div>
      )}

      {tab === "function" && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cs-accent-clay" />
            Domain &amp; Feature Architecture
          </span>

          {/* Feature Legend */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              Feature Types &amp; Palette
            </span>
            <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 shrink-0" />
                <span className="text-cs-text-secondary">Domains</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 shrink-0" />
                <span className="text-cs-text-secondary">Active / Catalytic</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" />
                <span className="text-cs-text-secondary">Binding Sites</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" />
                <span className="text-cs-text-secondary">PTM Anchors</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 shrink-0" />
                <span className="text-cs-text-secondary">Disulfide Bridges</span>
              </div>
            </div>
          </div>

          {/* Interactive Navigation Guide */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              Inspection &amp; Zoom Controls
            </span>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              Use the zoom slider or zoom buttons to focus on specific sequence windows. Clicking domain cards dynamically highlights and scrolls to corresponding SVG pins.
            </p>
          </div>

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">UniProtKB Feature Table</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">Swiss-Prot Verified</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">InterPro / Pfam</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v2024</span>
            </div>
          </div>
        </div>
      )}

      {tab === "clinical" && (
        <div className="flex flex-col gap-3">
          {/* Static Genomic Lineage & ACMG Baseline first at top on first tab only */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
              <Dna className="w-3.5 h-3.5 text-cs-accent-clay" />
              Genomic Lineage &amp; ACMG Baseline
            </span>
            <div id="genomic-lineage-drawer" className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
              {/* Assembly & Transcript */}
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between items-center">
                  <span className="text-cs-text-secondary">Genome Assembly:</span>
                  <span className="font-mono font-bold text-cs-text-primary">GRCh38 / hg38</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-cs-text-secondary">Transcript ID:</span>
                  <span className="font-mono font-bold text-cs-text-primary">{transcriptId || "Not resolved"}</span>
                </div>

                {maneRefSeqId && (
                  <div className="flex justify-between items-center">
                    <span className="text-cs-text-secondary">RefSeq Accession:</span>
                    <span className="font-mono text-cs-text-secondary">{maneRefSeqId}</span>
                  </div>
                )}

                <div className="flex justify-between items-center pt-1 border-t border-cs-border-subtle">
                  <span className="text-cs-text-secondary">Transcript Tier:</span>
                  <span className={`text-[9.5px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                    isManeSelect
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      : isManePlusClinical
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                      : isCanonical
                      ? "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20"
                      : transcriptId
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20"
                  }`}>
                    {isManeSelect ? "MANE Select (Gold)" : isManePlusClinical ? "MANE Plus Clinical" : isCanonical ? "Ensembl Canonical" : transcriptId ? "Non-canonical" : "Unassigned"}
                  </span>
                </div>

                {transcriptWarning && (
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 pt-1 leading-snug">
                    ⚠️ {transcriptWarning}
                  </div>
                )}
              </div>

              {/* ACMG Rule Evaluation Count */}
              {(() => {
                const allCriteria = [
                  ...(analysisResult.insights?.acmgCriteria || []),
                  ...(analysisResult.ruleBasedInsights?.acmgCriteria || [])
                ];
                const validCriteria = allCriteria.filter((c: any) => c && typeof c.code === "string");
                const uniqueCriteria = Array.from(new Map(validCriteria.map((c: any) => [c.code, c])).values());
                const pathCount = uniqueCriteria.filter((c: any) => c.category === "pathogenic" || (typeof c.code === "string" && c.code.toUpperCase().startsWith("P"))).length;
                const benCount = uniqueCriteria.filter((c: any) => c.category === "benign" || (typeof c.code === "string" && c.code.toUpperCase().startsWith("B"))).length;

                return (
                  <div className="pt-2 border-t border-cs-border-subtle space-y-1 text-[10.5px]">
                    <div className="flex justify-between items-center">
                      <span className="text-cs-text-secondary">Pathogenic Rules:</span>
                      <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                        {pathCount > 0 ? `${pathCount} active` : "0 triggered"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-cs-text-secondary">Benign Rules:</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {benCount > 0 ? `${benCount} active` : "0 triggered"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[9.5px] text-cs-text-muted pt-0.5">
                      <span>Framework:</span>
                      <span className="font-mono">Richards et al. 2015 / ClinGen</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5 pt-1 border-t border-cs-border-subtle">
            <Database className="w-3.5 h-3.5 text-cs-accent-clay" />
            Clinical Evidence &amp; Frequencies
          </span>

          {/* ClinVar Provenance */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-[11px] text-cs-text-primary flex items-center gap-1">
                NCBI ClinVar Review
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-cs-text-muted">
                E-Fetch API
              </span>
            </div>
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-cs-text-secondary">VCV Accession:</span>
              {clinvarVcv ? (
                <a
                  href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(clinvarUid || "")}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-cs-accent-clay hover:underline flex items-center gap-1"
                >
                  {clinvarVcv}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : (
                <span className="font-mono text-[10px] text-cs-text-muted italic">
                  Unindexed in ClinVar
                </span>
              )}
            </div>
            {clinvar?.lastEvaluated && !isNaN(Date.parse(clinvar.lastEvaluated)) && (
              <div className="flex justify-between items-center text-[10px] text-cs-text-muted pt-1 border-t border-cs-border-subtle">
                <span>Last Evaluated:</span>
                <span className="font-mono">{new Date(clinvar.lastEvaluated).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* ACMG Population Frequency Criteria */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
              ACMG Frequency Criteria
            </span>
            <div className="space-y-1.5 text-[10.5px]">
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400 shrink-0">PM2</span>
                <span className="text-cs-text-secondary text-right">Extremely low/absent in gnomAD (MAF &lt; 0.01%)</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 shrink-0">BS1</span>
                <span className="text-cs-text-secondary text-right">Frequency greater than expected for disorder (MAF &gt; 0.1%)</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 shrink-0">BA1</span>
                <span className="text-cs-text-secondary text-right">Stand-alone benign (MAF &gt; 5% in population cohorts)</span>
              </div>
            </div>
          </div>

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">NCBI ClinVar</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">GRCh38 / E-Utilities</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">gnomAD</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v4.0.0 (Genomes &amp; Exomes)</span>
            </div>
          </div>
        </div>
      )}

      {tab === "predictors" && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-cs-accent-clay" />
            In-Silico Ensemble Calibration
          </span>

          {/* Bayesian ACMG Calibration */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              ACMG PP3 / BP4 Evidence Weighting
            </span>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              Per Tavtigian et al. (2018) and ClinGen SVI guidelines, computational scores are calibrated against local odds of pathogenicity.
            </p>
            <p className="text-[10.5px] text-cs-text-secondary leading-relaxed font-sans">
              Multiple correlated tools are harmonized via consensus voting to prevent circular double-counting of evolutionary signals.
            </p>
          </div>

          {/* Predictor Suite Registry */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block pb-1 border-b border-cs-border-subtle">
              Model Registry &amp; Lineage
            </span>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">AlphaMissense</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v2023 · Google DeepMind</span>
            </div>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">REVEL</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v2016 · Ioannidis et al.</span>
            </div>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">SpliceAI</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v1.3.1 · Illumina</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">CADD</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted">v1.6 · Rentzsch et al.</span>
            </div>
          </div>
        </div>
      )}

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
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-cs-accent-clay" />
            Concordance &amp; Calibration Guide
          </span>

          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[9.5px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${statusBadgeStyle}`}>
                {statusText}
              </span>
            </div>
            <p className="text-[10.5px] text-cs-text-secondary leading-snug font-sans">
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
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9.5px] font-sans"
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
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-cs-text-muted block">
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
            <div className="space-y-1.5 text-[10.5px]">
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
            <div className="space-y-1 text-[10.5px]">
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

      {/* Baseline fallback for tabs under subsequent evaluation */}
      {tab !== "interactions" && tab !== "multimers" && tab !== "function" && tab !== "clinical" && tab !== "predictors" && tab !== "thresholds" && tab !== "guidelines" && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cs-accent-clay" />
            Evidence Subtab Telemetry
          </span>
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px] text-cs-text-secondary">
            <p>
              Viewing specialized evidence telemetry for <strong>{activeEvidenceTab}</strong>.
            </p>
            <p className="text-[10px] text-cs-text-muted">
              Deep-dive domain calibrations and metrics are populated dynamically from live backend microservices.
            </p>
          </div>
        </div>
      )}

    </div>
  );
};

export default React.memo(EvidenceInspector);


