import React, { useMemo, useId } from "react";
import {
  Scissors,
  AlertTriangle,
  Info,
  GitFork,
  Dna,
  Activity,
  ArrowRight,
  ShieldCheck,
  Zap,
  Layers
} from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { THRESHOLDS } from "../../shared/thresholds";
import { buildEngineOutcomes, ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { resolveEvidenceAvailability } from "../../shared/evidenceAvailability";
import { deriveSplicingEvidence, LOADING_BADGE } from "../../shared/splicingEvidence.ts";

/**
 * RNA Splicing Disruption & Mechanistic Etiology — main column.
 *
 * This surface carries the decisive message only: the KPI values and verdicts,
 * the protein-vs-splicing attribution comparison, and the junction schematic.
 *
 * The supplementary material that used to live here (model delta breakdowns,
 * ACMG criterion-by-criterion mapping, coordinate plumbing, interpretation
 * prose and provenance notices) has moved to the Evidence Inspector sidebar —
 * see components/inspector/SplicingInspector.tsx. Both surfaces derive their
 * labels from shared/splicingEvidence.ts so they cannot disagree.
 */
function SplicingTabComponent({
  analysisState,
  isBiophysicalLoading,
  foldingDdG,
  onTabChange
}: TabComponentProps) {
  const result = analysisState.result;

  const evidence = useMemo(
    () =>
      deriveSplicingEvidence(result, {
        isLoading: isBiophysicalLoading || analysisState.isLoading
      }),
    [result, isBiophysicalLoading, analysisState.isLoading]
  );

  // Protein-level evidence for the attribution comparison.
  const foldxVal = useMemo(() => {
    if (!result) return null;
    const isFoldxFailed = Boolean(
      result.foldingEnergetics?.foldxRepairFailed || result.foldingEnergetics?.foldxBinaryMissing
    );
    if (isFoldxFailed) return null;
    return foldingDdG ?? result.foldingEnergetics?.foldxMean ?? result.foldingEnergetics?.foldx ?? null;
  }, [result, foldingDdG]);

  // Protein-arm raw inputs. Read once here so the etiological verdict and the misfolding
  // card below cannot drift apart by re-deriving them from different expressions.
  const alphamissenseScore = result?.predictorData?.amPathogenicity ?? null;
  const revelScore = result?.conservationData?.revel ?? null;

  /**
   * Canonical per-engine outcomes for the protein arm, from the shared engine contract, so this
   * surface applies each engine's own calibrated cut-points instead of hand-written comparisons.
   */
  const proteinEngineOutcomes = useMemo(() => {
    const energetics = result?.foldingEnergetics as any;
    return buildEngineOutcomes({
      foldxDdg: energetics?.foldx ?? null,
      foldxMean: energetics?.foldxMean ?? null,
      dynamut2: energetics?.dynamut2 ?? null,
      ddmut: energetics?.ddmut ?? null,
      rasp: energetics?.rasp ?? null,
      thermompnn: energetics?.thermompnn ?? null,
      stabilityoracle: energetics?.stabilityoracle ?? null,
      foldxRepairFailed: energetics?.foldxRepairFailed ?? false,
      foldxBinaryMissing: energetics?.foldxBinaryMissing ?? false,
    });
  }, [result]);

  /**
   * True when the protein arm carries destabilization evidence. Single definition,
   * consumed by both the etiology verdict and the Protein Tertiary Misfolding card.
   *
   * Each engine is judged on its OWN calibrated cut-points via the shared engine contract. The
   * previous fourth clause compared `consensusVerdict` against the literal `"destabilizing"`,
   * which `computeCalibratedConsensus` can never return (it returns "… Misfolding Risk (…)"), so
   * the clause was dead: a variant whose only evidence was a strongly destabilizing prediction
   * from DynaMut2/DDMut/RaSP/ThermoMPNN/StabilityOracle was reported as "Thermodynamically
   * Tolerated" — the opposite of its evidence. `consensusVerdict.guard.test.ts` now rejects any
   * comparison against a string the consensus cannot produce.
   */
  const isProteinDestabilized = useMemo(
    () =>
      (foldxVal !== null && foldxVal >= THRESHOLDS.foldxDdG.destabilizingStrong) ||
      (alphamissenseScore !== null && alphamissenseScore >= THRESHOLDS.alphaMissense.pathogenicSupporting) ||
      (revelScore !== null && revelScore >= THRESHOLDS.revel.pathogenicSupporting) ||
      proteinEngineOutcomes.some(outcome => outcome.contributesToConsensus && outcome.risk?.id === "high"),
    [foldxVal, alphamissenseScore, revelScore, proteinEngineOutcomes]
  );

  /**
   * Mechanistic etiology: which arm of the evidence carries the pathogenicity.
   * Hoisted above the null guard so hook order stays stable.
   */
  const etiologyVerdict = useMemo(() => {
    if (!evidence) {
      return {
        title: "Unannotated / Pending",
        badgeClass: "cs-badge cs-badge-muted",
        description: "Genomic splice proximity and deep learning models unavailable for this coordinate."
      };
    }

    if (evidence.isSpliceAiLoading) {
      return {
        title: "Evaluating Splicing...",
        badgeClass: LOADING_BADGE,
        description: "Assessing deep learning sequence context across SpliceAI residual channels."
      };
    }

    // Both predicates are defined once above/inside the shared model so the panes
    // cannot disagree: the splicing arm comes from the shared derivation, the protein
    // arm from the single hoisted predicate.
    const isSplicingDisrupted = evidence.isSplicingDisrupted;

    if (isSplicingDisrupted && isProteinDestabilized) {
      return {
        title: "Dual-Hit Mechanism",
        badgeClass: "cs-badge cs-badge-path",
        description: "Concurrent pre-mRNA splicing defect and tertiary protein destabilization."
      };
    }
    if (isSplicingDisrupted) {
      return {
        title: "Splicing-Dominant Etiology",
        badgeClass: "cs-badge cs-badge-path",
        description: "Pathogenicity operates primarily via transcript loss, exon skipping, or NMD decay."
      };
    }
    if (isProteinDestabilized) {
      return {
        title: "Tertiary Structure-Dominant",
        badgeClass: "cs-badge cs-badge-warn",
        description:
          "No splicing disruption signal; pathogenicity is driven by post-translational protein misfolding."
      };
    }

    // No positive signal on either arm. Distinguish "we measured and saw nothing"
    // from "nothing measured us" — the latter must never read as a benign result.
    if (evidence.isPredictorCoverageAbsent) {
      return {
        title: "No Splice Signal Detected",
        badgeClass: "cs-badge cs-badge-muted",
        description:
          "No SpliceAI or dbscSNV score covers this position, so splicing impact is indeterminate rather than absent."
      };
    }

    if (evidence.maxDs !== null) {
      return {
        title: "Preserved / Basal Splice Motif",
        badgeClass: "cs-badge cs-badge-good",
        description: "SpliceAI and the dbscSNV ensemble both indicate basal, non-disrupted splicing."
      };
    }

    return {
      title: "Unannotated / Pending",
      badgeClass: "cs-badge cs-badge-muted",
      description: "Genomic splice proximity and deep learning models unavailable for this coordinate."
    };
  }, [evidence, isProteinDestabilized]);

  // Stable hook for the SVG gradient IDs regardless of early return.
  const gradIdSuffix = useId().replace(/:/g, "_");
  const exonGradId = `exonGradSplicing_${gradIdSuffix}`;
  const criticalZoneGradId = `criticalZoneGradSplicing_${gradIdSuffix}`;

  if (!result || !evidence) return null;

  const {
    maxDs,
    maxDbsc,
    distance,
    isNearSpliceSite,
    isExonicVariant,
    isDonor,
    isAcceptor,
    junctionType,
    exonLength,
    displayExonLabel,
    displayIntronLabel,
    strandLabel,
    transcriptId,
    ensemblTranscriptId,
    dsLabel,
    dsBadgeClass,
    proximityLabel,
    proximityBadgeClass,
    dbscLabel,
    dbscBadgeClass,
    splicingAttribution,
    isSplicingDominant,
    hasAlphaGenome,
    isSpliceAiLoading,
    isPredictorCoverageAbsent,
    isSplicingDisrupted,
    isCriticalJunctionProximity,
    verdictLabel,
    verdictBadgeClass,
    proximityRefusal,
    alphagenomeRefusal,
    alphagenomeStatus
  } = evidence;

  /**
   * Why AlphaGenome has no value here, decided by the shared resolver rather than by a ternary at
   * the call site. The previous `refusal ? not-covered : not-installed` was right about the one
   * case the unmapping defect happened to hit and wrong about the rest: a provider timeout or an
   * unindexed variant both fell through to "Not available here", which tells the user a binary is
   * missing when nothing is missing.
   *
   * `configured` and `message` are passed exactly as the AlphaGenome tab and the specialist panels
   * pass them (review UI#1): without `configured`, a keyless deployment falls to the resolver's
   * provider-error branch and this card says "retry" while the AlphaGenome tab says "go to
   * Settings" — two surfaces, one absence, opposite claims. The resolver's own contract is that
   * `configured` is omitted only when the surface genuinely cannot know; this one can.
   */
  const { settings } = useSettings();
  const alphaGenomeAvailability = resolveEvidenceAvailability({
    // The value itself, not a per-site boolean — see evidenceAvailability.ts. A non-null splicing
    // attribution only exists when AlphaGenome answered, so no extra `hasAlphaGenome` coupling is
    // needed, and adding it here would re-create the disagreement the `value` field removes.
    value: splicingAttribution,
    status: alphagenomeStatus,
    refusal: alphagenomeRefusal,
    // Tri-state, per the resolver's own contract: this page can attest only to a key the browser
    // holds. A definite `false` would outrank the provider's message and send a server-keyed
    // deployment to Settings for what may be an outage or a coverage miss.
    configured: settings.alphagenomeApiKey?.trim() ? true : undefined,
    message: result?.conservationData?.alphagenome?.message ?? null,
  });

  // ---------------------------------------------------------------------------
  // Genomic schematic geometry (960 x 240)
  // Donor site:    [Exon (5', left)]   ── GT ─ [Intron (3', right)]
  // Acceptor site: [Intron (5', left)] ── AG ─ [Exon (3', right)]
  // Neither known: neutral boundary — the diagram may not claim an orientation,
  // a motif, or a side the resolver did not measure (unmapping defect F-11/F-15).
  // ---------------------------------------------------------------------------
  const orientationKnown = isDonor || isAcceptor;
  const isOffScale = distance !== null && distance > 60;
  const clampedDistance =
    typeof distance === "number" && Number.isFinite(distance) && distance >= 0
      ? Math.min(distance, 60)
      : null;

  let pinX = 480;
  if (clampedDistance !== null) {
    if (!orientationKnown) {
      // Both candidate sides are drawn; the chip position follows the right-hand one.
      pinX = 480 + clampedDistance * 6.3;
    } else if (isDonor) {
      pinX = isExonicVariant ? 480 - clampedDistance * 6.3 : 480 + clampedDistance * 6.3;
    } else {
      pinX = isExonicVariant ? 480 + clampedDistance * 6.3 : 480 - clampedDistance * 6.3;
    }
  }

  // Linear scale ticks mathematically aligned with the variant pin projection (6.3 px/bp):
  // -25 bp = 480 - (25 * 6.3) = 322.5
  // +25 bp = 480 + (25 * 6.3) = 637.5
  const leftTickX = 322.5;
  const rightTickX = 637.5;

  const chipSignLabel = !orientationKnown
    ? `±${distance} bp (side not resolved)`
    : isDonor
    ? isExonicVariant
      ? `-${distance} bp (Exonic)`
      : `+${distance} bp (Intronic)`
    : isExonicVariant
    ? `+${distance} bp (Exonic)`
    : `-${distance} bp (Intronic)`;

  const chipText = isOffScale ? `${distance} bp (>60 bp scale)` : chipSignLabel;
  // Dynamic width sized to content so text never overflows the chip box:
  const chipWidth = Math.max(120, Math.min(220, chipText.length * 7.5 + 28));
  // Horizontally clamp within the 960 viewBox with 16px safety margin:
  const chipX = Math.max(16, Math.min(960 - chipWidth - 16, pinX - chipWidth / 2));
  const chipTextX = chipX + chipWidth / 2;

  // Unoriented candidate chip width centered at junction x=480:
  const unorientedChipWidth = Math.max(160, Math.min(260, chipText.length * 7.5 + 28));

  // Off-scale break mark on the axis/body between pin and junction, clear of the pin circle:
  const breakX = pinX < 480 ? pinX + 35 : pinX - 35;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="screen-title flex items-center gap-2 text-left">
          <Scissors className="w-5 h-5 text-cs-accent-clay" />
          RNA Splicing Disruption &amp; Mechanistic Etiology
        </h1>
        <p className="screen-tab-description">
          Evaluation of mutation impact on pre-mRNA splicing mechanisms via splice site proximity,
          SpliceAI deep learning models, dbscSNV consensus ensembles, and AlphaGenome multimodal
          attribution.
        </p>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: Executive KPI Banner (5 Cards)                                 */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: SpliceAI Max Delta Score */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[12px] font-semibold font-sans text-cs-text-primary">
                SpliceAI Max Delta
              </span>
              <Activity className="w-3.5 h-3.5 text-cs-text-muted" />
            </div>
            <div className="text-[20px] font-semibold font-mono tracking-tight text-cs-text-primary mt-1.5">
              {maxDs !== null ? maxDs.toFixed(3) : "—"}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${dsBadgeClass}`}>
            {dsLabel}
          </span>
        </div>

        {/* Card 2: Splice Site Proximity */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[12px] font-semibold font-sans text-cs-text-primary">
                Splice Site Proximity
              </span>
              <Scissors className="w-3.5 h-3.5 text-cs-accent-clay" />
            </div>
            <div className="mt-1.5 flex items-baseline">
              <span className="text-[20px] font-semibold font-mono tracking-tight text-cs-text-primary">
                {distance !== null ? distance : "—"}
              </span>
              {distance !== null && (
                <span className="text-[11px] font-sans font-medium text-cs-text-muted ml-1.5">
                  bp from junction
                </span>
              )}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${proximityBadgeClass}`}>
            {proximityLabel}
          </span>
        </div>

        {/* Card 3: dbscSNV Alteration */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[12px] font-semibold font-sans text-cs-text-primary">
                dbscSNV Consensus
              </span>
              <GitFork className="w-3.5 h-3.5 text-cs-text-muted" />
            </div>
            <div className="text-[20px] font-semibold font-mono tracking-tight text-cs-text-primary mt-1.5">
              {maxDbsc !== null ? maxDbsc.toFixed(3) : "—"}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${dbscBadgeClass}`}>
            {dbscLabel}
          </span>
        </div>

        {/* Card 4: AlphaGenome splicing attribution.
            Shows the splicing-specific SHAP attribution ONLY. The aggregate AVI
            Phred is a different quantity and is not displayed under this label. */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[12px] font-semibold font-sans text-cs-text-primary">
                AlphaGenome Splicing
              </span>
              <Layers className="w-3.5 h-3.5 text-cs-accent-clay" />
            </div>
            <div className="text-[20px] font-semibold font-mono tracking-tight text-cs-text-primary mt-1.5">
              {splicingAttribution !== null
                ? `${(splicingAttribution * 100).toFixed(1)}%` /* SHAP values are signed */
                : "—"}
            </div>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${
              isSplicingDominant ? "cs-badge cs-badge-path" : "cs-badge cs-badge-muted"
            }`}
            title={alphaGenomeAvailability.reason ?? undefined}
          >
            {isSplicingDominant
              ? "Primary Driver"
              : !hasAlphaGenome
              ? // The two absences the engine contract already names — "Not covered" (the build gate
                // refused this coordinate, not fixable by configuration) vs "Not available here" (no
                // data source in this deployment, operator-fixable) — plus the provider cases the
                // old inline ternary had no branch for. Collapsing them sent users re-pasting an
                // API key that was never the problem (unmapping defect F-14).
                (alphaGenomeAvailability.label ?? ENGINE_STATE_LABELS["no-result"])
              : "No Splicing Attribution"}
          </span>
          {/* The refusal/absence reason as visible text, not only a hover title: keyboard and
              touch users get nothing from `title`, and the reason is the whole point of the
              refusal surfacing (review UI#4). */}
          {!isSplicingDominant && !hasAlphaGenome && alphaGenomeAvailability.reason && (
            <p className="text-[10px] font-sans text-cs-text-muted mt-1.5 leading-snug">
              {alphaGenomeAvailability.reason}
            </p>
          )}
        </div>

        {/* Card 5: Mechanistic Etiology Verdict */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[12px] font-semibold font-sans text-cs-text-primary">
                Mechanistic Etiology
              </span>
              <ShieldCheck className="w-3.5 h-3.5 text-cs-good" />
            </div>
            <div className="text-[13px] font-semibold font-sans tracking-tight text-cs-text-primary mt-2 leading-snug">
              {etiologyVerdict.title}
            </div>
          </div>
          {/* Badge derived from the verdict itself — must never assert a mechanism
              that the computed verdict does not report. */}
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${etiologyVerdict.badgeClass}`}>
            {etiologyVerdict.title}
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: Mechanistic Etiology Attribution (Protein vs. Splicing)       */}
      {/* ========================================================================= */}
      <div className="p-5 rounded-xl border border-cs-border bg-cs-surface space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cs-border-subtle pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-cs-accent-clay" />
            <div>
              <h3 className="text-[13px] font-semibold text-cs-text-primary font-sans">
                Mechanistic Etiology Attribution: Protein Misfolding vs. Splicing Disruption
              </h3>
            </div>
          </div>
          <div className="shrink-0 flex flex-wrap items-center gap-2">
            {/* ACMG criterion verdict — decisive content that must stay in the main
                column, because the inspector can be collapsed to a 40px rail. */}
            <span className={`px-2.5 py-1 rounded text-[11px] font-semibold font-mono border ${verdictBadgeClass}`}>
              {verdictLabel}
            </span>
            <span className={`px-2.5 py-1 rounded text-[11px] font-semibold font-mono border ${etiologyVerdict.badgeClass}`}>
              {etiologyVerdict.title}
            </span>
          </div>
        </div>

        {/* Per-variant etiology narrative. Previously defined but rendered nowhere, so the
            verdict appeared without its justification. */}
        <p className="text-[12px] text-cs-text-secondary font-sans leading-relaxed">
          {etiologyVerdict.description}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left Column: Pre-mRNA Splicing Evidence */}
          <div className="p-4 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-cs-text-primary flex items-center gap-1.5 font-sans">
                <Scissors className="w-3.5 h-3.5 text-cs-accent-clay" />
                Pre-mRNA Splicing Evidence
              </span>
              {/* Derived from the shared isSplicingDisrupted predicate — must never be
                  green while a high SpliceAI delta or junction proximity is present. */}
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                isPredictorCoverageAbsent
                  ? "cs-badge cs-badge-muted"
                  : isSpliceAiLoading
                  ? LOADING_BADGE
                  : isSplicingDisrupted
                  ? "cs-badge cs-badge-path"
                  : "cs-badge cs-badge-good"
              }`}>
                {isPredictorCoverageAbsent
                  ? "No Splice Signal Detected"
                  : isSpliceAiLoading
                  ? "Evaluating..."
                  : isSplicingDisrupted
                  ? "Aberrant Splicing Risk"
                  : "No Disruption Signal"}
              </span>
            </div>
            <div className="space-y-1.5 text-[11px] font-mono text-cs-text-secondary">
              <div className="flex justify-between">
                <span>SpliceAI Max Delta:</span>
                <span className="font-semibold text-cs-text-primary">{maxDs !== null ? maxDs.toFixed(3) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>dbscSNV Ensemble (Max):</span>
                <span className="font-semibold text-cs-text-primary">{maxDbsc !== null ? maxDbsc.toFixed(3) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Splice Junction Distance:</span>
                <span className="font-semibold text-cs-text-primary">{distance !== null ? `${distance} bp` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>AlphaGenome Splicing SHAP:</span>
                <span className="font-semibold text-cs-text-primary">
                  {splicingAttribution !== null ? `${(splicingAttribution * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Protein Tertiary Structure Evidence */}
          <div className="p-4 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-cs-text-primary flex items-center gap-1.5 font-sans">
                <Dna className="w-3.5 h-3.5 text-indigo-400" />
                Protein Tertiary Misfolding Evidence
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${isProteinDestabilized ? "cs-badge cs-badge-warn" : "cs-badge cs-badge-good"}`}>
                {isProteinDestabilized ? "Structural Destabilization" : "Thermodynamically Tolerated"}
              </span>
            </div>
            <div className="space-y-1.5 text-[11px] font-mono text-cs-text-secondary">
              <div className="flex justify-between">
                <span>FoldX ΔΔG:</span>
                <span className="font-semibold text-cs-text-primary">
                  {foldxVal !== null ? `${foldxVal.toFixed(2)} kcal/mol` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>AlphaMissense Pathogenicity:</span>
                <span className="font-semibold text-cs-text-primary">
                  {alphamissenseScore !== null ? alphamissenseScore.toFixed(3) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>REVEL Score:</span>
                <span className="font-semibold text-cs-text-primary">
                  {revelScore !== null ? revelScore.toFixed(3) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Primary Biological Impact:</span>
                <span className="font-semibold text-cs-text-primary">
                  {isProteinDestabilized ? "Misfolding / Aggregation" : "Basal Conformation"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action row — the verdict narrative and its derivation now live in the
            inspector so the main column stays decisive. */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-end gap-4 p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
          {onTabChange && (
            <button
              type="button"
              onClick={() => onTabChange("alphagenome")}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono bg-cs-surface hover:bg-[var(--cs-bg-subtle)] text-cs-text-primary border border-cs-border transition-all cursor-pointer shadow-xs"
            >
              <span>Explore Epigenomics &amp; Tracks in AlphaGenome Tab</span>
              <ArrowRight className="w-3.5 h-3.5 text-cs-accent-clay" />
            </button>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: Genomic Exon-Intron Architecture Schematic                    */}
      {/* Coordinate plumbing, region metadata and interpretation prose moved to    */}
      {/* the inspector; the diagram itself is the message and stays here.          */}
      {/* ========================================================================= */}
      <div className="p-6 rounded-xl border border-cs-border bg-cs-surface space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cs-border-subtle pb-3.5">
          <div className="flex items-center gap-2">
            <Dna className="w-4 h-4 text-cs-accent-clay" />
            <h3 className="text-[14px] font-semibold text-cs-text-primary font-sans">
              Genomic Exon-Intron Architecture &amp; Splice Junction Coordinates
            </h3>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-cs-text-secondary">
            <span
              className="px-2.5 py-1 rounded bg-cs-surface-2 border border-cs-border-subtle"
              title={ensemblTranscriptId && transcriptId !== ensemblTranscriptId ? `Ensembl: ${ensemblTranscriptId}` : undefined}
            >
              {transcriptId ? `${transcriptId} (${strandLabel})` : "Transcript unmapped"}
            </span>
            <span className="px-2.5 py-1 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20 font-semibold">
              {displayExonLabel}
            </span>
          </div>
        </div>

        {/* Full-Width Biologically Oriented SVG Schematic */}
        <div className="w-full p-6 rounded-xl border border-cs-border-subtle bg-cs-surface-2 flex flex-col items-center justify-center">
          {(distance === null || clampedDistance === null) ? (
            /* Unmapped geometry gets an UNRESOLVED panel, not a junction. The old fallback
               drew the acceptor layout with a "Splice Boundary (0 bp)" marker sitting on the
               junction — a fabricated measurement for the very case the resolver had just
               declined to measure (unmapping defect F-11). A non-finite distance (possible
               only via a replayed/hand-edited payload) lands here too rather than pinning
               the marker to the junction while the chip claims ">60 bp" (review UI#5). */
            <div className="w-full py-10 flex flex-col items-center justify-center gap-3 text-center">
              <Scissors className="w-6 h-6 text-cs-text-muted" />
              <p className="text-[12px] font-mono text-cs-text-secondary">
                {distance === null && (isBiophysicalLoading || analysisState.isLoading)
                  ? "Resolving exon–intron geometry…"
                  : "Exon–intron geometry not resolved for this coordinate"}
              </p>
              <p className="text-[11px] font-sans text-cs-text-muted max-w-[560px] leading-relaxed">
                {distance === null && (isBiophysicalLoading || analysisState.isLoading)
                  ? "Junction distance, region type and exon bounds are being computed; the diagram appears once a position is measured."
                  : proximityRefusal ??
                    (distance === null
                      ? "The splice resolver returned no junction distance, region type or exon bounds, so no geometry is drawn. The sequence-based scores above are computed independently of this diagram."
                      : `The resolver reported a distance (${distance}) that cannot be placed on a linear map, so no geometry is drawn.`)}
              </p>
            </div>
          ) : (
          <>
          <svg
            width="100%"
            height="240"
            viewBox="0 0 960 240"
            className="overflow-visible select-none max-w-full"
            role="img"
            /* The static label used to announce "Splice junction biological architecture" even
               for the neutral state — screen-reader users heard a junction claim precisely where
               the visual disclosure says the junction was NOT resolved (review UI#3). */
            aria-label={
              orientationKnown
                ? `Splice junction schematic: ${junctionType}; variant ${distance} bp from the junction, ${isExonicVariant ? "exonic" : "intronic"}.`
                : `Splice boundary schematic: junction orientation not resolved; variant ${distance} bp from the boundary, shown on both candidate sides.`
            }
          >
            <title>Exon-Intron Splice Junction Schematic</title>
            <desc>
              {orientationKnown
                ? `Splice junction schematic: ${junctionType}; variant ${distance} bp from the junction, ${isExonicVariant ? "exonic" : "intronic"}.`
                : `Splice boundary schematic: junction orientation not resolved; variant ${distance} bp from the boundary, shown on both candidate sides.`}
            </desc>
            <defs>
              <linearGradient id={exonGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cs-accent-clay)" stopOpacity="0.10" />
                <stop offset="100%" stopColor="var(--cs-accent-clay)" stopOpacity="0.25" />
              </linearGradient>
              <linearGradient id={criticalZoneGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cs-danger)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--cs-danger)" stopOpacity="0.16" />
              </linearGradient>
            </defs>

            {/* Critical Junction Zone Backdrop (±5 bp around 480) — rendered in backdrop so
                it does not slice an awkward bounding box across the exon's solid boundaries. */}
            {orientationKnown && (
              <g>
                <rect
                  x="448.5"
                  y="54"
                  width="63"
                  height="82"
                  rx="4"
                  fill={`url(#${criticalZoneGradId})`}
                  stroke="var(--cs-danger)"
                  strokeWidth="1.2"
                  strokeDasharray="3 2"
                  opacity="0.9"
                />
                <text x="480" y="42" fill="var(--cs-text-danger)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[11px] font-bold" textAnchor="middle">
                  &plusmn;{THRESHOLDS.spliceai.proximityCriticalBp} bp Critical Junction Zone
                </text>
              </g>
            )}

            {isDonor ? (
              <g>
                {/* Exon Box (Left: X=40 to 480, Width=440, Height=74) */}
                <rect x="40" y="58" width="440" height="74" rx="8" fill={`url(#${exonGradId})`} stroke="var(--cs-accent-clay)" strokeWidth="2.2" />
                <text x="260" y="92" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[15px] font-bold uppercase tracking-wider" textAnchor="middle">
                  {displayExonLabel}
                </text>
                <text x="260" y="115" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px] font-medium" textAnchor="middle">
                  {exonLength ? `${exonLength.toLocaleString()} bp` : "Length unmapped"}
                </text>

                {/* Intron Label Pill (Above pipe) */}
                <rect x="630" y="16" width="160" height="30" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.2" />
                <text x="710" y="36" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[13px] font-bold" textAnchor="middle">
                  {displayIntronLabel}
                </text>

                {/* Intron Pipe (Right: X=480 to 920, Width=440, Height=36) */}
                <rect x="480" y="77" width="440" height="36" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.5" strokeDasharray="6 4" />
                <line x1="480" y1="95" x2="920" y2="95" stroke="var(--cs-text-muted)" strokeWidth="2.5" strokeDasharray="8 5" />

                {/* Region Sequence Tags */}
                <text x="260" y="154" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  5&apos; Exonic Sequence (Coding)
                </text>
                <text x="700" y="154" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  3&apos; Intronic Flank (GT Motif)
                </text>
              </g>
            ) : isAcceptor ? (
              <g>
                {/* Intron Label Pill (Above pipe) */}
                <rect x="170" y="16" width="160" height="30" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.2" />
                <text x="250" y="36" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[13px] font-bold" textAnchor="middle">
                  {displayIntronLabel}
                </text>

                {/* Intron Pipe (Left: X=40 to 480, Width=440, Height=36) */}
                <rect x="40" y="77" width="440" height="36" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.5" strokeDasharray="6 4" />
                <line x1="40" y1="95" x2="480" y2="95" stroke="var(--cs-text-muted)" strokeWidth="2.5" strokeDasharray="8 5" />

                {/* Exon Box (Right: X=480 to 920, Width=440, Height=74) */}
                <rect x="480" y="58" width="440" height="74" rx="8" fill={`url(#${exonGradId})`} stroke="var(--cs-accent-clay)" strokeWidth="2.2" />
                <text x="700" y="92" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[15px] font-bold uppercase tracking-wider" textAnchor="middle">
                  {displayExonLabel}
                </text>
                <text x="700" y="115" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px] font-medium" textAnchor="middle">
                  {exonLength ? `${exonLength.toLocaleString()} bp` : "Length unmapped"}
                </text>

                {/* Region Sequence Tags */}
                <text x="240" y="154" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  5&apos; Intronic Flank (AG Motif)
                </text>
                <text x="700" y="154" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  3&apos; Exonic Sequence (Coding)
                </text>
              </g>
            ) : (
              /* Orientation NOT known (transcript terminus, or a resolver that identified no
                 boundary): two neutral model sides, no exon/intron claim, no GT/AG motif. The
                 distance is real; which side it lies on is not (unmapping defect F-15). */
              <g>
                <rect x="170" y="16" width="220" height="30" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.2" />
                <text x="280" y="36" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px] font-bold" textAnchor="middle">
                  Boundary — orientation not resolved
                </text>

                <rect x="40" y="77" width="440" height="36" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.5" strokeDasharray="6 4" />
                <line x1="40" y1="95" x2="920" y2="95" stroke="var(--cs-text-muted)" strokeWidth="2.5" strokeDasharray="8 5" />

                <text x="260" y="154" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  5&apos; Transcript Model Side
                </text>
                <text x="700" y="154" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  3&apos; Transcript Model Side
                </text>
              </g>
            )}

            {/* Splice Junction 0bp Boundary Line */}
            <line x1="480" y1="48" x2="480" y2="174" stroke="var(--cs-text-primary)" strokeWidth="3" />

            {/* Scale Ticks (-25bp, 0bp, +25bp) mathematically anchored to linear coordinate space */}
            <line x1={leftTickX} y1="166" x2={leftTickX} y2="174" stroke="var(--cs-text-muted)" strokeWidth="1.5" />
            <text x={leftTickX} y="186" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[11px]" textAnchor="middle">-25 bp</text>

            <text x="480" y="186" fill="var(--cs-text-primary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px] font-bold" textAnchor="middle">
              0 bp ({isDonor ? "GT Donor" : isAcceptor ? "AG Acceptor" : "Boundary"})
            </text>

            <line x1={rightTickX} y1="166" x2={rightTickX} y2="174" stroke="var(--cs-text-muted)" strokeWidth="1.5" />
            <text x={rightTickX} y="186" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[11px]" textAnchor="middle">+25 bp</text>

            {/* Off-scale break symbol if distance > 60 bp (positioned between pin and junction, clear of the circle) */}
            {isOffScale && (
              <g aria-label="Scale break symbol">
                {orientationKnown ? (
                  <>
                    <line x1={breakX - 4} y1="83" x2={breakX + 1} y2="107" stroke="var(--cs-text-muted)" strokeWidth="2" strokeLinecap="round" />
                    <line x1={breakX + 2} y1="83" x2={breakX + 7} y2="107" stroke="var(--cs-text-muted)" strokeWidth="2" strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    {/* Render break marks symmetrically on both candidate pipes when orientation is unresolved */}
                    <line x1={102 + 35 - 4} y1="83" x2={102 + 35 + 1} y2="107" stroke="var(--cs-text-muted)" strokeWidth="2" strokeLinecap="round" />
                    <line x1={102 + 35 + 2} y1="83" x2={102 + 35 + 7} y2="107" stroke="var(--cs-text-muted)" strokeWidth="2" strokeLinecap="round" />
                    <line x1={858 - 35 - 4} y1="83" x2={858 - 35 + 1} y2="107" stroke="var(--cs-text-muted)" strokeWidth="2" strokeLinecap="round" />
                    <line x1={858 - 35 + 2} y1="83" x2={858 - 35 + 7} y2="107" stroke="var(--cs-text-muted)" strokeWidth="2" strokeLinecap="round" />
                  </>
                )}
              </g>
            )}

            {/* Dynamic Variant Position Marker Pin.
                Known orientation: one pin on the measured side. Unknown orientation: TWO
                candidate rings, one per side — the distance was measured, the side was not,
                and a single pin would pick a side the data does not support. */}
            {orientationKnown ? (
              <g>
                <line
                  x1={pinX}
                  y1="56"
                  x2={pinX}
                  y2="202"
                  stroke={isNearSpliceSite ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  strokeWidth="2.5"
                  strokeDasharray="5 2.5"
                />
                <circle
                  cx={pinX}
                  cy="95"
                  r="7.5"
                  fill={isNearSpliceSite ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  stroke="var(--cs-surface)"
                  strokeWidth="2.5"
                />

                {/* High-Legibility Marker Chip */}
                <rect
                  x={chipX}
                  y="202"
                  width={chipWidth}
                  height="30"
                  rx="6"
                  fill="var(--cs-surface)"
                  stroke={isNearSpliceSite ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  strokeWidth="1.8"
                />
                <text
                  x={chipTextX}
                  y="222"
                  fill={isNearSpliceSite ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  style={{ fontFamily: "var(--cs-font-mono)" }}
                  className="text-[12px] font-bold"
                  textAnchor="middle"
                >
                  {chipText}
                </text>
              </g>
            ) : (
              <g>
                <line
                  x1={480 - (clampedDistance ?? 0) * 6.3}
                  y1="56"
                  x2={480 - (clampedDistance ?? 0) * 6.3}
                  y2="134"
                  stroke="var(--cs-accent-clay)"
                  strokeWidth="2"
                  strokeDasharray="5 2.5"
                  opacity="0.55"
                />
                <circle
                  cx={480 - (clampedDistance ?? 0) * 6.3}
                  cy="95"
                  r="7"
                  fill="none"
                  stroke="var(--cs-accent-clay)"
                  strokeWidth="2.5"
                  strokeDasharray="3 2"
                />
                <line
                  x1={480 + (clampedDistance ?? 0) * 6.3}
                  y1="56"
                  x2={480 + (clampedDistance ?? 0) * 6.3}
                  y2="134"
                  stroke="var(--cs-accent-clay)"
                  strokeWidth="2"
                  strokeDasharray="5 2.5"
                  opacity="0.55"
                />
                <circle
                  cx={480 + (clampedDistance ?? 0) * 6.3}
                  cy="95"
                  r="7"
                  fill="none"
                  stroke="var(--cs-accent-clay)"
                  strokeWidth="2.5"
                  strokeDasharray="3 2"
                />
                <rect
                  x={480 - unorientedChipWidth / 2}
                  y="202"
                  width={unorientedChipWidth}
                  height="30"
                  rx="6"
                  fill="var(--cs-surface)"
                  stroke="var(--cs-accent-clay)"
                  strokeWidth="1.8"
                />
                <text
                  x="480"
                  y="222"
                  fill="var(--cs-accent-clay)"
                  style={{ fontFamily: "var(--cs-font-mono)" }}
                  className="text-[12px] font-bold"
                  textAnchor="middle"
                >
                  {chipText}
                </text>
              </g>
            )}
          </svg>

          <div className="w-full flex justify-between items-center text-[12px] font-mono text-cs-text-muted px-3 border-t border-cs-border-subtle pt-3 mt-2">
            <span className="font-semibold text-cs-text-primary">{junctionType}</span>
            <span>Strand: {strandLabel}</span>
          </div>
          </>
          )}
        </div>

        {/* Coverage notice — the one caveat that must sit next to the figure,
            because the figure alone could be read as a motif inspection.
            It must NOT claim to know *why* no score exists: SpliceAI reads a ±10,000 bp
            context but reports delta scores only within -D (default 50 bp) of a
            gained/lost site, while dbscSNV is characterised over the ±12 bp
            perijunctional region. Three different windows — so absence of a value is
            not attributable to the ±12 bp figure alone. */}
        {isPredictorCoverageAbsent && distance !== null && (
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-2.5 text-cs-text-secondary">
            <Info className="w-4 h-4 mt-0.5 text-cs-text-muted shrink-0" />
            <p className="text-[12px] font-sans leading-normal">
              No SpliceAI or dbscSNV score was returned for this position
              (<strong className="text-cs-text-primary font-mono">{distance} bp</strong> from the nearest
              junction), so its splice impact is indeterminate rather than absent. Distances, region type
              and exon bounds are itemised in the inspector.
            </p>
          </div>
        )}

        {/* Near-junction warning — decisive, stays in the main column. Gated on the
            shared guarded predicate so a transcript terminus (or a single-exon
            transcript) cannot raise a "critical splice proximity" alarm. */}
        {distance !== null && isCriticalJunctionProximity && (
          <div className="p-3.5 rounded-lg border bg-cs-bg-danger border-cs-danger/25 flex items-start gap-2.5 text-cs-text-danger-on-soft">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-cs-danger shrink-0" />
            <p className="text-[12px] font-sans leading-normal">
              <strong>Critical Splice Proximity (&le; {THRESHOLDS.spliceai.proximityCriticalBp} bp):</strong>{" "}
              High susceptibility to disabling the canonical donor/acceptor dinucleotide, provoking exon
              skipping or retention.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export const SplicingTab = React.memo(SplicingTabComponent);
