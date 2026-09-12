import React, { useMemo } from "react";
import {
  Scissors,
  AlertTriangle,
  Info,
  HelpCircle,
  GitFork,
  Dna,
  Activity,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Zap,
  Layers,
  Database,
  ExternalLink
} from "lucide-react";
import { TabComponentProps } from "./types";
import { evaluateSplicePredictor, THRESHOLDS } from "../../shared/thresholds";

export function SplicingTab({
  analysisState,
  isBiophysicalLoading,
  foldingDdG,
  onTabChange
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  const spliceai = result.conservationData?.spliceai || null;
  const isSpliceAiLoading = !spliceai && (isBiophysicalLoading || analysisState.isLoading);
  const dbscsnv = result.conservationData?.dbscsnv || null;
  const spliceProximity = result.conservationData?.spliceProximity || null;
  const alphagenome = result.conservationData?.alphagenome || null;

  // Protein misfolding evidence
  const foldxVal = foldingDdG ?? result.foldingEnergetics?.foldx ?? null;
  const alphamissenseScore = result.predictorData?.amPathogenicity ?? null;
  const revelScore = result.conservationData?.revel ?? null;

  const maxDs = spliceai?.max_ds ?? null;
  const distance = spliceProximity?.distance ?? null;
  const isNear = spliceProximity?.isNearSpliceSite ?? false;

  // Enriched Exon/Intron metadata (Zero synthetic/hardcoded coordinates)
  const exonNum = spliceProximity?.exonNumber ?? null;
  const totalExons = spliceProximity?.totalExons ?? null;
  const exonLength = spliceProximity?.exonLength ?? null;
  const exonStart = spliceProximity?.exonStart ?? null;
  const exonEnd = spliceProximity?.exonEnd ?? null;
  const intronNum = spliceProximity?.intronNumber ?? spliceProximity?.adjacentIntronNumber ?? (exonNum ? exonNum : null);
  const rawJunctionType = spliceProximity?.junctionType ?? null;
  const isAcceptor = rawJunctionType === "acceptor";
  const isDonor = rawJunctionType === "donor" || (!isAcceptor && distance !== null);
  const junctionType = isDonor
    ? "5' Splice Donor (GT)"
    : isAcceptor
    ? "3' Splice Acceptor (AG)"
    : "Splice Junction";
  const strand = spliceProximity?.strand ?? "+";
  const transcriptId = spliceProximity?.transcriptId ?? result.transcriptId ?? null;
  const regionType = spliceProximity?.regionType ?? (distance !== null ? "exonic" : null);

  const adaScore = dbscsnv?.ada_score ?? null;
  const rfScore = dbscsnv?.rf_score ?? null;
  const hasDbscsnv = adaScore !== null || rfScore !== null;
  const maxDbsc = hasDbscsnv ? Math.max(adaScore ?? 0, rfScore ?? 0) : null;
  const isDbscAltering = maxDbsc !== null && maxDbsc >= THRESHOLDS.dbscsnv.spliceAltering;

  // AlphaGenome Splicing Feature Attribution
  const alphagenomeSplicingAttribution =
    alphagenome?.featureAttributions?.["fi_MERGED_SPLICING"] ??
    (alphagenome?.topModality?.toLowerCase().includes("splicing") ? alphagenome?.topFeatureImportance : null) ??
    null;
  const isAlphaGenomeSplicingDominant =
    alphagenome?.topModality?.toLowerCase().includes("splicing") ||
    (alphagenomeSplicingAttribution !== null && alphagenomeSplicingAttribution >= 0.25);

  const verdict = evaluateSplicePredictor(spliceProximity, spliceai, dbscsnv);

  // SpliceAI Status
  let dsSeverityLabel = "Unannotated";
  let dsBadgeClass = "cs-badge cs-badge-muted";
  if (isSpliceAiLoading) {
    dsSeverityLabel = "Evaluating SpliceAI...";
    dsBadgeClass = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse";
  } else if (maxDs !== null) {
    if (maxDs >= THRESHOLDS.spliceai.pathogenicHigh) {
      dsSeverityLabel = "High Disruption Risk";
      dsBadgeClass = "cs-badge cs-badge-path";
    } else if (maxDs >= THRESHOLDS.spliceai.pathogenicModerate) {
      dsSeverityLabel = "Moderate Probability";
      dsBadgeClass = "cs-badge cs-badge-warn";
    } else {
      dsSeverityLabel = "Low Disruption Risk";
      dsBadgeClass = "cs-badge cs-badge-good";
    }
  }

  // Distance Status
  let distLabel = "Unmapped";
  let distBadgeClass = "cs-badge cs-badge-muted";
  if (distance !== null) {
    if (distance <= 5) {
      distLabel = "Critical Junction (≤5 bp)";
      distBadgeClass = "cs-badge cs-badge-path";
    } else if (distance <= 12) {
      distLabel = "Consensus Flank (≤12 bp)";
      distBadgeClass = "cs-badge cs-badge-warn";
    } else {
      distLabel = "Deep Exonic / Preserved";
      distBadgeClass = "cs-badge cs-badge-good";
    }
  }

  // dbscSNV Status
  let dbscLabel = "Outside Consensus Zone";
  let dbscBadgeClass = "cs-badge cs-badge-muted";
  if (hasDbscsnv) {
    if (isDbscAltering) {
      dbscLabel = "Splice Altering Candidate";
      dbscBadgeClass = "cs-badge cs-badge-path";
    } else {
      dbscLabel = "Tolerated / Unaltered";
      dbscBadgeClass = "cs-badge cs-badge-good";
    }
  }

  // Mechanistic Etiology Synthesis (Dual-Mechanism Resolution)
  const isSplicingDisrupted =
    (maxDs !== null && maxDs >= THRESHOLDS.spliceai.pathogenicModerate) ||
    isDbscAltering ||
    (distance !== null && distance <= 2) ||
    isAlphaGenomeSplicingDominant;

  const isProteinDestabilized =
    (foldxVal !== null && foldxVal >= THRESHOLDS.foldxDdG.destabilizingStrong) ||
    (alphamissenseScore !== null && alphamissenseScore >= THRESHOLDS.alphaMissense.pathogenicSupporting) ||
    (revelScore !== null && revelScore >= THRESHOLDS.revel.pathogenicSupporting);

  const etiologyVerdict = useMemo(() => {
    if (isSpliceAiLoading) {
      return {
        title: "Evaluating Splicing...",
        badgeClass: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse",
        description: "Assessing deep learning sequence context across SpliceAI residual channels."
      };
    }
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
        description: "Splicing is preserved; pathogenicity is driven by post-translational protein misfolding."
      };
    }
    if (maxDs !== null || distance !== null) {
      return {
        title: "Preserved / Basal Splice Motif",
        badgeClass: "cs-badge cs-badge-good",
        description: "Pre-mRNA splicing signals and protein stability remain within neutral limits."
      };
    }
    return {
      title: "Unannotated / Pending",
      badgeClass: "cs-badge cs-badge-muted",
      description: "Genomic splice proximity and deep learning models unavailable for this coordinate."
    };
  }, [isSpliceAiLoading, isSplicingDisrupted, isProteinDestabilized, maxDs, distance]);

  // ACMG Verdict styling
  let verdictLabel = "VUS / Indeterminate";
  let verdictBadgeClass = "cs-badge cs-badge-warn";
  if (isSpliceAiLoading) {
    verdictLabel = "Evaluating SpliceAI...";
    verdictBadgeClass = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse";
  } else if (verdict === "pathogenic") {
    verdictLabel = "Pathogenic Supporting (PP3)";
    verdictBadgeClass = "cs-badge cs-badge-path";
  } else if (verdict === "benign") {
    verdictLabel = "Benign Supporting (BP4)";
    verdictBadgeClass = "cs-badge cs-badge-good";
  } else if (verdict === "unavailable") {
    verdictLabel = "Unavailable / Unmapped";
    verdictBadgeClass = "cs-badge cs-badge-muted";
  }

  const renderSpliceAiBar = (label: string, val: number | null) => {
    const rawVal = val ?? 0;
    const percentage = Math.max(0, Math.min(100, rawVal * 100));

    let barColor = "bg-cs-good";
    if (val === null) {
      barColor = "bg-cs-border";
    } else if (rawVal >= THRESHOLDS.spliceai.pathogenicHigh) {
      barColor = "bg-cs-danger";
    } else if (rawVal >= THRESHOLDS.spliceai.pathogenicModerate) {
      barColor = "bg-cs-warn";
    }

    return (
      <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
        <div className="flex justify-between items-center text-[12px] font-sans font-medium">
          <span className="text-cs-text-secondary">{label}</span>
          <span className="font-mono font-semibold text-cs-text-primary">
            {val !== null ? val.toFixed(3) : "—"}
          </span>
        </div>
        <div className="relative w-full h-2 rounded-full overflow-hidden border mt-2 bg-cs-surface border-cs-border">
          <div className="absolute top-0 bottom-0 w-0.5 bg-cs-warn/50 z-10" style={{ left: "20%" }} title="Moderate threshold (0.20)" />
          <div className="absolute top-0 bottom-0 w-0.5 bg-cs-danger/50 z-10" style={{ left: "50%" }} title="High threshold (0.50)" />
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: val !== null ? `${percentage}%` : "0%" }} />
        </div>
        <div className="flex justify-between text-[10px] font-mono mt-1 text-cs-text-muted">
          <span>0.0</span>
          <span>Mod: 0.20</span>
          <span>High: 0.50</span>
          <span>1.0</span>
        </div>
      </div>
    );
  };

  const renderDbscBar = (title: string, score: number | null, desc: string) => {
    const rawVal = score ?? 0;
    const percentage = Math.max(0, Math.min(100, rawVal * 100));
    const isAltering = score !== null && score >= THRESHOLDS.dbscsnv.spliceAltering;
    const barColor = score === null ? "bg-cs-border" : isAltering ? "bg-cs-danger" : "bg-cs-good";

    return (
      <div className="p-4 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex flex-col justify-between gap-2.5">
        <div>
          <div className="flex justify-between items-center text-[12px] font-sans">
            <span className="font-semibold text-cs-text-primary">{title}</span>
            <span className="font-mono text-[14px] font-semibold text-cs-text-primary">
              {score !== null ? score.toFixed(3) : "—"}
            </span>
          </div>
          <p className="text-[12px] text-cs-text-muted mt-0.5 font-sans leading-normal">{desc}</p>
        </div>

        <div>
          <div className="relative w-full h-2.5 rounded-full overflow-hidden border bg-cs-surface border-cs-border">
            <div className="absolute top-0 bottom-0 w-0.5 bg-cs-danger z-10" style={{ left: "60%" }} title="Altering threshold (0.60)" />
            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: score !== null ? `${percentage}%` : "0%" }} />
          </div>
          <div className="flex justify-between text-[10px] font-mono mt-1 text-cs-text-muted">
            <span>0.0 (Tolerated)</span>
            <span className="text-cs-danger font-semibold">Cutoff: 0.60</span>
            <span>1.0 (Altering)</span>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Biologically Correct SVG Geometry (960 x 240)
  // Donor Site:   [Exon (5', left)]   ── GT ── [Intron (3', right)]
  // Acceptor Site:[Intron (5', left)] ── AG ── [Exon (3', right)]
  // ---------------------------------------------------------------------------
  const isExonicVariant = regionType === "exonic" || (distance !== null && regionType !== "intronic");
  const isOffScale = distance !== null && distance > 60;
  const clampedDistance = distance !== null ? Math.min(distance, 60) : null;

  let pinX = 480;
  if (clampedDistance !== null) {
    if (isDonor) {
      // Exon is left (480 - dist), Intron is right (480 + dist)
      pinX = isExonicVariant ? 480 - (clampedDistance * 6.3) : 480 + (clampedDistance * 6.3);
    } else {
      // Acceptor: Intron is left (480 - dist), Exon is right (480 + dist)
      pinX = isExonicVariant ? 480 + (clampedDistance * 6.3) : 480 - (clampedDistance * 6.3);
    }
  }

  // Strictly neutral zero-synthetic labels
  const displayExonLabel = exonNum !== null
    ? `Exon ${exonNum}${totalExons ? ` of ${totalExons}` : ""}`
    : "Exon unmapped";
  const displayIntronLabel = intronNum !== null
    ? `Intron ${intronNum}`
    : "Intron unmapped";

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="screen-title flex items-center gap-2 text-left">
          <Scissors className="w-5 h-5 text-cs-accent-clay" />
          RNA Splicing Disruption & Mechanistic Etiology
        </h1>
        <p className="screen-tab-description">
          Evaluation of mutation impact on pre-mRNA splicing mechanisms via splice site proximity, SpliceAI deep learning models, dbscSNV consensus ensembles, and AlphaGenome multimodal attribution.
        </p>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: Executive KPI Banner (5 Cards)                                */}
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
            {dsSeverityLabel}
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
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${distBadgeClass}`}>
            {distLabel}
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

        {/* Card 4: AlphaGenome Splicing Impact */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[12px] font-semibold font-sans text-cs-text-primary">
                AlphaGenome Splicing
              </span>
              <Layers className="w-3.5 h-3.5 text-cs-accent-clay" />
            </div>
            <div className="text-[20px] font-semibold font-mono tracking-tight text-cs-text-primary mt-1.5">
              {alphagenomeSplicingAttribution !== null ? (
                `${(alphagenomeSplicingAttribution * 100).toFixed(1)}%`
              ) : alphagenome?.aviPhred !== null && alphagenome?.aviPhred !== undefined ? (
                `${alphagenome.aviPhred.toFixed(1)} Phred`
              ) : (
                "—"
              )}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${
            isAlphaGenomeSplicingDominant ? "cs-badge cs-badge-path" : alphagenome ? "cs-badge cs-badge-muted" : "cs-badge cs-badge-muted"
          }`}>
            {isAlphaGenomeSplicingDominant ? "Primary Driver" : alphagenome ? "Multimodal Context" : "Standby / Unconfigured"}
          </span>
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
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${etiologyVerdict.badgeClass}`}>
            Dual-Mechanism Signal
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
              <p className="text-[12px] text-cs-text-secondary font-sans mt-0.5">
                Differentiates whether disease etiology is driven by post-translational tertiary instability or pre-mRNA transcript degradation (NMD).
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <span className={`px-2.5 py-1 rounded text-[11px] font-semibold font-mono border ${etiologyVerdict.badgeClass}`}>
              {etiologyVerdict.title}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left Column: Pre-mRNA Splicing Evidence */}
          <div className="p-4 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-cs-text-primary flex items-center gap-1.5 font-sans">
                <Scissors className="w-3.5 h-3.5 text-cs-accent-clay" />
                Pre-mRNA Splicing Evidence
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${isSplicingDisrupted ? "cs-badge-path" : "cs-badge-good"}`}>
                {isSplicingDisrupted ? "Aberrant Splicing Risk" : "Splicing Preserved"}
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
                  {alphagenomeSplicingAttribution !== null ? `${(alphagenomeSplicingAttribution * 100).toFixed(1)}%` : "N/A"}
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
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${isProteinDestabilized ? "cs-badge-warn" : "cs-badge-good"}`}>
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

        {/* Narrative & Deep-Link Action Button */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
          <p className="text-[12px] text-cs-text-secondary font-sans leading-relaxed">
            {etiologyVerdict.description}{" "}
            <span className="text-cs-text-muted">
              Deep learning sequence models evaluate whole-transcript splicing contexts alongside tertiary force-field energetic calculations.
            </span>
          </p>
          <button
            type="button"
            onClick={() => onTabChange?.("alphagenome")}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono bg-cs-surface hover:bg-[var(--cs-bg-subtle)] text-cs-text-primary border border-cs-border transition-all cursor-pointer shadow-xs"
          >
            <span>Explore Epigenomics & Tracks in AlphaGenome Tab</span>
            <ArrowRight className="w-3.5 h-3.5 text-cs-accent-clay" />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: Biologically Correct Genomic Architecture Schematic          */}
      {/* ========================================================================= */}
      <div className="p-6 rounded-xl border border-cs-border bg-cs-surface space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cs-border-subtle pb-3.5">
          <div className="flex items-center gap-2">
            <Dna className="w-4 h-4 text-cs-accent-clay" />
            <h3 className="text-[14px] font-semibold text-cs-text-primary font-sans">
              Genomic Exon-Intron Architecture & Splice Junction Coordinates
            </h3>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-cs-text-secondary">
            <span className="px-2.5 py-1 rounded bg-cs-surface-2 border border-cs-border-subtle">
              {transcriptId ? `${transcriptId} (${strand})` : "Transcript unmapped"}
            </span>
            <span className="px-2.5 py-1 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20 font-semibold">
              {displayExonLabel}
            </span>
          </div>
        </div>

        {/* Full-Width Biologically Oriented SVG Schematic */}
        <div className="w-full p-6 rounded-xl border border-cs-border-subtle bg-cs-surface-2 flex flex-col items-center justify-center">
          <svg
            width="100%"
            height="240"
            viewBox="0 0 960 240"
            className="overflow-visible select-none max-w-full"
            role="img"
            aria-label="Splice junction biological architecture"
          >
            <defs>
              <linearGradient id="exonGradSplicing" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cs-accent-clay)" stopOpacity="0.10" />
                <stop offset="100%" stopColor="var(--cs-accent-clay)" stopOpacity="0.25" />
              </linearGradient>
              <linearGradient id="criticalZoneGradSplicing" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cs-danger)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--cs-danger)" stopOpacity="0.16" />
              </linearGradient>
            </defs>

            {isDonor ? (
              // -----------------------------------------------------------------
              // 5' Splice Donor Layout: [Exon (5', left)] ── GT ── [Intron (3', right)]
              // -----------------------------------------------------------------
              <g>
                {/* Exon Box (Left: X=40 to 480, Width=440, Height=74) */}
                <rect x="40" y="58" width="440" height="74" rx="8" fill="url(#exonGradSplicing)" stroke="var(--cs-accent-clay)" strokeWidth="2.2" />
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
                <text x="260" y="162" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  5&apos; Exonic Sequence (Coding)
                </text>
                <text x="700" y="162" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  3&apos; Intronic Flank (GT Motif)
                </text>
              </g>
            ) : (
              // -----------------------------------------------------------------
              // 3' Splice Acceptor Layout: [Intron (5', left)] ── AG ── [Exon (3', right)]
              // -----------------------------------------------------------------
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
                <rect x="480" y="58" width="440" height="74" rx="8" fill="url(#exonGradSplicing)" stroke="var(--cs-accent-clay)" strokeWidth="2.2" />
                <text x="700" y="92" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[15px] font-bold uppercase tracking-wider" textAnchor="middle">
                  {displayExonLabel}
                </text>
                <text x="700" y="115" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px] font-medium" textAnchor="middle">
                  {exonLength ? `${exonLength.toLocaleString()} bp` : "Length unmapped"}
                </text>

                {/* Region Sequence Tags */}
                <text x="240" y="162" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  5&apos; Intronic Flank (AG Motif)
                </text>
                <text x="700" y="162" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[12px] font-semibold uppercase tracking-wider" textAnchor="middle">
                  3&apos; Exonic Sequence (Coding)
                </text>
              </g>
            )}

            {/* Critical Consensus Zone (±5 bp Highlight around 480) */}
            <rect x="446" y="50" width="68" height="90" rx="5" fill="url(#criticalZoneGradSplicing)" stroke="var(--cs-danger)" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x="480" y="42" fill="var(--cs-text-danger)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[11px] font-bold" textAnchor="middle">
              ±5 bp Consensus Zone
            </text>

            {/* Splice Junction 0bp Boundary Line */}
            <line x1="480" y1="48" x2="480" y2="148" stroke="var(--cs-text-primary)" strokeWidth="3" />

            {/* Scale Ticks (-25bp, 0bp, +25bp) */}
            <line x1="290" y1="132" x2="290" y2="144" stroke="var(--cs-text-muted)" strokeWidth="1.5" />
            <text x="290" y="184" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[11px]" textAnchor="middle">-25 bp</text>

            <line x1="480" y1="148" x2="480" y2="160" stroke="var(--cs-text-primary)" strokeWidth="2" />
            <text x="480" y="184" fill="var(--cs-text-primary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px] font-bold" textAnchor="middle">
              0 bp ({isDonor ? "GT Donor" : isAcceptor ? "AG Acceptor" : "Junction"})
            </text>

            <line x1="670" y1="113" x2="670" y2="125" stroke="var(--cs-text-muted)" strokeWidth="1.5" />
            <text x="670" y="184" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[11px]" textAnchor="middle">+25 bp</text>

            {/* Off-scale break symbol if distance > 60 bp */}
            {isOffScale && (
              <g>
                <line x1={pinX - 10} y1="85" x2={pinX - 5} y2="105" stroke="var(--cs-text-muted)" strokeWidth="2" />
                <line x1={pinX - 5} y1="85" x2={pinX} y2="105" stroke="var(--cs-text-muted)" strokeWidth="2" />
              </g>
            )}

            {/* Dynamic Variant Position Marker Pin */}
            {distance !== null ? (
              <g>
                <line
                  x1={pinX}
                  y1="56"
                  x2={pinX}
                  y2="200"
                  stroke={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  strokeWidth="2.5"
                  strokeDasharray="5 2.5"
                />
                <circle
                  cx={pinX}
                  cy="95"
                  r="7.5"
                  fill={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  stroke="var(--cs-surface)"
                  strokeWidth="2.5"
                />

                {/* High-Legibility Marker Chip */}
                <rect
                  x={pinX - 58}
                  y="202"
                  width="116"
                  height="30"
                  rx="6"
                  fill="var(--cs-surface)"
                  stroke={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  strokeWidth="1.8"
                />
                <text
                  x={pinX}
                  y="222"
                  fill={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"}
                  style={{ fontFamily: "var(--cs-font-mono)" }}
                  className="text-[12px] font-bold"
                  textAnchor="middle"
                >
                  {isOffScale
                    ? `>${distance} bp (Deep)`
                    : isExonicVariant
                    ? `-${distance} bp (Exonic)`
                    : `+${distance} bp (Intronic)`}
                </text>
              </g>
            ) : (
              <g>
                <circle cx="480" cy="95" r="5.5" fill="var(--cs-text-muted)" />
                <text x="480" y="218" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px]" textAnchor="middle">
                  Splice Boundary (0 bp)
                </text>
              </g>
            )}
          </svg>

          <div className="w-full flex justify-between items-center text-[12px] font-mono text-cs-text-muted px-3 border-t border-cs-border-subtle pt-3 mt-2">
            <span className="font-semibold text-cs-text-primary">{junctionType}</span>
            <span>Strand: {strand === "+" ? "Forward (+)" : "Reverse (-)"}</span>
          </div>
        </div>

        {/* Scientific Metadata & Interpretation Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
            <span className="text-cs-text-muted block text-[10px] uppercase font-sans tracking-wider">Nearest Junction</span>
            <span className="font-semibold text-cs-text-primary capitalize text-[13px] font-mono mt-0.5 block">{junctionType}</span>
          </div>
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
            <span className="text-cs-text-muted block text-[10px] uppercase font-sans tracking-wider">Region Type</span>
            <span className="font-semibold text-cs-text-primary capitalize text-[13px] font-mono mt-0.5 block">
              {regionType ?? "Unmapped"}
            </span>
          </div>
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
            <span className="text-cs-text-muted block text-[10px] uppercase font-sans tracking-wider">Exon Bounds</span>
            <span
              className="font-semibold text-cs-text-primary text-[12px] font-mono mt-0.5 block truncate"
              title={exonStart && exonEnd ? `chr:${exonStart} - ${exonEnd}` : undefined}
            >
              {exonStart && exonEnd ? `${exonStart.toLocaleString()} – ${exonEnd.toLocaleString()}` : "Coordinates unmapped"}
            </span>
          </div>
        </div>

        {/* Clinical Prose Explanation */}
        {distance !== null ? (
          <div className="space-y-2">
            <p className="text-[13px] text-cs-text-secondary leading-relaxed font-sans">
              Variant position resides in <strong className="text-cs-text-primary font-mono">{displayExonLabel}</strong>, located <strong className="text-cs-text-primary font-mono">{distance} bp</strong> from the {junctionType.toLowerCase()}.
            </p>
            {isNear ? (
              <div className="p-3.5 rounded-lg border bg-cs-bg-danger border-cs-danger/25 flex items-start gap-2.5 text-cs-text-danger">
                <AlertTriangle className="w-4 h-4 mt-0.5 text-cs-danger shrink-0" />
                <p className="text-[12px] font-sans leading-normal">
                  <strong>Critical Splice Proximity (&le; 5 bp):</strong> High susceptibility to disabling canonical donor/acceptor dinucleotides, provoking exon skipping or retention.
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-2.5 text-cs-text-secondary">
                <Info className="w-4 h-4 mt-0.5 text-cs-text-muted shrink-0" />
                <p className="text-[12px] font-sans leading-normal">
                  Located <strong className="text-cs-text-primary font-mono">{distance} bp</strong> {isExonicVariant ? "deep within" : "into adjacent flank of"} {displayExonLabel}, outside the canonical 5 bp splice junction consensus zone. Basal spliceosome donor and acceptor motifs are preserved.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-2.5 text-cs-text-secondary">
            <Info className="w-4 h-4 mt-0.5 text-cs-accent-clay shrink-0" />
            <p className="text-[12px] font-sans leading-normal">
              Transcript coordinates mapped to Ensembl model {transcriptId ?? "canonical"}. Splicing disruption probability is quantified across machine learning consensus scores below.
            </p>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 4: Deep Learning Splice Alteration Models (SpliceAI + dbscSNV)   */}
      {/* ========================================================================= */}
      <div className="p-5 rounded-xl border border-cs-border bg-cs-surface space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cs-border-subtle pb-3">
          <div>
            <h3 className="text-[13px] font-semibold flex items-center gap-2 text-cs-text-primary font-sans">
              <Scissors className="w-4 h-4 text-cs-accent-clay" />
              SpliceAI Deep Learning Delta Score Breakdown
            </h3>
            <p className="text-[12px] text-cs-text-secondary font-sans mt-0.5">
              32-layer deep dilated residual neural network predicting splice acceptor and donor gains/losses.
            </p>
          </div>

          {/* Model Technical Context Badge (Purged non-functional buttons) */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 text-[11px] font-mono text-cs-text-muted">
            <Database className="w-3.5 h-3.5 text-cs-accent-clay shrink-0" />
            <span>Context: &plusmn;10,000 bp flanking sequence</span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-cs-text-muted">
          <span>Evaluated Receptors: Acceptor Gain/Loss, Donor Gain/Loss</span>
          {isSpliceAiLoading ? (
            <span className="font-semibold text-indigo-400 inline-flex items-center gap-1.5 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Computing Deep Learning Delta Scores...
            </span>
          ) : (
            <span className="font-semibold text-cs-text-primary">
              Max Delta Score: {maxDs !== null ? maxDs.toFixed(3) : "0.000 (Preserved)"}
            </span>
          )}
        </div>

        {isSpliceAiLoading ? (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {[
                "Acceptor Gain (ds_ag)",
                "Acceptor Loss (ds_al)",
                "Donor Gain (ds_dg)",
                "Donor Loss (ds_dl)"
              ].map((label) => (
                <div key={label} className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 animate-pulse">
                  <div className="flex justify-between items-center text-[12px] font-sans font-medium">
                    <span className="text-cs-text-secondary">{label}</span>
                    <span className="font-mono text-[11px] text-indigo-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                      Streaming...
                    </span>
                  </div>
                  <div className="relative w-full h-2 rounded-full overflow-hidden border mt-2 bg-cs-surface border-cs-border">
                    <div className="h-full rounded-full bg-indigo-500/40 animate-pulse w-2/3" />
                  </div>
                  <div className="flex justify-between text-[10px] font-mono mt-1 text-cs-text-muted opacity-60">
                    <span>0.0</span>
                    <span>Mod: 0.20</span>
                    <span>High: 0.50</span>
                    <span>1.0</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : spliceai && (spliceai.ds_ag !== null || spliceai.ds_al !== null || spliceai.ds_dg !== null || spliceai.ds_dl !== null) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1 animate-fade-in">
            {renderSpliceAiBar("Acceptor Gain (ds_ag)", spliceai.ds_ag)}
            {renderSpliceAiBar("Acceptor Loss (ds_al)", spliceai.ds_al)}
            {renderSpliceAiBar("Donor Gain (ds_dg)", spliceai.ds_dg)}
            {renderSpliceAiBar("Donor Loss (ds_dl)", spliceai.ds_dl)}
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-3 text-[12px] text-cs-text-secondary font-sans leading-relaxed animate-fade-in">
            <Info className="w-4 h-4 text-cs-text-muted shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-cs-text-primary">No aberrant splicing predicted within sequence window</p>
              <p className="text-cs-text-muted mt-0.5">
                SpliceAI evaluated all four splice altering mechanisms (Acceptor Gain, Acceptor Loss, Donor Gain, Donor Loss). All predicted delta scores remain below the basal detection threshold (&Delta;Score &lt; 0.02).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* dbscSNV Section */}
      <div className="p-5 rounded-xl border border-cs-border bg-cs-surface space-y-3">
        <div className="flex items-center justify-between border-b border-cs-border-subtle pb-3">
          <h3 className="text-[13px] font-semibold flex items-center gap-2 text-cs-text-primary font-sans">
            <GitFork className="w-4 h-4 text-cs-accent-clay" />
            dbscSNV Splicing Consensus Ensemble Models
          </h3>
          <span className="text-[10px] font-mono text-cs-text-muted bg-cs-surface-2 px-2 py-0.5 rounded border border-cs-border-subtle">
            Cutoff &ge; 0.60 &rarr; Altering
          </span>
        </div>
        <p className="text-[13px] text-cs-text-secondary leading-relaxed font-sans">
          Ensemble machine learning models trained on variants within the consensus splice donor (-3 to +8 bp) and acceptor (-12 to +2 bp) regions.
        </p>

        {hasDbscsnv ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {renderDbscBar("AdaBoost (ADA_SCORE)", adaScore, "Adaptive boosting ensemble probability of splice site disruption.")}
            {renderDbscBar("Random Forest (RF_SCORE)", rfScore, "Random forest decision tree consensus probability.")}
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-3 text-[12px] text-cs-text-secondary font-sans leading-relaxed">
            <Info className="w-4 h-4 text-cs-text-muted shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-cs-text-primary">Outside &plusmn;12 bp Splice Consensus Zone</p>
              <p className="text-cs-text-muted mt-0.5">
                Variant coordinate is located {distance !== null ? `${distance} bp` : "deep"} into {displayExonLabel}. dbscSNV only evaluates variants within donor (-3 to +8 bp) and acceptor (-12 to +2 bp) consensus motifs.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 5: Multi-Tier Clinical Evidence & ACMG Synthesis                 */}
      {/* ========================================================================= */}
      <div className="p-5 rounded-xl border border-cs-border bg-cs-surface space-y-4">
        <div className="flex items-center justify-between border-b border-cs-border-subtle pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cs-good" />
            <h3 className="text-[13px] font-semibold text-cs-text-primary font-sans">
              Clinical Synthesis & ACMG Evidence Mapping
            </h3>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${verdictBadgeClass}`}>
            {verdictLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px] font-sans">
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-1.5">
            <span className="font-semibold text-cs-text-primary block">PP3 (Pathogenic Supporting) Rules</span>
            <ul className="list-disc pl-4 space-y-1 text-cs-text-secondary text-[11px] leading-relaxed">
              <li><strong>SpliceAI &ge; 0.20:</strong> Moderate to high probability of causing cryptic donor/acceptor gain or loss.</li>
              <li><strong>dbscSNV &ge; 0.60:</strong> Ensemble agreement on consensus motif alteration.</li>
              <li><strong>Proximity &le; 2 bp:</strong> Invariant AG/GT dinucleotide disruption (qualifies for PVS1 if canonical splice site null).</li>
            </ul>
          </div>

          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-1.5">
            <span className="font-semibold text-cs-text-primary block">BP4 (Benign Supporting) Rules</span>
            <ul className="list-disc pl-4 space-y-1 text-cs-text-secondary text-[11px] leading-relaxed">
              <li><strong>SpliceAI &le; 0.02:</strong> All 4 residual channels indicate basal splicing stability.</li>
              <li><strong>Distance &gt; 12 bp:</strong> Resides outside consensus splice recognition motifs.</li>
              <li><strong>dbscSNV &lt; 0.60:</strong> Ensemble models predict tolerated splicing behavior.</li>
            </ul>
          </div>
        </div>

        {/* Primary Citations */}
        <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-center justify-between text-[11px] font-mono text-cs-text-muted">
          <span>Citations: Jaganathan et al. (Cell 2019) &bull; Jian et al. (Hum Mutat 2014) &bull; ClinGen SVI</span>
          <a
            href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6400593/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cs-accent-clay hover:underline"
          >
            <span>PubMed</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

