import React from "react";
import { Scissors, GitFork, CheckCircle2, Info, ExternalLink, Database, Dna, GitBranch, Cpu } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { THRESHOLDS } from "../../shared/thresholds/index.ts";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import {
  deriveSplicingEvidence,
  PROXIMITY_CONSENSUS_BP,
  PROXIMITY_CRITICAL_BP,
  type SpliceRuleOutcome,
  type SplicingEvidenceModel
} from "../../shared/splicingEvidence.ts";

interface SplicingInspectorProps {
  analysisResult: AnalysisResult | null;
  isBiophysicalLoading?: boolean;
}

/**
 * Supplementary companion to the RNA Splicing tab.
 *
 * Division of labour — the main column carries the decisive message (KPI values
 * and verdicts, the protein-vs-splicing comparison, the junction schematic).
 * This inspector carries what assists that message without being it:
 *
 *   1. Variant architecture detail  — coordinate-level plumbing behind the diagram
 *   2. Interpretation prose         — the "what does 16 bp mean" narrative
 *   3. Etiology methodology         — the dual-mechanism test description
 *   4. Model delta breakdown        — per-channel SpliceAI / dbscSNV diagnostics
 *   5. ACMG rule mapping            — criterion-by-criterion reference + coverage notice
 *   6. Provenance
 *
 * Every label and rule outcome comes from deriveSplicingEvidence, so this panel
 * can never contradict the main column.
 */
function RuleRow({ rule }: { rule: SpliceRuleOutcome }) {
  const state =
    rule.met === true
      ? { text: "Met", cls: "text-emerald-600 dark:text-emerald-400" }
      : rule.met === false
      ? { text: "Not met", cls: "text-cs-text-muted" }
      : { text: "N/A", cls: "text-cs-text-muted italic" };

  return (
    <div className="flex items-start justify-between gap-2 text-[10.5px]">
      <div className="min-w-0">
        <span className="font-mono font-semibold text-cs-text-primary">{rule.label}</span>
        <p className="text-[10px] text-cs-text-muted leading-snug mt-0.5">{rule.description}</p>
      </div>
      <span className={`font-mono font-semibold shrink-0 ${state.cls}`} title={rule.met === null ? "No predictor score covers this position" : undefined}>
        {state.text}
      </span>
    </div>
  );
}

/** Compact delta-score bar, sized for the inspector's 280-540px width. */
function DeltaBar({
  label,
  value,
  cutoff,
  cutoffLabel,
  isSpliceAi
}: {
  label: string;
  value: number | null;
  cutoff: number;
  cutoffLabel: string;
  isSpliceAi: boolean;
}) {
  const isUnavailable = value === null;
  const percentage = isUnavailable ? 0 : Math.max(0, Math.min(100, value * 100));

  let barColor = "bg-cs-good";
  if (isUnavailable) {
    barColor = "bg-cs-border";
  } else if (isSpliceAi) {
    if (value >= THRESHOLDS.spliceai.pathogenicHigh) barColor = "bg-cs-danger";
    else if (value >= THRESHOLDS.spliceai.pathogenicModerate) barColor = "bg-cs-warn";
  } else if (value >= THRESHOLDS.dbscsnv.spliceAltering) {
    barColor = "bg-cs-danger";
  }

  return (
    <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
      <div className="flex justify-between items-center gap-2 text-[11px]">
        <span className="text-cs-text-secondary truncate">{label}</span>
        <span className="font-mono font-semibold text-cs-text-primary shrink-0">
          {isUnavailable ? "—" : value.toFixed(3)}
        </span>
      </div>
      <div className="relative w-full h-1.5 rounded-full overflow-hidden border bg-cs-surface border-cs-border">
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-cs-danger/50 z-10"
          style={{ left: `${cutoff * 100}%` }}
          title={cutoffLabel}
        />
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function SectionLabel({
  Icon,
  children
}: {
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    /* Rendered as a real heading so the sidebar participates in screen-reader heading
       navigation. Previously every section label was a <span>, so the inspector — which
       now owns the ACMG rule mapping — was skipped entirely by heading traversal. */
    <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5 m-0">
      <Icon className="w-3.5 h-3.5 text-cs-accent-clay" />
      {children}
    </h3>
  );
}

export const SplicingInspector: React.FC<SplicingInspectorProps> = ({
  analysisResult,
  isBiophysicalLoading = false
}) => {
  // Read the SAME pipeline loading flag the main tab composes into its derivation.
  // Previously this pane passed only `isBiophysicalLoading`, so the two surfaces could
  // disagree on "Evaluating SpliceAI..." — defeating the point of a shared model.
  const isAnalysisLoading = useVariantAnalysisStore(s => s.analysisState.isLoading);

  const model: SplicingEvidenceModel | null = deriveSplicingEvidence(analysisResult, {
    isLoading: isBiophysicalLoading || isAnalysisLoading
  });

  if (!model) {
    return (
      <div className="text-xs text-cs-text-muted italic p-2">
        Awaiting variant analysis data...
      </div>
    );
  }

  const {
    spliceai,
    isSpliceAiLoading,
    maxDs,
    adaScore,
    rfScore,
    hasDbscsnv,
    distance,
    isNearSpliceSite,
    isCriticalJunctionProximity,
    isCanonicalJunction,
    exonLength,
    exonStart,
    exonEnd,
    strandLabel,
    regionType,
    transcriptId,
    displayExonLabel,
    displayIntronLabel,
    junctionType,
    verdictLabel,
    verdictBadgeClass,
    isPredictorCoverageAbsent,
    pathogenicRules,
    benignRules
  } = model;

  const hasSpliceAiChannels =
    spliceai !== null &&
    (spliceai.ds_ag !== null || spliceai.ds_al !== null || spliceai.ds_dg !== null || spliceai.ds_dl !== null);

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Variant architecture — the plumbing behind the schematic ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={Dna}>Variant Splice Architecture</SectionLabel>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Nearest Junction</span>
            <span className="font-mono font-semibold text-cs-text-primary capitalize">{junctionType}</span>
          </div>
          {/* Rows stack below `sm` and give the value `min-w-0` so it truncates rather
              than wrapping: the inspector can be dragged to 280px, where a label plus a
              long mono value no longer fits on one line. */}
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-cs-text-secondary">Region Type</span>
            <span className="font-mono font-semibold text-cs-text-primary capitalize sm:min-w-0 sm:truncate">{regionType ?? "Unmapped"}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-cs-text-secondary">Exon</span>
            <span className="font-mono font-semibold text-cs-text-primary sm:min-w-0 sm:truncate">{displayExonLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-cs-text-secondary">Adjacent Intron</span>
            <span className="font-mono text-cs-text-secondary sm:min-w-0 sm:truncate">{displayIntronLabel}</span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between pt-1.5 border-t border-cs-border-subtle">
            <span className="text-cs-text-secondary">Exon Bounds</span>
            <span
              className="font-mono text-cs-text-primary sm:min-w-0 sm:truncate"
              title={exonStart && exonEnd ? `chr:${exonStart} - ${exonEnd}` : undefined}
            >
              {exonStart && exonEnd ? `${exonStart.toLocaleString()} – ${exonEnd.toLocaleString()}` : "Unmapped"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-cs-text-secondary">Exon Length</span>
            <span className="font-mono text-cs-text-primary sm:min-w-0 sm:truncate">
              {exonLength ? `${exonLength.toLocaleString()} bp` : "Unmapped"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-cs-text-secondary">Strand</span>
            <span className="font-mono text-cs-text-secondary sm:min-w-0 sm:truncate">{strandLabel}</span>
          </div>
          {transcriptId && (
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-cs-text-secondary">Transcript</span>
              <span className="font-mono text-[9.5px] text-cs-text-muted sm:min-w-0 sm:truncate" title={transcriptId}>{transcriptId}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Interpretation prose — descriptive, not decisive ── */}
      <div className="flex flex-col gap-2">
        <SectionLabel Icon={GitBranch}>Proximity Interpretation</SectionLabel>

        {distance !== null ? (
          /* Severity must mirror the main column and the ACMG proximity rule: danger is
             reserved for the critical junction band (<=5 bp). The consensus flank
             (<=12 bp) is a warn band, never danger. */
          <div
            className={`p-3 rounded-lg border flex items-start gap-2 ${
              isCriticalJunctionProximity
                ? "border-cs-danger/25 bg-cs-bg-danger text-cs-text-danger-on-soft"
                : distance <= PROXIMITY_CONSENSUS_BP
                ? "border-cs-warn/25 bg-cs-bg-warning text-cs-text-primary"
                : "border-cs-border bg-cs-surface-2 text-cs-text-secondary"
            }`}
          >
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-80" />
            <p className="text-[10.5px] leading-relaxed">
              Variant resides in <strong className="font-mono">{displayExonLabel}</strong>, located{" "}
              <strong className="font-mono">{distance} bp</strong> from the {junctionType.toLowerCase()}.
              {isCriticalJunctionProximity ? (
                <>
                  {" "}This sits on the critical splice junction band (&le;{PROXIMITY_CRITICAL_BP} bp), where
                  disruption of the invariant donor/acceptor dinucleotide can provoke exon skipping or
                  intron retention.
                </>
              ) : isCanonicalJunction && distance <= PROXIMITY_CONSENSUS_BP ? (
                <>
                  {" "}This falls inside the &plusmn;{PROXIMITY_CONSENSUS_BP} bp perijunctional consensus region
                  flanking a junction, but outside the critical band, so it may affect splice-site recognition
                  without directly disrupting the invariant dinucleotide.
                </>
              ) : (
                <>
                  {" "}This places it beyond the &plusmn;{PROXIMITY_CONSENSUS_BP} bp perijunctional region that
                  splice-site predictors are classically characterised over. Absence of a score here is not
                  evidence of intact splicing — it means no predictor returned a value for this position, and
                  the reason is not inferable from distance alone.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2 text-cs-text-secondary">
            <Info className="w-3.5 h-3.5 text-cs-accent-clay mt-0.5 shrink-0" />
            <p className="text-[10.5px] leading-relaxed">
              Transcript coordinates mapped to Ensembl model {transcriptId ?? "canonical"}. Splice
              disruption probability is quantified across the machine learning consensus scores above.
            </p>
          </div>
        )}
      </div>

      {/* ── 3. Etiology methodology — how the main column's verdict is derived ── */}
      <div className="flex flex-col gap-2">
        <SectionLabel Icon={Scissors}>Etiology Attribution Method</SectionLabel>
        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5">
          <p className="text-[10.5px] text-cs-text-secondary leading-relaxed">
            The mechanistic verdict in the main column compares pre-mRNA splicing evidence (SpliceAI,
            dbscSNV, junction proximity) against post-translational protein stability evidence
            (FoldX &Delta;&Delta;G, AlphaMissense, REVEL). Whichever arm carries the evidence determines
            whether the variant is labelled splicing-dominant, structure-dominant, or dual-hit.
          </p>
          <p className="text-[10px] text-cs-text-muted leading-relaxed">
            A variant can be damaging while leaving splicing untouched; the two arms are evaluated
            independently rather than assumed to travel together.
          </p>
        </div>
      </div>

      {/* ── 4. SpliceAI deep-learning delta breakdown ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={Cpu}>SpliceAI Deep Learning Breakdown</SectionLabel>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Context</span>
            <span className="font-mono text-cs-text-muted">&plusmn;10,000 bp flanking</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Channels</span>
            <span className="font-mono text-cs-text-muted">AG / AL / DG / DL</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-cs-border-subtle">
            <span className="text-cs-text-secondary">Max Delta Score</span>
            <span className="font-mono font-semibold text-cs-text-primary">
              {maxDs !== null ? maxDs.toFixed(3) : "—"}
            </span>
          </div>
        </div>

        {isSpliceAiLoading ? (
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 animate-pulse" role="status" aria-busy="true">
            <span className="text-[10.5px] text-indigo-600 dark:text-indigo-400 font-mono">
              Computing deep learning delta scores...
            </span>
          </div>
        ) : hasSpliceAiChannels ? (
          <div className="space-y-2">
            <DeltaBar label="Acceptor Gain (ds_ag)" value={spliceai!.ds_ag} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi />
            <DeltaBar label="Acceptor Loss (ds_al)" value={spliceai!.ds_al} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi />
            <DeltaBar label="Donor Gain (ds_dg)" value={spliceai!.ds_dg} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi />
            <DeltaBar label="Donor Loss (ds_dl)" value={spliceai!.ds_dl} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi />
          </div>
        ) : (
          /* Reached only when no channel carries a score — either SpliceAI never ran
             (null object) or it returned an object with all four channels null. The
             latter is NOT evidence of basal splicing, so neither case may claim that
             the channels are "below threshold": nothing was measured. */
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[10.5px]">
              <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0" />
              <span>Deep Learning Data Unavailable</span>
            </div>
            <p className="text-[10px] text-cs-text-muted leading-relaxed">
              {spliceai !== null
                ? "SpliceAI returned no delta score for any of the four channels at this position, so no aberrant-splicing call can be made."
                : "No precomputed or runtime SpliceAI delta scores exist for this genomic position."}
            </p>
          </div>
        )}
      </div>

      {/* ── 5. dbscSNV consensus ensemble models ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={GitFork}>dbscSNV Consensus Ensembles</SectionLabel>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">AdaBoost (ADA)</span>
            <span className="font-mono font-semibold text-cs-text-primary">
              {adaScore !== null ? adaScore.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-cs-text-secondary">Random Forest (RF)</span>
            <span className="font-mono font-semibold text-cs-text-primary">
              {rfScore !== null ? rfScore.toFixed(3) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-cs-border-subtle">
            <span className="text-cs-text-muted">Cutoff</span>
            <span className="font-mono text-cs-text-muted">
              &ge; {THRESHOLDS.dbscsnv.spliceAltering} &rarr; Altering
            </span>
          </div>
        </div>

        {hasDbscsnv ? (
          <div className="space-y-2">
            <DeltaBar label="AdaBoost (ADA_SCORE)" value={adaScore} cutoff={THRESHOLDS.dbscsnv.spliceAltering} cutoffLabel={`Altering (${THRESHOLDS.dbscsnv.spliceAltering})`} isSpliceAi={false} />
            <DeltaBar label="Random Forest (RF_SCORE)" value={rfScore} cutoff={THRESHOLDS.dbscsnv.spliceAltering} cutoffLabel={`Altering (${THRESHOLDS.dbscsnv.spliceAltering})`} isSpliceAi={false} />
          </div>
        ) : (
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[10.5px]">
              <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0" />
              <span>Outside dbscSNV Canonical Flank</span>
            </div>
            <p className="text-[10px] text-cs-text-muted leading-relaxed">
              dbscSNV annotations are restricted to the donor (&minus;3 to +8 bp) and acceptor
              (&minus;12 to +2 bp) windows
              {distance !== null ? `; this variant is ${distance} bp away.` : "."}
            </p>
          </div>
        )}
      </div>

      {/* ── 6. ACMG rule mapping — criterion reference + coverage notice ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={CheckCircle2}>ACMG Rule Mapping</SectionLabel>

        {/* Stacked rather than side-by-side: at the 280px clamp the longest verdict
            ("Pathogenic Supporting (PP3)") plus its label needs ~270px against ~217px
            of available row width, which previously wrapped both label and chip. */}
        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 flex flex-col gap-1.5">
          <span className="text-[10.5px] text-cs-text-secondary">Splicing Verdict</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono border w-fit ${verdictBadgeClass}`}>
            {verdictLabel}
          </span>
        </div>

        {/* Coverage notice: absent predictor scores must never read as benign. */}
        {isPredictorCoverageAbsent && (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0 mt-0.5" />
            <p className="text-[10px] text-cs-text-muted leading-relaxed">
              No SpliceAI or dbscSNV score covers this position, so the criteria below are
              <strong className="text-cs-text-secondary"> not applicable</strong> rather than
              supportive of a benign classification.
            </p>
          </div>
        )}

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
          <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
            PP3 (Pathogenic Supporting)
          </span>
          <div className="space-y-2">
            {pathogenicRules.map(rule => (
              <RuleRow key={rule.label} rule={rule} />
            ))}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
          <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
            BP4 (Benign Supporting)
          </span>
          <div className="space-y-2">
            {benignRules.map(rule => (
              <RuleRow key={rule.label} rule={rule} />
            ))}
          </div>
          <p className="text-[10px] text-cs-text-muted leading-relaxed pt-1.5 border-t border-cs-border-subtle">
            Proximity is deliberately not listed as a BP4 criterion: the evaluator requires benign
            predictor evidence, so distance from the junction cannot support a benign call on its own.
          </p>
        </div>

        {/* Provenance */}
        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-cs-text-primary">SpliceAI</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">v1.3.1 &middot; Jaganathan 2019</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-cs-text-primary">dbscSNV</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">Jian 2014 &middot; Hum Mutat</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-semibold text-cs-text-primary">ClinGen SVI</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">PP3 / BP4 framework</span>
          </div>
          <a
            href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6400593/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cs-accent-clay hover:underline pt-1"
          >
            <span>PubMed</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2">
          <Database className="w-3.5 h-3.5 text-cs-accent-clay shrink-0 mt-0.5" />
          <p className="text-[10px] text-cs-text-muted leading-relaxed">
            Splice junction geometry resolved against the Ensembl transcript model
            {transcriptId ? ` (${transcriptId})` : ""} on GRCh38.
          </p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SplicingInspector);
