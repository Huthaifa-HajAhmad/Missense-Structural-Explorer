import React, { useState, useEffect, useMemo, memo } from "react";
import { Dna, ExternalLink, ChevronDown, ChevronUp, Sparkles, Activity, Layers, Info } from "lucide-react";
import { useApiClient } from "../../apiClient";
import {
  AlphaGenomeRegionSaturationResponse,
  AlphaGenomeSaturationPosition,
  AlphaGenomeSaturationVariant
} from "../../shared/contracts";
import { THRESHOLDS } from "../../shared/thresholds";

export interface GenomicSaturationHeatmapProps {
  chrom?: string | null;
  genomicPos?: number | null;
  genomicAlt?: string | null;
  spliceProximity?: any;
  wildWindow: string[];
  relativeStartIndex: number;
  mutationIndex: number;
  mutation: { wt: string; pos: number; mut: string };
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  onResidueClick?: (index: number) => void;
  onSelectGenomicVariant?: (variantInfo: any) => void;
  metricMode?: "mean" | "max";
}

const NUCLEOTIDES: Array<"A" | "C" | "G" | "T"> = ["A", "C", "G", "T"];

export const GenomicSaturationHeatmap = memo(function GenomicSaturationHeatmap({
  chrom,
  genomicPos,
  genomicAlt,
  spliceProximity,
  wildWindow,
  relativeStartIndex,
  mutationIndex,
  mutation,
  residueIndex,
  hoveredResidueIndex,
  onResidueClick,
  onSelectGenomicVariant,
  metricMode = "mean"
}: GenomicSaturationHeatmapProps) {
  const { fetchWithAuth } = useApiClient();
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [data, setData] = useState<AlphaGenomeRegionSaturationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [hoveredCell, setHoveredCell] = useState<{
    pos: number;
    ref: string;
    alt: string;
    variant: AlphaGenomeSaturationVariant | null;
    codonIndex: number | null;
  } | null>(null);

  // Compute genomic region window: Exon ± 15 bp flank, or fallback ± 45 bp around variant
  const regionParams = useMemo(() => {
    const rawChrom = chrom || spliceProximity?.chrom || "";
    if (!rawChrom) return null;
    const effChrom = rawChrom.replace(/^chr/i, "");
    if (!effChrom) return null;

    const exonStart = spliceProximity?.exonStart;
    const exonEnd = spliceProximity?.exonEnd;
    const exonNum = spliceProximity?.exonNumber;
    const strand = spliceProximity?.strand;
    const transcriptId = spliceProximity?.transcriptId;

    let start = 0;
    let end = 0;

    if (exonStart && exonEnd && exonEnd >= exonStart) {
      start = Math.max(1, exonStart - 15);
      end = exonEnd + 15;
    } else if (genomicPos && genomicPos > 0) {
      start = Math.max(1, genomicPos - 45);
      end = genomicPos + 45;
    } else {
      return null;
    }

    return {
      chrom: effChrom,
      start,
      end,
      strand: strand === "+" || strand === "-" ? (strand as "+" | "-") : undefined,
      transcriptId,
      exonNumber: exonNum,
      exonStart,
      exonEnd
    };
  }, [chrom, genomicPos, spliceProximity]);

  useEffect(() => {
    let active = true;
    if (!regionParams) {
      setData(null);
      setLoading(false);
      return;
    }

    const fetchRegion = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchWithAuth("/api/v1/alphagenome/region-saturation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(regionParams)
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }

        const json: AlphaGenomeRegionSaturationResponse = await response.json();
        if (active) {
          setData(json);
        }
      } catch (err: any) {
        if (active) {
          console.warn("[GenomicSaturationHeatmap] Query failed:", err);
          setError(err.message || "Failed to load regional AlphaGenome data");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchRegion();
    return () => {
      active = false;
    };
  }, [regionParams, fetchWithAuth, reloadKey]);

  // Map ClinGen ACMG strength or continuous Phred to color classes
  const getCellColor = (phred: number | null | undefined, isRef: boolean): string => {
    if (isRef) {
      return "bg-cs-surface-2 text-cs-text-muted/60 border-cs-border-subtle/40";
    }
    if (phred === null || phred === undefined || isNaN(phred) || phred < 0) {
      return "bg-cs-bg-subtle text-cs-text-muted/40 border-cs-border-subtle/30";
    }

    if (phred >= THRESHOLDS.alphagenome.pathogenicStrong) {
      // PP3_Strong (>= 35 Phred): Deep Crimson
      return "bg-rose-700 text-white border-rose-800 shadow-xs";
    }
    if (phred >= THRESHOLDS.alphagenome.pathogenicModerate) {
      // PP3_Moderate (>= 25 Phred): Coral / Red
      return "bg-rose-500 text-white border-rose-600";
    }
    if (phred >= THRESHOLDS.alphagenome.pathogenicSupporting) {
      // PP3_Supporting (>= 15 Phred): Amber / Orange (High contrast dark text on amber)
      return "bg-amber-500 text-slate-950 font-semibold border-amber-600";
    }
    if (phred > THRESHOLDS.alphagenome.benign) {
      // Indeterminate (8 - 15 Phred): Muted slate
      return "bg-slate-500/25 text-slate-300 border-slate-500/30";
    }
    if (phred > THRESHOLDS.alphagenome.benignModerate) {
      // BP4_Supporting (5 - 8 Phred): Sage Green
      return "bg-emerald-600/50 text-emerald-200 border-emerald-600/30";
    }
    // BP4_Moderate (<= 5 Phred): Bright Emerald Green
    return "bg-emerald-500/80 text-white border-emerald-600";
  };

  const positions = data?.positions || [];
  const hasPositions = positions.length > 0;
  const isReverseStrand = regionParams?.strand === "-";

  // Ordered positions according to transcription orientation
  const orderedPositions = useMemo(() => {
    if (!hasPositions) return [];
    const copy = [...positions];
    if (isReverseStrand) {
      copy.sort((a, b) => b.pos - a.pos);
    } else {
      copy.sort((a, b) => a.pos - b.pos);
    }
    return copy;
  }, [positions, isReverseStrand, hasPositions]);

  // DeepMind Atlas link URL
  const atlasUrl = useMemo(() => {
    if (data?.atlasLocusUrl) return data.atlasLocusUrl;
    if (!regionParams) return "https://deepmind.google.com/science/alphagenome";
    const chromStr = regionParams.chrom.startsWith("chr") ? regionParams.chrom : `chr${regionParams.chrom}`;
    return `https://deepmind.google.com/science/alphagenome/atlas/locus?interval=${encodeURIComponent(chromStr)}%3A${regionParams.start}-${regionParams.end}`;
  }, [data, regionParams]);

  // Handle cell click
  const handleCellClick = (
    posData: AlphaGenomeSaturationPosition,
    base: "A" | "C" | "G" | "T",
    variant: AlphaGenomeSaturationVariant | null
  ) => {
    if (posData.codonIndex && onResidueClick) {
      onResidueClick(posData.codonIndex);
    }
    if (onSelectGenomicVariant) {
      onSelectGenomicVariant({
        chrom: regionParams?.chrom,
        pos: posData.pos,
        ref: posData.ref,
        alt: base,
        isRef: base === posData.ref,
        phred: variant?.phred ?? null,
        acmgStrength: variant?.acmgStrength ?? "indeterminate",
        topModality: variant?.topModality ?? posData.topModality ?? null,
        codonIndex: posData.codonIndex,
        codonPosition: posData.codonPosition,
        isExonic: posData.isExonic
      });
    }
  };

  // Sparkline coordinates
  const sparklineData = useMemo(() => {
    if (!orderedPositions.length) return null;
    const n = orderedPositions.length;
    const values = orderedPositions.map((p) => {
      const val = metricMode === "max" ? (p.maxPhred ?? p.meanPhred ?? 0) : (p.meanPhred ?? p.maxPhred ?? 0);
      return Math.max(0, val);
    });

    const maxVal = values.reduce((max, v) => Math.max(max, v), 45);
    const height = 36;
    const colWidth = 10; // 10px per base column
    const totalWidth = n * colWidth;

    const points = values.map((val, i) => {
      const x = i * colWidth + colWidth / 2;
      const y = height - (val / maxVal) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const pathD = `M ${points[0]} L ${points.join(" L ")}`;
    const areaD = `M 0,${height} L ${points[0]} L ${points.join(" L ")} L ${totalWidth},${height} Z`;

    // 15 Phred threshold line y position
    const thresholdY = height - (15.0 / maxVal) * (height - 4) - 2;

    return { pathD, areaD, totalWidth, height, thresholdY, maxVal };
  }, [orderedPositions, metricMode]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-cs-border-subtle bg-cs-surface-2 p-3 transition-colors mt-2">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-cs-border-subtle/80">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-cs-text-primary">
                AlphaGenome Saturation Mutagenesis & 1D Intolerance
              </h4>
              {regionParams && (
                <span className="text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-cs-surface border border-cs-border text-cs-accent-clay">
                  chr{regionParams.chrom}:{regionParams.start.toLocaleString()}–{regionParams.end.toLocaleString()}
                  {regionParams.strand ? ` (${regionParams.strand})` : ""}
                </span>
              )}
              {regionParams?.exonNumber && (
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cs-surface border border-cs-border-subtle text-cs-text-muted">
                  Exon {regionParams.exonNumber} (±15bp Splice Flank)
                </span>
              )}
            </div>
            <p className="text-[10px] text-cs-text-muted mt-0.5">
              High-resolution deep-learning saturation predicting pre-mRNA splicing disruption, chromatin accessibility, and missense constraint
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <a
            href={atlasUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-mono text-cs-accent-clay hover:underline px-2 py-1 rounded bg-cs-surface border border-cs-border transition"
            title="Open exact locus interval in Google DeepMind AlphaGenome Atlas"
          >
            <span>DeepMind Atlas</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-surface transition cursor-pointer"
            title={isExpanded ? "Collapse Saturation Heatmap" : "Expand Saturation Heatmap"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {loading ? (
            <div className="h-32 flex flex-col items-center justify-center text-xs text-cs-text-muted gap-2">
              <div className="w-5 h-5 border-2 border-cs-accent-clay border-t-transparent rounded-full animate-spin"></div>
              <span>Querying AlphaGenome saturation mutagenesis & 1D intolerance profile...</span>
            </div>
          ) : error ? (
            /* Network / Server Error State */
            <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/5 text-center flex flex-col items-center justify-center gap-2">
              <div className="text-xs font-semibold text-rose-500">
                AlphaGenome Regional Saturation Unavailable
              </div>
              <p className="text-[11px] text-cs-text-muted max-w-md">
                {error}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setReloadKey(k => k + 1)}
                  className="px-2.5 py-1 rounded bg-cs-surface border border-cs-border hover:bg-cs-surface-2 text-cs-text-primary text-[11px] font-mono transition cursor-pointer"
                >
                  Retry Query
                </button>
                <a
                  href={atlasUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-cs-accent-clay hover:underline px-2.5 py-1 rounded bg-cs-surface border border-cs-border transition"
                >
                  <span>Open in DeepMind Atlas</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : !hasPositions ? (
            /* Standby State */
            <div className="p-4 rounded-lg border border-dashed border-cs-border-subtle bg-cs-surface text-center flex flex-col items-center justify-center gap-2">
              <Activity className="w-6 h-6 text-cs-accent-clay/60 stroke-[1.5]" />
              <div className="text-xs font-semibold text-cs-text-primary">
                AlphaGenome Regional Saturation Standby
              </div>
              <p className="text-[11px] text-cs-text-muted max-w-md">
                {data?.message || "Direct in-browser API queries require an active AlphaGenome service connection. Under our strict no-heuristics protocol, synthetic scores are never fabricated. You can inspect the live DeepMind Atlas locus viewer for this exon:"}
              </p>
              <a
                href={atlasUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cs-accent-clay text-white font-mono text-xs font-semibold hover:opacity-90 transition"
              >
                <span>Explore Locus in DeepMind AlphaGenome Atlas</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            /* Active Live Visualizer Stack */
            <div className="flex flex-col gap-2 w-full overflow-x-auto pb-2 scrollbar-thin">
              <div className="min-w-fit flex flex-col">
                
                {/* 1D Intolerance Density Sparkline Track */}
                {sparklineData && (
                  <div className="flex items-center pl-2 mb-1">
                    <div className="w-[68px] text-[9px] font-semibold text-cs-text-secondary pr-2 shrink-0 select-none uppercase tracking-wider text-right flex flex-col justify-center">
                      <span title="Continuous Phred Intolerance Density Curve">1D DENSITY</span>
                      <span className="text-[7.5px] font-mono text-cs-text-muted">{metricMode.toUpperCase()}</span>
                    </div>
                    <div className="relative overflow-visible" style={{ width: sparklineData.totalWidth, height: sparklineData.height }}>
                      <svg
                        width={sparklineData.totalWidth}
                        height={sparklineData.height}
                        className="overflow-visible block"
                      >
                        {/* 15.0 Phred PP3 benchmark line */}
                        <line
                          x1={0}
                          y1={sparklineData.thresholdY}
                          x2={sparklineData.totalWidth}
                          y2={sparklineData.thresholdY}
                          stroke="var(--cs-warn)"
                          strokeWidth={0.75}
                          strokeDasharray="2 2"
                          opacity={0.6}
                        />
                        {/* Area gradient fill */}
                        <path
                          d={sparklineData.areaD}
                          fill="var(--cs-accent-clay)"
                          fillOpacity={0.12}
                        />
                        {/* Continuous curve */}
                        <path
                          d={sparklineData.pathD}
                          fill="none"
                          stroke="var(--cs-accent-clay)"
                          strokeWidth={1.25}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {/* 15 Phred label */}
                      <span
                        className="absolute right-1 text-[7.5px] font-mono text-cs-warn/80 pointer-events-none"
                        style={{ top: Math.max(0, sparklineData.thresholdY - 10) }}
                      >
                        15.0 Phred
                      </span>
                    </div>
                  </div>
                )}

                {/* Triplet Codon Bracket Indicators */}
                <div className="flex items-center pl-2 h-4 mb-0.5">
                  <div className="w-[68px] text-[8px] font-mono text-cs-text-muted pr-2 shrink-0 select-none uppercase tracking-wider text-right">
                    CODON
                  </div>
                  <div className="flex">
                    {orderedPositions.map((p) => {
                      const isFirstInCodon = p.isExonic ? p.codonPosition === 1 : false;
                      const isTargetCodon = p.codonIndex === mutationIndex;
                      const isHoveredCodon = p.codonIndex === hoveredResidueIndex || (hoveredCell && hoveredCell.codonIndex === p.codonIndex);
                      const isSelectedCodon = p.codonIndex === residueIndex;

                      return (
                        <div
                          key={`bracket-${p.pos}`}
                          className={`w-[10px] shrink-0 h-3 flex items-end justify-center border-b ${
                            isTargetCodon
                              ? "border-cs-warn border-b-2"
                              : isSelectedCodon
                                ? "border-cs-accent-clay border-b-2"
                                : isHoveredCodon
                                  ? "border-cs-text-primary"
                                  : "border-cs-border-subtle"
                          } ${isFirstInCodon ? "border-l border-cs-border/60" : ""}`}
                          title={`Genomic Pos: ${p.pos} | Codon: ${p.codonIndex || "Flank"} Pos: ${p.codonPosition || "-"}`}
                        >
                          {isFirstInCodon && p.codonIndex && (
                            <span className="text-[7.5px] font-mono font-bold text-cs-text-muted -translate-y-1">
                              {p.codonIndex}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4-Row Saturation Grid (A, C, G, T) */}
                {NUCLEOTIDES.map((base) => (
                  <div key={base} className="flex items-center pl-2 mb-0.5">
                    <span className="w-[68px] text-[9px] font-bold font-mono text-cs-text-secondary pr-2 shrink-0 select-none uppercase tracking-wider text-right">
                      {base}
                    </span>
                    <div className="flex">
                      {orderedPositions.map((posData) => {
                        const isRef = posData.ref === base;
                        const variant = isRef ? null : posData.variants[base] || null;
                        const phred = variant?.phred ?? null;
                        const isTargetPos = genomicPos !== null && genomicPos !== undefined && posData.pos === genomicPos;
                        const isQueryVariant = isTargetPos && Boolean(genomicAlt && base === genomicAlt.toUpperCase());
                        const colorClass = getCellColor(phred, isRef);

                        return (
                          <button
                            key={`${posData.pos}-${base}`}
                            type="button"
                            onClick={() => handleCellClick(posData, base, variant)}
                            onMouseEnter={() =>
                              setHoveredCell({
                                pos: posData.pos,
                                ref: posData.ref,
                                alt: base,
                                variant,
                                codonIndex: posData.codonIndex ?? null
                              })
                            }
                            onMouseLeave={() => setHoveredCell(null)}
                            className={`w-[10px] h-5 shrink-0 flex items-center justify-center font-mono text-[7px] border rounded-[2px] transition-all cursor-pointer ${colorClass} ${
                              isQueryVariant
                                ? "ring-2 ring-amber-400 z-10 animate-pulse font-black scale-110"
                                : isRef
                                  ? "opacity-50 hover:opacity-100"
                                  : "hover:scale-115 hover:z-20 hover:ring-1 hover:ring-cs-accent-clay"
                            }`}
                            title={
                              isRef
                                ? `Reference Base: ${base} at chr${regionParams?.chrom}:${posData.pos}`
                                : `chr${regionParams?.chrom}:${posData.pos} ${posData.ref}>${base} | Phred: ${phred !== null ? phred.toFixed(1) : "N/A"} (${variant?.acmgStrength || "indeterminate"})`
                            }
                            aria-label={
                              isRef
                                ? `Reference Base: ${base} at chr${regionParams?.chrom}:${posData.pos}`
                                : `chr${regionParams?.chrom}:${posData.pos} ${posData.ref}>${base} | Phred: ${phred !== null ? phred.toFixed(1) : "N/A"} (${variant?.acmgStrength || "indeterminate"})`
                            }
                          >
                            {isRef ? "·" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Reference Genomic Sequence Row */}
                <div className="flex items-center pl-2 mt-1">
                  <span className="w-[68px] text-[9px] font-semibold text-cs-good pr-2 shrink-0 select-none uppercase tracking-wider text-right">
                    REF GENOME
                  </span>
                  <div className="flex">
                    {orderedPositions.map((posData) => (
                      <div
                        key={`ref-${posData.pos}`}
                        className={`w-[10px] h-4 shrink-0 flex items-center justify-center font-mono text-[8px] font-bold ${
                          posData.isExonic ? "text-cs-text-primary" : "text-cs-text-muted/60 bg-cs-bg-subtle/50"
                        }`}
                        title={`Genomic Pos: chr${regionParams?.chrom}:${posData.pos} | Ref: ${posData.ref}${posData.isExonic ? " (Exonic)" : " (Intronic/Flank)"}`}
                      >
                        {posData.ref}
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Hover Inspection Quick-HUD */}
              {hoveredCell && (
                <div className="mt-2 p-2 rounded-lg border border-cs-border bg-cs-surface flex items-center justify-between text-[10.5px] font-mono gap-4 animate-fade-in">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-cs-text-primary">
                      chr{regionParams?.chrom}:{hoveredCell.pos} {hoveredCell.ref}&gt;{hoveredCell.alt}
                    </span>
                    {hoveredCell.ref === hoveredCell.alt ? (
                      <span className="px-1.5 py-0.2 rounded bg-cs-surface-2 border border-cs-border text-cs-text-muted text-[9px]">
                        Reference Nucleotide
                      </span>
                    ) : (
                      <>
                        <span className="px-1.5 py-0.2 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20 font-bold">
                          Phred: {hoveredCell.variant?.phred !== null && hoveredCell.variant?.phred !== undefined ? hoveredCell.variant.phred.toFixed(2) : "N/A"}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-cs-surface border border-cs-border text-[9px]">
                          Tier: {hoveredCell.variant?.acmgStrength || "indeterminate"}
                        </span>
                        {hoveredCell.variant?.topModality && (
                          <span className="px-1.5 py-0.2 rounded bg-cs-surface border border-cs-border text-cs-text-secondary text-[9px]">
                            Modality: {hoveredCell.variant.topModality}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {hoveredCell.codonIndex && (
                    <span className="text-cs-text-muted text-[9.5px]">
                      Codon Residue #{hoveredCell.codonIndex}
                    </span>
                  )}
                </div>
              )}

              {/* ClinGen ACMG Color Legend Bar */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-cs-border-subtle/60 text-[9px] font-mono text-cs-text-muted flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-bold uppercase tracking-wider text-cs-text-secondary">ClinGen Phred:</span>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-rose-700"></span>
                    <span>Strong (≥35)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-rose-500"></span>
                    <span>Mod (≥25)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-amber-500"></span>
                    <span>Supp (≥15)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-slate-500/30"></span>
                    <span>Indet (8–15)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded bg-emerald-600/60"></span>
                    <span>Benign (≤8)</span>
                  </div>
                </div>

                <span className="text-[8.5px] italic text-cs-text-muted">
                  Click any substitution to pin telemetry in the Inspector
                </span>
              </div>

            </div>
          )}
        </>
      )}
    </div>
  );
});

export default GenomicSaturationHeatmap;
