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
  THRESHOLDS,
  STRING_CONFIDENCE_BANDS,
  buildGuidelinesRows,
  summarizeGuidelinesRows
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import {
  buildFrequencyEvidence,
  formatAlleleFrequency,
  populationReading,
} from "../../shared/frequencyEvidence";
import { variantNumberingView } from "../../shared/numbering";
import { ASSEMBLY_LABELS } from "../../shared/assembly";
import { humaniseAnyRefusal } from "../../shared/evidenceAvailability";
import { acmgCriteriaView } from "../../shared/acmgCriteriaView";
import { FeaturePaletteLegend } from "./FeaturePaletteLegend";

type PopulationFrequencyThresholds = typeof THRESHOLDS.populationFrequency;

/**
 * The PM2 / BS1 / BA1 frequency criteria, described from the engine's own cut-points.
 *
 * Each `describe` interpolates the constant into the sentence, so a card that documents a rule
 * cannot print a percentage the rule does not use. The previous revision hard-coded "MAF > 0.1%"
 * for BS1 while the classifier tested at 1%.
 */
const FREQUENCY_CRITERIA: ReadonlyArray<{
  code: string;
  tone: string;
  describe: (freq: PopulationFrequencyThresholds) => string;
}> = [
  {
    code: "PM2",
    // Theme tokens rather than the raw palette, so the code carries the same red here as it does in
    // the tab's verdict chip and in the rule counts above.
    tone: "text-cs-text-danger-on-soft",
    describe: freq =>
      `Extremely rare in gnomAD (MAF ≤ ${(freq.extremelyRare * 100).toFixed(2)}%, or ≤ ${(freq.extremelyRareRecessive * 100).toFixed(1)}% when pLI < ${freq.recessivePlI} reads as recessive)`
  },
  {
    code: "BS1",
    tone: "text-cs-text-success",
    describe: freq => `Frequency greater than expected for the disorder (MAF > ${(freq.tooCommonForDisorder * 100).toFixed(1)}%)`
  },
  {
    code: "BA1",
    tone: "text-cs-text-success",
    describe: freq => `Stand-alone benign (MAF > ${(freq.standAloneBenign * 100).toFixed(0)}% in population cohorts)`
  }
];

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
  /**
   * The build the coordinate is actually expressed in.
   *
   * This row was a hardcoded "GRCh38 / hg38". For a variant whose coordinate resolved through the
   * GRCh37 fallback, the header chip two metres away read `HG19` while the provenance panel
   * certified GRCh38 — and the build *is* the reason the GRCh38-only sources declined. A debugger
   * checking the lineage box last was therefore told the opposite of the truth (standby RCA §1).
   * `VariantHeader.tsx:462-466` already states the rule this row violated: the build is not ours to
   * assume.
   */
  const genomicAssembly = analysisResult.predictorData?.gnomadVariantAssembly ?? null;
  /** Per-source build-gate refusals recorded server-side (unmapping defect F-13). */
  const assemblyRefusals = analysisResult.conservationData?.assemblyRefusals ?? null;
  /**
   * Reported (lab/MANE) versus modelled (canonical) notation.
   *
   * The lineage panel is where a reader checks what was actually analysed, so it must state both: the
   * notation their report used and the canonical numbering the engines were given.
   */
  const numbering = variantNumberingView({
    variant: analysisResult.metadata?.variant ?? "",
    uniprotId: analysisResult.metadata?.uniprotId ?? null,
    numberingRemap: (analysisResult as any).numberingRemap ?? null,
  });
  const clinvar = analysisResult.clinvar;
  const conservationData = analysisResult.conservationData;
  const multimerData = analysisResult.multimerData;
  const subunitComment = multimerData?.subunitComment || analysisResult.uniprotFeatures?.subunitComment;

  /**
   * The same frequency view the Population Frequencies column renders.
   *
   * Built here rather than restated: the rail and the column sit in one viewport describing one
   * variant, so a release name, a governing frequency or a criterion written out a second time is a
   * claim nothing checks. `gnomadRelease` is the row's own dataset label.
   */
  const frequencyEvidence = buildFrequencyEvidence({
    gnomadFrequency: analysisResult.gnomadFrequency ?? null,
    aouFrequency: analysisResult.aouFrequency ?? null,
    serviceStatus: analysisResult.serviceStatus ?? analysisResult.metadata?.serviceStatus ?? null,
    clinvar: clinvar
      ? { classification: clinvar.classification, alleleFrequencies: clinvar.alleleFrequencies }
      : null,
    assembly: analysisResult.predictorData?.gnomadVariantAssembly ?? null,
    pli: analysisResult.gnomadConstraint?.pli ?? null,
    engineCriteria: analysisResult.ruleBasedInsights?.acmgCriteria ?? analysisResult.insights?.acmgCriteria ?? null,
    acmgWeighting: analysisResult.metadata?.acmgWeighting ?? null,
  });
  const gnomadRelease = frequencyEvidence.observations.find(o => o.id.startsWith("gnomad"))?.dataset ?? "release not reported";

  /**
   * The rail's reading rows, as DATA.
   *
   * Built beside the object it reads rather than inside the JSX, so every row — including `From`, the
   * one that makes this card provenance instead of a second headline — is addressable by a test.
   *
   * `mostCopies` carries its cohort name for the same reason the column's does: the counts and the
   * frequency the rule read usually come from different populations, and an unattributed `AC 8 · AN
   * 1,459,156` directly above "From: gnomAD grouped maximum" states that the grouped maximum produced
   * those counts. It did not — nothing in the payload reports counts for that group.
   */
  const reading = populationReading(frequencyEvidence);
  const ruleFrom = reading.ruleSource.startsWith("gnomAD")
    ? `${reading.ruleSource} · ${gnomadRelease}`
    : reading.ruleSource;
  const readingRows: ReadonlyArray<{ label: string; value: string; rank: string }> = [
    {
      label: "Alleles observed",
      value: reading.mostCopies ? `${reading.mostCopies.counts} · ${reading.mostCopies.label}` : "None reported",
      rank: "readout-inline text-cs-text-primary",
    },
    ...(reading.ruleAf !== null
      ? [{
          label: "AF the rule read",
          value: formatAlleleFrequency(reading.ruleAf),
          rank: "readout-note text-cs-text-muted",
        }]
      : []),
    { label: "From", value: ruleFrom, rank: "prose-meta text-cs-text-muted" },
    {
      label: "Engine criterion",
      value: frequencyEvidence.applied.known
        ? frequencyEvidence.applied.code ?? "None recorded"
        : `unconfirmed (supports ${frequencyEvidence.criterion.code})`,
      rank: "readout-inline text-cs-text-primary",
    },
    ...(frequencyEvidence.applied.weighting
      ? [{ label: "ACMG weighting", value: frequencyEvidence.applied.weighting, rank: "prose-meta text-cs-text-muted" }]
      : []),
  ];

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

      {tab === "clinical" && (
        <div className="flex flex-col gap-3">
          {/* Static Genomic Lineage & ACMG Baseline first at top on first tab only */}
          <div className="flex flex-col gap-2">
            <span className="eyebrow">
              <Dna className="w-3.5 h-3.5 text-cs-accent-clay" />
              Genomic Lineage &amp; ACMG Baseline
            </span>
            <div id="genomic-lineage-drawer" className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
              {/* Assembly & Transcript — 12px and weight 600, matching the main column's rows. */}
              <div className="space-y-2 rail-row">
                {numbering.remapped && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-cs-text-secondary">Reported notation:</span>
                      <span className="readout-inline text-cs-text-primary" data-testid="reported-notation">
                        {numbering.reported}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-cs-text-secondary">Modelled as:</span>
                      <span className="font-mono text-cs-text-secondary" data-testid="modelled-notation">
                        {numbering.modelled}
                        {analysisResult.metadata?.uniprotId ? ` (canonical ${analysisResult.metadata.uniprotId})` : ""}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-cs-text-secondary">Genome Assembly:</span>
                  <span className="readout-inline text-cs-text-primary">
                    {genomicAssembly ? ASSEMBLY_LABELS[genomicAssembly] : "Build not reported"}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-cs-text-secondary">Transcript ID:</span>
                  <span className="readout-inline text-cs-text-primary">{transcriptId || "Not resolved"}</span>
                </div>

                {maneRefSeqId && (
                  <div className="flex justify-between items-center">
                    <span className="text-cs-text-secondary">RefSeq Accession:</span>
                    <span className="readout-note text-cs-text-secondary">{maneRefSeqId}</span>
                  </div>
                )}

                <div className="flex justify-between items-center pt-1 border-t border-cs-border-subtle">
                  <span className="text-cs-text-secondary">Transcript Tier:</span>
                  {/*
                    * `.ev-tier` with the SAME tone map the variant header uses for this fact
                    * (`VariantHeader.tsx` transcriptTier: MANE Select good, MANE Plus Clinical clay,
                    * Ensembl Canonical warning, everything else muted). This chip used to carry raw
                    * Tailwind hues — emerald here, clay in the header, for one transcript — and the
                    * `dark:` pairs it needed could not be flattened for print, which `.ev-tier` can.
                    */}
                  <span
                    className="ev-tier chip-code uppercase"
                    data-tone={
                      isManeSelect ? "good"
                      : isManePlusClinical ? "accent"
                      : isCanonical ? "warning"
                      : "muted"
                    }
                  >
                    {isManeSelect ? "MANE Select" : isManePlusClinical ? "MANE Plus Clinical" : isCanonical ? "Ensembl Canonical" : transcriptId ? "Non-canonical" : "Unassigned"}
                  </span>
                </div>

                {transcriptWarning && (
                  <div className="prose-meta pt-1" style={{ color: "var(--cs-text-warning-on-soft)" }}>
                    ⚠️ {transcriptWarning}
                  </div>
                )}
              </div>

              {/* ACMG Rule Evaluation Count */}
              {(() => {
                /*
                 * Read through the shared view, not re-derived. This block concatenated
                 * `insights.acmgCriteria` with the raw `ruleBasedInsights.acmgCriteria` and deduped
                 * with a last-wins `Map`, which discarded every source tag — the same shape that made
                 * the Insights rail label the rule engine's codes "AI Inferred". The counts here only
                 * read the code prefix, so they were right by luck; the list they came from was not,
                 * and the next reader of this block would have inherited the bug.
                 */
                const uniqueCriteria = acmgCriteriaView(
                  analysisResult.insights?.acmgCriteria,
                  analysisResult.ruleBasedInsights?.acmgCriteria
                );
                const pathCount = uniqueCriteria.filter(c => c.code.toUpperCase().startsWith("P")).length;
                const benCount = uniqueCriteria.filter(c => c.code.toUpperCase().startsWith("B")).length;

                return (
                  <div className="pt-2 border-t border-cs-border-subtle space-y-1 rail-row">
                    <div className="flex justify-between items-center">
                      <span className="text-cs-text-secondary">Pathogenic Rules:</span>
                      {/* Theme tokens, not the raw Tailwind palette: the criteria-code rows below
                          used the same rose/emerald, which put the same two codes in two different
                          reds and two different greens inside one card. */}
                      <span className="readout-inline" style={{ color: "var(--cs-text-danger-on-soft)" }}>
                        {pathCount > 0 ? `${pathCount} active` : "0 triggered"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-cs-text-secondary">Benign Rules:</span>
                      <span className="readout-inline" style={{ color: "var(--cs-text-good-on-soft)" }}>
                        {benCount > 0 ? `${benCount} active` : "0 triggered"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center prose-meta text-cs-text-muted pt-0.5">
                      <span>Framework:</span>
                      <span className="prose-meta">Richards et al. 2015 / ClinGen</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <span className="eyebrow pt-1 border-t border-cs-border-subtle">
            <Database className="w-3.5 h-3.5 text-cs-accent-clay" />
            Clinical Evidence &amp; Frequencies
          </span>

          {/* ClinVar Provenance */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <div className="flex justify-between items-center">
              <span className="card-title text-cs-text-secondary flex items-center gap-1">
                NCBI ClinVar Review
              </span>
              {/*
                * A "E-Fetch API" badge sat here. The client calls `esearch`/`esummary`
                * (`clinvar.ts:99`, `:117`) and never `efetch`, so the badge named a mechanism the
                * code does not use — in the one card whose job is to establish provenance. The
                * footer of this group states the mechanism that IS used; a second, wrong statement
                * of it is worse than none.
                */}
            </div>
            <div className="flex justify-between items-center rail-row">
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
                /*
                 * "Unindexed in ClinVar" was asserted whenever there was no uid — including when the
                 * ClinVar query had timed out. `frequencyEvidence` classifies that read, so the row
                 * says which absence it means instead of naming the one that reads as a negative
                 * result.
                 */
                <span className="readout-note text-cs-text-muted italic text-right">
                  {frequencyEvidence.clinvar.availability.hasValue ? "Unindexed in ClinVar" : "No ClinVar record read"}
                </span>
              )}
            </div>
            {clinvar?.lastEvaluated && !isNaN(Date.parse(clinvar.lastEvaluated)) && (
              <div className="flex justify-between items-center rail-row text-cs-text-muted pt-1 border-t border-cs-border-subtle">
                <span>Last Evaluated:</span>
                <span className="readout-note">{new Date(clinvar.lastEvaluated).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/*
            * This card belongs to the one tab whose job is population frequency, so it also states
            * what THIS run did with the frequency — the same object the main column renders, so the
            * two panes cannot report different frequencies or different criteria for one variant.
            */}
          {/*
            * The rail does not re-present the column's headline — it states WHERE that reading came
            * from: the counts and their cohort, the frequency the rule thresholds on as its own
            * labelled line, the source field, and the weighting that decided whether it was applied.
            * The card used to lead with the governing frequency and the criterion, which is the
            * figure and the chip the column already prints two hundred pixels to the left of it.
            */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
            <span className="card-title text-cs-text-secondary block">
              This run's reading
            </span>
            <div className="space-y-2 rail-row">
              {readingRows.map(({ label, value, rank }) => (
                <div key={label} className="flex justify-between items-baseline gap-3">
                  <span className="text-cs-text-secondary shrink-0">{label}</span>
                  <span className={`${rank} text-right`}>{value}</span>
                </div>
              ))}
            </div>
            {frequencyEvidence.applied.suppressed && (
              <p className="detail-prose" style={{ color: "var(--cs-text-warning-on-soft)" }}>
                The frequency meets {frequencyEvidence.criterion.code}, but the engine recorded no frequency
                criterion for this run
                {frequencyEvidence.applied.withheldByWeighting && frequencyEvidence.applied.weighting
                  ? ` — the ${frequencyEvidence.applied.weighting} weighting is what withholds it.`
                  : "."}
              </p>
            )}
          </div>

          {/* ACMG Population Frequency Criteria */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
            <span className="card-title text-cs-text-secondary block">
              ACMG Frequency Criteria
            </span>
            {/*
              * Each criterion is a stacked block: code, then its cut-point as a full-width left-aligned
              * line. The previous shape put the description right-aligned against a left-aligned code,
              * so a three-line description ("Extremely rare in gnomAD (MAF ≤ 0.01%, or ≤ 0.1% when pLI
              * < 0.9 reads as recessive)") had a ragged left edge in a 300px column and had to be
              * re-found on every read. Left-aligned prose with its own leading is what makes it
              * scannable; the code is a label, not a table column.
              */}
            {FREQUENCY_CRITERIA.map(({ code, tone, describe }) => (
              <div key={code} className="flex flex-col gap-1">
                <span className={`readout-inline ${tone}`}>{code}</span>
                <span className="detail-prose text-cs-text-secondary">{describe(THRESHOLDS.populationFrequency)}</span>
              </div>
            ))}
          </div>

          {/* Provenance */}
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">NCBI ClinVar</span>
              <span className="font-mono text-[11px] text-cs-text-muted">E-utilities esearch/esummary</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">gnomAD</span>
              {/*
                * The release comes from the payload the main column renders, not from a literal
                * here. It was a literal, and it disagreed with the manifest ("v4.0.0" here, "v4.1.0"
                * in `provenance.ts`) for the same query — neither read from anywhere. Deriving it
                * means a payload whose dataset is not `gnomad_r4` cannot render two release names.
                */}
              <span className="font-mono text-[11px] text-cs-text-muted">
                {gnomadRelease}
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === "predictors" && (
        <div className="flex flex-col gap-3">
          <span className="eyebrow">
            <Cpu className="w-3.5 h-3.5 text-cs-accent-clay" />
            In-Silico Ensemble Calibration
          </span>

          {/* Bayesian ACMG Calibration */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
            <span className="text-[11px] font-bold text-cs-text-primary block">
              ACMG PP3 / BP4 Evidence Weighting
            </span>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              Per Tavtigian et al. (2018) and ClinGen SVI guidelines, computational scores are calibrated against local odds of pathogenicity.
            </p>
            <p className="text-[11px] text-cs-text-secondary leading-relaxed font-sans">
              Multiple correlated tools are harmonized via consensus voting to prevent circular double-counting of evolutionary signals.
            </p>
          </div>

          {/* Predictor Suite Registry */}
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[11px]">
            <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block pb-1 border-b border-cs-border-subtle">
              Model Registry &amp; Lineage
            </span>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">AlphaMissense</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v2023 · Google DeepMind</span>
            </div>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">REVEL</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v2016 · Ioannidis et al.</span>
            </div>
            <div className="flex justify-between items-center pb-1 border-b border-cs-border-subtle">
              <span className="font-semibold text-cs-text-primary">SpliceAI</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v1.3.1 · Illumina</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-cs-text-primary">CADD</span>
              <span className="font-mono text-[10px] text-cs-text-muted">v1.6 · Rentzsch et al.</span>
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

      {/*
        ── ALPHAGENOME PROVENANCE ──
        * Where the AlphaGenome panel's verbose material went. Two multi-line methodology notes used
        * to sit as paragraphs inside the data column — the ClinGen SVI isolation mandate, between two
        * numbers, and a five-line assay-architecture disclaimer above a table — plus a transport
        * sentence in the hero. None of it is a finding about the variant, which is what the main
        * column is for; all of it is what a reader wants when they ask how a number was obtained.
        *
        * Semantic list rather than prose blocks: a definition list is scannable, and the paragraphs
        * it replaces were neither scannable nor short.
        */}
      {tab === "alphagenome" && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
            Provenance &amp; method
          </h3>
          <dl className="space-y-2.5 text-[11px] leading-relaxed">
            <div>
              <dt className="text-cs-text-muted">Source</dt>
              <dd className="text-cs-text-secondary">
                AlphaGenome Atlas (Google DeepMind), queried over TLS by a native gRPC client at{" "}
                <code className="font-mono">gdmscience.googleapis.com:443</code>. The Atlas links on
                the panel are deep links into the authenticated Atlas for this locus, not a public
                search.
              </dd>
            </div>
            <div>
              <dt className="text-cs-text-muted">Scalar reported</dt>
              <dd className="text-cs-text-secondary">
                {/*
                  * This said "−10·log₁₀ P(benign)", which is not the quantity computed. `cdfToPhred`
                  * is `tail = 1 − cdfQuantile; phred = −10·log10(tail)`, and the cdf is cumulative
                  * against ALL genome-wide SNVs — so the tail is the fraction of variants scoring at
                  * least as high, i.e. the genome-wide rank the adjacent card already prints as
                  * "Top 0.537%". Read literally the old gloss turned Phred 22.7 into "P(benign) =
                  0.54%, ~99.5% pathogenic", contradicting the PP3-Supporting / 2.08:1 verdict two
                  * hundred pixels away.
                  */}
                AVI — the calibrated variant impact score, shown as Phred
                (−10·log₁₀ <em>tail</em>, where the tail is the fraction of genome-wide SNVs scoring
                at least this high; Phred 20 ≈ top 1%). Five bands, not four: ≤ 5 BP4-moderate,
                ≤ 8 BP4-supporting, ≥ 15 PP3-supporting, ≥ 25 PP3-moderate, ≥ 35 PP3-strong.
              </dd>
            </div>
            <div>
              <dt className="text-cs-text-muted">Attribution</dt>
              <dd className="text-cs-text-secondary">
                {/*
                  * Two corrections. The method is SHAP by expected-gradients approximation (the
                  * Atlas's own description), not TreeExplainer — a name this panel had also asserted
                  * in its education drawer, now fixed there too. And "biological layers" oversells the
                  * vector: it carries non-layer indicators (protein termination, start/stop lost,
                  * insertion, deletion), so these are 18 features.
                  */}
                SHAP (expected-gradients approximation) over the model&apos;s 9,440 tracks, reduced to
                18 features which sum to the raw AVI score. Coding, splicing and regulatory features
                name a mechanism; the conservation features (Cactus 241-way, PhastCons 470-way)
                report constraint and are never elected into the mechanism slot.
              </dd>
            </div>
            <div>
              <dt className="text-cs-text-muted">How it is counted</dt>
              <dd className="text-cs-text-secondary">
                {/*
                  * This row previously read "Held out of the missense consensus … a variant is never
                  * counted twice", and got STRONGER in the move from the panel. It is false:
                  * `countPredictorConcordance` includes AlphaGenome as a full voting member
                  * (`isInformationalOnly: false`) scored on the whole AVI — and the AVI's own feature
                  * 0 is splicing. Nothing anywhere withholds splicing from any vote. What is true is
                  * narrower and worth stating plainly.
                  */}
                The AVI is one composite member of the in-silico pathogenicity concordance vote — a
                single scalar, not eighteen separate votes, and nothing is withheld from that count.
                It is absent from the ΔΔG stability consensus because it is not a ΔΔG engine.
              </dd>
            </div>
            <div>
              <dt className="text-cs-text-muted">Track reference schema</dt>
              <dd className="text-cs-text-secondary">
                The ten example rows on the panel illustrate AlphaGenome&apos;s output shape across
                four assay categories; those magnitudes are examples, not measurements of this
                variant. This variant&apos;s continuous tracks are read in the Atlas, linked at the
                foot of the panel.
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Baseline fallback for tabs under subsequent evaluation */}
      {tab !== "interactions" && tab !== "multimers" && tab !== "function" && tab !== "clinical" && tab !== "predictors" && tab !== "thresholds" && tab !== "guidelines" && (
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


