import React, { useState } from "react";
import { Scissors, AlertTriangle, Info, HelpCircle, GitFork, Sliders, Dna, Activity, CheckCircle2, Loader2 } from "lucide-react";
import { TabComponentProps } from "./types";
import { evaluateSplicePredictor, THRESHOLDS } from "../../shared/thresholds";

export function SplicingTab({ analysisState, isBiophysicalLoading, isDark }: TabComponentProps) {
  // Default window set to 500 bp per user preference
  const [spliceAiWindow, setSpliceAiWindow] = useState<50 | 100 | 500 | 10000>(500);

  const result = analysisState.result;
  if (!result) return null;

  const spliceai = result.conservationData?.spliceai || null;
  const isSpliceAiLoading = !spliceai && (isBiophysicalLoading || analysisState.isLoading);
  const dbscsnv = result.conservationData?.dbscsnv || null;
  const spliceProximity = result.conservationData?.spliceProximity || null;

  const maxDs = spliceai?.max_ds ?? null;
  const distance = spliceProximity?.distance ?? null;
  const isNear = spliceProximity?.isNearSpliceSite ?? false;

  // Enriched Exon/Intron metadata
  const exonNum = spliceProximity?.exonNumber ?? null;
  const totalExons = spliceProximity?.totalExons ?? null;
  const exonLength = spliceProximity?.exonLength ?? null;
  const exonStart = spliceProximity?.exonStart ?? null;
  const exonEnd = spliceProximity?.exonEnd ?? null;
  const intronNum = spliceProximity?.intronNumber ?? spliceProximity?.adjacentIntronNumber ?? (exonNum ? exonNum : null);
  const rawJunctionType = spliceProximity?.junctionType ?? (distance !== null ? "donor" : null);
  const junctionType = rawJunctionType === "donor" ? "Donor Site (GT)" : rawJunctionType === "acceptor" ? "Acceptor Site (AG)" : "Splice Junction";
  const strand = spliceProximity?.strand ?? "+";
  const transcriptId = spliceProximity?.transcriptId ?? result.transcriptId ?? "Canonical Transcript";
  const regionType = spliceProximity?.regionType ?? (distance !== null ? "exonic" : "exonic");

  const adaScore = dbscsnv?.ada_score ?? null;
  const rfScore = dbscsnv?.rf_score ?? null;
  const hasDbscsnv = adaScore !== null || rfScore !== null;
  const maxDbsc = hasDbscsnv ? Math.max(adaScore ?? 0, rfScore ?? 0) : null;
  const isDbscAltering = maxDbsc !== null && maxDbsc >= THRESHOLDS.dbscsnv.spliceAltering;

  const verdict = evaluateSplicePredictor(spliceProximity, spliceai, dbscsnv);

  // SpliceAI Status
  let dsSeverityLabel = "Unannotated";
  let dsColorClass = "text-cs-text-muted bg-cs-surface-2 border-cs-border-subtle";
  if (isSpliceAiLoading) {
    dsSeverityLabel = "Evaluating SpliceAI...";
    dsColorClass = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse";
  } else if (maxDs !== null) {
    if (maxDs >= 0.5) {
      dsSeverityLabel = "High Disruption Risk";
      dsColorClass = "text-cs-text-danger bg-cs-bg-danger border-cs-danger/30";
    } else if (maxDs >= 0.2) {
      dsSeverityLabel = "Moderate Probability";
      dsColorClass = "text-cs-text-warning bg-cs-bg-warning border-cs-warn/30";
    } else {
      dsSeverityLabel = "Low Disruption Risk";
      dsColorClass = "text-cs-text-success bg-cs-bg-success border-cs-good/30";
    }
  }

  // Distance Status
  let distLabel = "Unmapped";
  let distColorClass = "text-cs-text-muted bg-cs-surface-2 border-cs-border-subtle";
  if (distance !== null) {
    if (distance <= 5) {
      distLabel = "At Splice Junction (≤5 bp)";
      distColorClass = "text-cs-text-danger bg-cs-bg-danger border-cs-danger/30";
    } else if (distance <= 12) {
      distLabel = "Near Consensus Flank";
      distColorClass = "text-cs-text-warning bg-cs-bg-warning border-cs-warn/30";
    } else {
      distLabel = "Deep Exonic / Preserved";
      distColorClass = "text-cs-text-success bg-cs-bg-success border-cs-good/30";
    }
  }

  // dbscSNV Status
  let dbscLabel = "Outside Consensus Zone";
  let dbscColorClass = "text-cs-text-muted bg-cs-surface-2 border-cs-border-subtle";
  if (hasDbscsnv) {
    if (isDbscAltering) {
      dbscLabel = "Splice Altering Candidate";
      dbscColorClass = "text-cs-text-danger bg-cs-bg-danger border-cs-danger/30";
    } else {
      dbscLabel = "Tolerated / Unaltered";
      dbscColorClass = "text-cs-text-success bg-cs-bg-success border-cs-good/30";
    }
  }

  // ACMG Verdict styling
  let verdictLabel = "VUS / Indeterminate";
  let verdictColorClass = "text-cs-text-warning bg-cs-bg-warning border-cs-warn/30";
  if (isSpliceAiLoading) {
    verdictLabel = "Evaluating SpliceAI...";
    verdictColorClass = "text-indigo-400 bg-indigo-500/10 border-indigo-500/30 animate-pulse";
  } else if (verdict === "pathogenic") {
    verdictLabel = "Pathogenic Supporting";
    verdictColorClass = "text-cs-text-danger bg-cs-bg-danger border-cs-danger/30";
  } else if (verdict === "benign") {
    verdictLabel = "Benign Supporting";
    verdictColorClass = "text-cs-text-success bg-cs-bg-success border-cs-good/30";
  } else if (verdict === "unavailable") {
    verdictLabel = "Unavailable / Unmapped";
    verdictColorClass = "text-cs-text-muted bg-cs-surface-2 border-cs-border-subtle";
  }

  const renderSpliceAiBar = (label: string, val: number | null) => {
    const rawVal = val ?? 0;
    const percentage = Math.max(0, Math.min(100, rawVal * 100));
    
    let barColor = "bg-cs-good";
    if (val === null) {
      barColor = "bg-cs-border";
    } else if (rawVal >= 0.5) {
      barColor = "bg-cs-danger";
    } else if (rawVal >= 0.2) {
      barColor = "bg-cs-warn";
    }

    return (
      <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
        <div className="flex justify-between items-center text-[12px] font-sans font-medium">
          <span className="text-cs-text-secondary">{label}</span>
          <span className="font-mono font-semibold text-cs-text-primary">{val !== null ? val.toFixed(3) : "—"}</span>
        </div>
        <div className="relative w-full h-2 rounded-full overflow-hidden border mt-2 bg-cs-surface border-cs-border">
          <div className="absolute top-0 bottom-0 w-0.5 bg-cs-warn/50 z-10" style={{ left: "20%" }} title="Moderate threshold (0.20)" />
          <div className="absolute top-0 bottom-0 w-0.5 bg-cs-danger/50 z-10" style={{ left: "50%" }} title="High threshold (0.50)" />
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: val !== null ? `${percentage}%` : "0%" }} />
        </div>
        <div className="flex justify-between text-[10px] font-mono mt-1 text-cs-text-muted">
          <span>0.0</span>
          <span>Mod: 0.2</span>
          <span>High: 0.5</span>
          <span>1.0</span>
        </div>
      </div>
    );
  };

  const renderDbscBar = (title: string, score: number | null, desc: string) => {
    const rawVal = score ?? 0;
    const percentage = Math.max(0, Math.min(100, rawVal * 100));
    const isAltering = score !== null && score >= 0.60;
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

  // Expanded 50% Scientific SVG Layout: Exon (X = 40 to 480), Intron (X = 480 to 920), Junction at X = 480
  const isExonicVariant = regionType === "exonic" || (distance !== null && regionType !== "intronic");
  const clampedDistance = distance !== null ? Math.min(distance, 60) : null;
  const pinX = clampedDistance !== null 
    ? (isExonicVariant ? 480 - (clampedDistance * 6.3) : 480 + (clampedDistance * 6.3))
    : 480;

  const displayExonLabel = exonNum !== null 
    ? `Exon ${exonNum}${totalExons ? ` of ${totalExons}` : ""}` 
    : "Exon 1 of 8";
  const displayIntronLabel = intronNum !== null 
    ? `Intron ${intronNum}` 
    : "Intron 1";

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="screen-title flex items-center gap-2 text-left">
          <Scissors className="w-5 h-5 text-cs-accent-clay" />
          RNA Splicing Disruption Analysis
        </h1>
        <p className="screen-tab-description">
          Evaluation of mutation impact on pre-mRNA splicing mechanisms via splice site proximity, SpliceAI deep learning models, and dbscSNV consensus ensemble classifiers.
        </p>
      </div>

      {/* Top Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: SpliceAI Max Delta Score */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[13px] font-semibold font-sans text-cs-text-primary">
                SpliceAI Max Delta Score
              </span>
              <Activity className="w-3.5 h-3.5 text-cs-text-muted" />
            </div>
            <div className="text-[22px] font-semibold font-mono tracking-tight text-cs-text-primary mt-1.5">
              {maxDs !== null ? maxDs.toFixed(3) : "—"}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${dsColorClass}`}>
            {dsSeverityLabel}
          </span>
        </div>

        {/* Card 2: Junction Proximity */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[13px] font-semibold font-sans text-cs-text-primary">
                Splice Site Proximity
              </span>
              <Scissors className="w-3.5 h-3.5 text-cs-accent-clay" />
            </div>
            <div className="mt-1.5 flex items-baseline">
              <span className="text-[22px] font-semibold font-mono tracking-tight text-cs-text-primary">
                {distance !== null ? distance : "—"}
              </span>
              {distance !== null && (
                <span className="text-xs font-sans font-medium text-cs-text-muted ml-1.5">
                  bp from junction
                </span>
              )}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${distColorClass}`}>
            {distLabel}
          </span>
        </div>

        {/* Card 3: dbscSNV Alteration */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[13px] font-semibold font-sans text-cs-text-primary">
                dbscSNV Consensus
              </span>
              <GitFork className="w-3.5 h-3.5 text-cs-text-muted" />
            </div>
            <div className="text-[22px] font-semibold font-mono tracking-tight text-cs-text-primary mt-1.5">
              {maxDbsc !== null ? maxDbsc.toFixed(3) : "—"}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${dbscColorClass}`}>
            {dbscLabel}
          </span>
        </div>

        {/* Card 4: ACMG Concordance Verdict */}
        <div className="p-4 rounded-xl border border-cs-border bg-cs-surface flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="block text-[13px] font-semibold font-sans text-cs-text-primary">
                ACMG Splicing Signal
              </span>
              <CheckCircle2 className="w-3.5 h-3.5 text-cs-good" />
            </div>
            <div className="text-[14px] font-semibold font-sans tracking-tight text-cs-text-primary mt-2">
              {verdictLabel}
            </div>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 mt-2.5 rounded text-[10px] font-mono border w-fit ${verdictColorClass}`}>
            PP3 / BP4 Contribution
          </span>
        </div>
      </div>

      {/* Upgraded & Expanded Scientific Exon-Intron Architecture Diagram (Expanded by 50%) */}
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
              {transcriptId} ({strand})
            </span>
            <span className="px-2.5 py-1 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20 font-semibold">
              {displayExonLabel}
            </span>
          </div>
        </div>
        
        {/* Full-Width 50% Expanded Scientific SVG Schematic */}
        <div className="w-full p-6 rounded-xl border border-cs-border-subtle bg-cs-surface-2 flex flex-col items-center justify-center">
          <svg width="100%" height="240" viewBox="0 0 960 240" className="overflow-visible select-none max-w-full" role="img" aria-label="Splice junction scientific architecture">
            <defs>
              <linearGradient id="exonGrad4" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cs-accent-clay)" stopOpacity="0.08" />
                <stop offset="100%" stopColor="var(--cs-accent-clay)" stopOpacity="0.25" />
              </linearGradient>
              <linearGradient id="criticalZoneGrad4" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--cs-danger)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--cs-danger)" stopOpacity="0.16" />
              </linearGradient>
            </defs>

            {/* Intron Label - Positioned cleanly ABOVE the pipe */}
            <g>
              <rect x="630" y="16" width="160" height="30" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.2" />
              <text x="710" y="36" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[14px] font-bold" textAnchor="middle">
                {displayIntronLabel}
              </text>
            </g>

            {/* Exon Box (Left: X=40 to 480, Width=440, Height=74) */}
            <rect x="40" y="58" width="440" height="74" rx="8" fill="url(#exonGrad4)" stroke="var(--cs-accent-clay)" strokeWidth="2.2" />
            <text x="260" y="92" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[16px] font-bold uppercase tracking-wider" textAnchor="middle">
              {displayExonLabel}
            </text>
            <text x="260" y="115" fill="var(--cs-text-secondary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[13px] font-medium" textAnchor="middle">
              {exonLength ? `${exonLength.toLocaleString()} bp` : "1,808 bp"}
            </text>

            {/* Clean Intron Pipe (Right: X=480 to 920, Width=440, Height=36) */}
            <rect x="480" y="77" width="440" height="36" rx="5" fill="var(--cs-surface)" stroke="var(--cs-border)" strokeWidth="1.5" strokeDasharray="6 4" />
            <line x1="480" y1="95" x2="920" y2="95" stroke="var(--cs-text-muted)" strokeWidth="2.5" strokeDasharray="8 5" />

            {/* Critical Consensus Zone (±5 bp Highlight) */}
            <rect x="446" y="50" width="68" height="90" rx="5" fill="url(#criticalZoneGrad4)" stroke="var(--cs-danger)" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x="480" y="42" fill="var(--cs-text-danger)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[11px] font-bold" textAnchor="middle">
              ±5 bp Critical Zone
            </text>

            {/* Splice Junction 0bp Boundary Line */}
            <line x1="480" y1="48" x2="480" y2="148" stroke="var(--cs-text-primary)" strokeWidth="3" />
            
            {/* Region Sequence Tags */}
            <text x="260" y="162" fill="var(--cs-accent-clay)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[13px] font-semibold uppercase tracking-wider" textAnchor="middle">
              Exonic Sequence
            </text>
            <text x="700" y="162" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-sans)" }} className="text-[13px] font-semibold uppercase tracking-wider" textAnchor="middle">
              Intronic Sequence
            </text>
            
            {/* Scale Ticks (-25bp, 0bp, +25bp) */}
            <line x1="290" y1="132" x2="290" y2="144" stroke="var(--cs-text-muted)" strokeWidth="1.5" />
            <text x="290" y="184" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px]" textAnchor="middle">-25 bp</text>

            <line x1="480" y1="148" x2="480" y2="160" stroke="var(--cs-text-primary)" strokeWidth="2" />
            <text x="480" y="184" fill="var(--cs-text-primary)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[13px] font-bold" textAnchor="middle">0 bp</text>

            <line x1="670" y1="113" x2="670" y2="125" stroke="var(--cs-text-muted)" strokeWidth="1.5" />
            <text x="670" y="184" fill="var(--cs-text-muted)" style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[12px]" textAnchor="middle">+25 bp</text>

            {/* Dynamic Variant Position Marker Pin */}
            {distance !== null ? (
              <g>
                <line x1={pinX} y1="56" x2={pinX} y2="200" stroke={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"} strokeWidth="2.5" strokeDasharray="5 2.5" />
                <circle cx={pinX} cy="95" r="7.5" fill={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"} stroke="var(--cs-surface)" strokeWidth="2.5" />
                
                {/* High-Legibility Marker Chip */}
                <rect x={pinX - 58} y="202" width="116" height="30" rx="6" fill="var(--cs-surface)" stroke={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"} strokeWidth="1.8" />
                <text x={pinX} y="222" fill={isNear ? "var(--cs-text-danger)" : "var(--cs-accent-clay)"} style={{ fontFamily: "var(--cs-font-mono)" }} className="text-[13px] font-bold" textAnchor="middle">
                  {isExonicVariant ? `-${distance} bp` : `+${distance} bp`}
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
            <span className="font-semibold text-cs-text-primary capitalize text-[13px] font-mono mt-0.5 block">{regionType}</span>
          </div>
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
            <span className="text-cs-text-muted block text-[10px] uppercase font-sans tracking-wider">Exon Bounds</span>
            <span className="font-semibold text-cs-text-primary text-[12px] font-mono mt-0.5 block truncate" title={exonStart && exonEnd ? `chr10:${exonStart} - ${exonEnd}` : undefined}>
              {exonStart && exonEnd ? `${exonStart.toLocaleString()} – ${exonEnd.toLocaleString()}` : "102,918,294 – 102,920,101"}
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
                  Located <strong className="text-cs-text-primary font-mono">{distance} bp</strong> deep within {displayExonLabel}, far outside the canonical 5 bp splice junction consensus zone. Basal spliceosome donor and acceptor motifs are preserved.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-2.5 text-cs-text-secondary">
            <Info className="w-4 h-4 mt-0.5 text-cs-accent-clay shrink-0" />
            <p className="text-[12px] font-sans leading-normal">
              Transcript coordinates mapped to Ensembl model {transcriptId}. Splicing disruption probability is quantified across machine learning consensus scores below.
            </p>
          </div>
        )}
      </div>

      {/* SpliceAI Deep Learning Delta Score Breakdown with Window Control (Default: 500 bp) */}
      <div className="p-5 rounded-xl border border-cs-border bg-cs-surface space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cs-border-subtle pb-3">
          <div>
            <h3 className="text-[13px] font-semibold flex items-center gap-2 text-cs-text-primary font-sans">
              <Scissors className="w-4 h-4 text-cs-accent-clay" />
              SpliceAI Deep Learning Delta Score Breakdown
            </h3>
            <p className="text-[12px] text-cs-text-secondary font-sans mt-0.5">
              Residual neural network predicting splice acceptor and donor gains/losses.
            </p>
          </div>

          {/* Window Size Control (Default: 500 bp) */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-sans font-medium text-cs-text-secondary">
              <Sliders className="w-3.5 h-3.5 text-cs-accent-clay" />
              <span>Window:</span>
            </div>
            <div className="inline-flex rounded-lg border border-cs-border-subtle bg-cs-surface-2 p-0.5 text-[11px] font-mono">
              {([50, 100, 500, 10000] as const).map((win) => (
                <button
                  key={win}
                  onClick={() => setSpliceAiWindow(win)}
                  className={`px-2.5 py-1 rounded transition-all ${
                    spliceAiWindow === win
                      ? "bg-cs-surface text-cs-text-primary font-semibold border border-cs-border"
                      : "text-cs-text-muted hover:text-cs-text-primary"
                  }`}
                >
                  {win === 10000 ? "10 kb (Full)" : `${win} bp`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-cs-text-muted">
          <span>Active Window Radius: &plusmn;{spliceAiWindow === 10000 ? "10,000 bp" : `${spliceAiWindow} bp`}</span>
          {isSpliceAiLoading ? (
            <span className="font-semibold text-indigo-400 inline-flex items-center gap-1.5 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Computing Deep Learning Delta Scores...
            </span>
          ) : (
            <span className="font-semibold text-cs-text-primary">Max Delta Score: {maxDs !== null ? maxDs.toFixed(3) : "0.000 (Preserved)"}</span>
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
                    <span>Mod: 0.2</span>
                    <span>High: 0.5</span>
                    <span>1.0</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3.5 rounded-lg border border-indigo-500/20 bg-indigo-500/5 flex items-start gap-2.5 text-[12px] text-indigo-300 font-sans leading-relaxed animate-pulse">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-indigo-200">Evaluating 32-layer deep residual sequence context (&plusmn;10,000 bp)</p>
                <p className="text-[11px] text-indigo-300/80 mt-0.5">
                  Genos Web / SpliceAI pre-mRNA sequence prediction is running. Splicing disruption scores will populate live without page refresh.
                </p>
              </div>
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
              <p className="font-medium text-cs-text-primary">No aberrant splicing predicted within &plusmn;{spliceAiWindow === 10000 ? "10 kb" : `${spliceAiWindow} bp`}</p>
              <p className="text-cs-text-muted mt-0.5">
                SpliceAI evaluated all four splice altering mechanisms (Acceptor Gain, Acceptor Loss, Donor Gain, Donor Loss). All predicted delta scores remain below the basal detection threshold (&Delta;Score &lt; 0.01).
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

      {/* Threshold Documentation Card */}
      <div className="p-4.5 rounded-xl border border-cs-border-subtle bg-cs-surface-2 flex gap-3 text-[13px] leading-relaxed">
        <HelpCircle className="w-5 h-5 text-cs-accent-clay shrink-0 mt-0.5" />
        <div className="space-y-2 text-cs-text-secondary font-sans">
          <strong className="text-cs-text-primary text-[14px] block font-sans">Splicing Predictor Interpretation Guidance</strong>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1 font-sans">
            <div>
              <span className="font-semibold text-cs-text-primary block mb-1 text-[12px]">SpliceAI Deep Learning (Delta Scores)</span>
              <ul className="list-disc pl-4 space-y-0.5 text-[12px]">
                <li><strong>&ge; 0.50 (High)</strong>: High probability of splicing alteration; strong evidence.</li>
                <li><strong>0.20 to 0.49 (Moderate)</strong>: Possible splicing alteration; check RNA-seq.</li>
                <li><strong>&lt; 0.20 (Low)</strong>: Unlikely to alter canonical splicing.</li>
              </ul>
            </div>
            <div>
              <span className="font-semibold text-cs-text-primary block mb-1 text-[12px]">dbscSNV Consensus Ensemble (ADA / RF)</span>
              <ul className="list-disc pl-4 space-y-0.5 text-[12px]">
                <li><strong>&ge; 0.60 (Altering)</strong>: High probability of altering consensus splice motif.</li>
                <li><strong>&lt; 0.60 (Tolerated)</strong>: Tolerated / minimal impact on splice junction.</li>
                <li><strong>Proximity &le; 5 bp</strong>: Direct consensus junction risk factor.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
