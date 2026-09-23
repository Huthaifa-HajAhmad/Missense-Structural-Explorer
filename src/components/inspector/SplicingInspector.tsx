import React, { useMemo } from "react";
import { Scissors, GitFork, CheckCircle2, Info, Database, Dna, GitBranch, Cpu } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { THRESHOLDS } from "../../shared/thresholds/index.ts";
import { SectionLabel } from "./SectionLabel";
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
  isSpliceAi,
  shiftLabel
}: {
  label: string;
  value: number | null;
  cutoff: number;
  cutoffLabel: string;
  isSpliceAi: boolean;
  /** Where this channel's shift lands, relative to the variant (e.g. "+123 bp"). */
  shiftLabel?: string | null;
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
          {/* The shift offset answers "where", which the delta score alone cannot: a large
              offset with a small score means the change lands far from any junction. */}
          {shiftLabel ? <span className="text-cs-text-muted font-normal mr-1.5">{shiftLabel}</span> : null}
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

/**
 * Describe where a SpliceAI number came from, in words a reader can act on.
 *
 * The three sources genuinely differ and legitimately disagree on borderline variants, so
 * "SpliceAI v1.3.1 · Jaganathan 2019" was misleading: it stated one tool version for a number
 * that may have come from a frozen table computed years earlier against an older annotation.
 */
function describeSpliceAiSource(
  provenance: {
    source: "broad-lookup" | "precomputed-dbnsfp" | "genos";
    masked?: number | null;
    computedLive?: boolean;
    annotationSet?: string | null;
  } | null
): string {
  if (!provenance) return "not stated";
  if (provenance.source === "broad-lookup") {
    const masked = provenance.masked === 1 ? "masked" : provenance.masked === 0 ? "raw" : null;
    return ["Broad Lookup (live)", masked].filter(Boolean).join(" \u00b7 ");
  }
  if (provenance.source === "genos") return "Genos (precomputed)";
  return "dbNSFP (precomputed, GENCODE v24)";
}

export const SplicingInspector: React.FC<SplicingInspectorProps> = ({
  analysisResult,
  isBiophysicalLoading = false
}) => {
  // Read the SAME pipeline loading flag the main tab composes into its derivation.
  // Previously this pane passed only `isBiophysicalLoading`, so the two surfaces could
  // disagree on "Evaluating SpliceAI..." — defeating the point of a shared model.
  const isAnalysisLoading = useVariantAnalysisStore(s => s.analysisState.isLoading);
  const isLoading = isBiophysicalLoading || isAnalysisLoading;

  const model: SplicingEvidenceModel | null = useMemo(
    () => deriveSplicingEvidence(analysisResult, { isLoading }),
    [analysisResult, isLoading]
  );

  if (!model) {
    return (
      <div className="text-xs text-cs-text-muted italic p-2">
        Awaiting variant analysis data...
      </div>
    );
  }

  const {
    spliceai,
    spliceaiProvenance,
    isSpliceAiLoading,
    maxDs,
    adaScore,
    rfScore,
    hasDbscsnv,
    dbscFlankMeasurable,
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
    ensemblTranscriptId,
    displayExonLabel,
    displayIntronLabel,
    junctionType,
    verdictLabel,
    verdictBadgeClass,
    isPredictorCoverageAbsent,
    proximityRefusal,
    pathogenicRules,
    benignRules
  } = model;

  const hasSpliceAiChannels =
    spliceai !== null &&
    (spliceai.ds_ag !== null || spliceai.ds_al !== null || spliceai.ds_dg !== null || spliceai.ds_dl !== null);

  /**
   * Per-channel shift offsets, shown beside each bar.
   *
   * `dp` says WHERE splicing changes relative to the variant; the delta score only says how
   * much. A large |dp| with a small score is the signature of a variant far from any junction,
   * which is the case the README's own worked example demonstrates (-28/-46/-2/-31). Without it
   * a reader cannot tell a genuine near-junction shift from a distant one.
   */
  const dpFor = (key: "ds_ag" | "ds_al" | "ds_dg" | "ds_dl"): string | null => {
    const value = spliceai?.dp?.[key];
    if (value === null || value === undefined) return null;
    return `${value > 0 ? "+" : ""}${value} bp`;
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Variant architecture — the plumbing behind the schematic ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={Dna}>Variant Splice Architecture</SectionLabel>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1.5 text-[10.5px]">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-cs-text-secondary">Nearest Junction</span>
            {/* Same truncate contract as every row below: the inspector clamps to 280px, and
                the neutral states now carry long honest strings ("Splice Junction (orientation
                not resolved)") that used to wrap the only un-truncated row (review UI#6).
                `capitalize` removed: it title-cased the disclaimers into nonsense. */}
            <span className="font-mono font-semibold text-cs-text-primary sm:min-w-0 sm:truncate" title={junctionType}>{junctionType}</span>
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
              <span
                className="font-mono text-[9.5px] text-cs-text-muted sm:min-w-0 sm:truncate"
                title={ensemblTranscriptId && transcriptId !== ensemblTranscriptId ? `${transcriptId} (Ensembl: ${ensemblTranscriptId})` : transcriptId}
              >
                {transcriptId}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Interpretation prose — descriptive, not decisive ── */}
      <div className="flex flex-col gap-2">
        <SectionLabel Icon={GitBranch}>Proximity Interpretation</SectionLabel>

        {distance !== null ? (
          /* Severity must mirror the main column and the ACMG proximity rule: danger is
             reserved for the critical junction band (<=5 bp). The consensus flank (<=12 bp)
             is a warn band, never danger — and never at all when the nearest boundary is not
             a splice junction: a terminal variant at 2 bp used to read "located 2 bp from the
             transcript terminus … places it beyond the ±12 bp perijunctional region", a false
             distance claim self-contradicting in one sentence (external review UI#2). */
          <div
            className={`p-3 rounded-lg border flex items-start gap-2 ${
              isCriticalJunctionProximity
                ? "border-cs-danger/25 bg-cs-bg-danger text-cs-text-danger-on-soft"
                : isCanonicalJunction && distance <= PROXIMITY_CONSENSUS_BP
                ? "border-cs-warn/25 bg-cs-bg-warning text-cs-text-primary"
                : "border-cs-border bg-cs-surface-2 text-cs-text-secondary"
            }`}
          >
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-80" />
            <p className="text-[10.5px] leading-relaxed">
              {regionType === "exonic" || regionType === "intronic" ? (
                <>
                  Variant resides in <strong className="font-mono">{regionType === "exonic" ? displayExonLabel : displayIntronLabel}</strong>, located{" "}
                  <strong className="font-mono">{distance} bp</strong> from the {junctionType.toLowerCase().replace(/\b(gt|ag)\b/g, (m) => m.toUpperCase())}.
                </>
              ) : (
                <>
                  Variant lies outside the mapped transcript span,{" "}
                  <strong className="font-mono">{distance} bp</strong> from the nearest annotated boundary.
                </>
              )}
              {isCriticalJunctionProximity ? (
                <>
                  {" "}This sits on the critical splice junction band (&le;{PROXIMITY_CRITICAL_BP} bp), where
                  disruption of the invariant donor/acceptor dinucleotide can provoke exon skipping or
                  intron retention.
                </>
              ) : !isCanonicalJunction ? (
                <>
                  {" "}The nearest boundary is not a splice junction (a transcript terminus, or no canonical
                  junction identified), so perijunctional proximity rules do not apply at this distance and
                  no flank claim is made.
                </>
              ) : distance <= PROXIMITY_CONSENSUS_BP ? (
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
          /* No geometry. The old text asserted "Transcript coordinates MAPPED to Ensembl model
             …" directly beneath a table where every coordinate row read "Unmapped" — a false
             cause for a refusal the layer above actually knows the reason for (unmapping
             defect F-10/F-13). State the refusal, verbatim when it is recorded. */
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2 text-cs-text-secondary">
            <Info className="w-3.5 h-3.5 text-cs-accent-clay mt-0.5 shrink-0" />
            <p className="text-[10.5px] leading-relaxed">
              {proximityRefusal ??
                "Junction geometry could not be resolved against a transcript exon model for this variant."}{" "}
              Sequence-based scores above are computed independently of transcript geometry.
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
          <div className="flex justify-between items-center gap-2">
            <span className="text-cs-text-secondary shrink-0">Source</span>
            <span className="font-mono text-cs-text-muted text-right">
              {describeSpliceAiSource(spliceaiProvenance)}
            </span>
          </div>
          {/*
            The reporting window, taken from provenance rather than hardcoded. It previously read
            "±10,000 bp flanking" for every variant: that is the model's INPUT context (and
            SpliceAI's published context is 10,000 nt total, i.e. ±5,000), not the window the
            number was produced under — the live request uses 500 bp and the frozen dbNSFP
            columns used 50 bp.
          */}
          <div className="flex justify-between items-center gap-2">
            <span className="text-cs-text-secondary shrink-0">Reporting window</span>
            <span className="font-mono text-cs-text-muted text-right">
              {spliceaiProvenance?.distanceBp != null
                ? `\u00b1${spliceaiProvenance.distanceBp} bp`
                : "not stated"}
            </span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-cs-text-secondary shrink-0">Channels</span>
            <span className="font-mono text-cs-text-muted text-right">AG / AL / DG / DL</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-cs-border-subtle gap-2">
            <span className="text-cs-text-secondary shrink-0">Max Delta Score</span>
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
            <DeltaBar label="Acceptor Gain (ds_ag)" value={spliceai!.ds_ag} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi shiftLabel={dpFor("ds_ag")} />
            <DeltaBar label="Acceptor Loss (ds_al)" value={spliceai!.ds_al} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi shiftLabel={dpFor("ds_al")} />
            <DeltaBar label="Donor Gain (ds_dg)" value={spliceai!.ds_dg} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi shiftLabel={dpFor("ds_dg")} />
            <DeltaBar label="Donor Loss (ds_dl)" value={spliceai!.ds_dl} cutoff={THRESHOLDS.spliceai.pathogenicModerate} cutoffLabel={`Moderate (${THRESHOLDS.spliceai.pathogenicModerate})`} isSpliceAi shiftLabel={dpFor("ds_dl")} />
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
        ) : dbscFlankMeasurable ? (
          /* "Outside the window" is a real, checkable statement only when the distance was
             MEASURED and exceeds the flank (external review M-7): at 3 bp from a TERMINAL
             boundary this header used to print "outside the canonical flank … is 3 bp away" —
             the claim-class F-9 retired, re-entering through the branch condition. */
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[10.5px]">
              <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0" />
              <span>Outside dbscSNV Canonical Flank</span>
            </div>
            <p className="text-[10px] text-cs-text-muted leading-relaxed">
              dbscSNV annotations are restricted to the donor (&minus;3 to +8 bp) and acceptor
              (&minus;12 to +2 bp) windows; this variant is {distance} bp from the nearest junction.
            </p>
          </div>
        ) : (
          /* Either no measured distance at all, or a small distance whose boundary is not a
             canonical junction: in both cases "outside the flank" is an assertion about a
             window the variant was never measured against (unmapping defect F-9). Absence of
             a score is not evidence of an intact motif. */
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-cs-text-primary text-[10.5px]">
              <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0" />
              <span>dbscSNV Not Assessed</span>
            </div>
            <p className="text-[10px] text-cs-text-muted leading-relaxed">
              No dbscSNV score was returned for this position{distance === null ? ", and junction distance is unresolved" : ""},
              so the score's absence says nothing about the motif — it is not evidence that the
              variant sits outside the donor/acceptor windows.
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

        {/* Provenance. Each row links the source it actually names: the card previously offered
            a single unlabelled "PubMed" link to PMC6400593, which resolves to
            "Implementation Science in Nutrition" — unrelated to any of the three tools whose
            provenance this block asserts. */}
        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary shrink-0">SpliceAI</span>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/30661751/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9.5px] text-cs-accent-clay hover:underline text-right"
            >
              Jaganathan 2019, Cell
            </a>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary shrink-0">dbscSNV</span>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/25313161/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9.5px] text-cs-accent-clay hover:underline text-right"
            >
              Jian 2014, Nucleic Acids Res
            </a>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary shrink-0">ClinGen SVI</span>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/36413997/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9.5px] text-cs-accent-clay hover:underline text-right"
            >
              Pejaver 2022, PP3/BP4
            </a>
          </div>
        </div>

        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2">
          <Database className="w-3.5 h-3.5 text-cs-accent-clay shrink-0 mt-0.5" />
          {/*
            The build is NOT stated here. This line used to assert "on GRCh38" unconditionally,
            which became false once GRCh37 input was supported and SpliceAI was routed per build.
            The resolved build reaches the client on the translate response, but this inspector
            does not receive it, so rather than assert a build it cannot know, it describes the
            model the coordinates came from and defers the build to the source row above.
          */}
          <p className="text-[10px] text-cs-text-muted leading-relaxed">
            Splice junction geometry resolved against the Ensembl transcript model
            {ensemblTranscriptId ? ` (${ensemblTranscriptId})` : transcriptId ? ` (${transcriptId})` : ""}. SpliceAI scores are computed on the build
            reported in the Source row.
          </p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SplicingInspector);
