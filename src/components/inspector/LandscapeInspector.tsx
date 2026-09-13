import React from "react";
import { Sliders, Map as MapIcon, Compass, Bookmark, Atom, Sparkles, Activity, Dna } from "lucide-react";
import { AnalysisResult, UniprotFeatureItem } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { getNearestResidues } from "../../data";
import { AMINO_ACID_MAP_FULL, AMINO_ACID_MAP_3_TO_1 } from "../sequence/sequenceConstants";
import { AMINO_ACID_1_TO_3_TITLE } from "../../aminoAcids";
import LandscapeMinimap from "../LandscapeMinimap";

interface LandscapeInspectorProps {
  analysisResult: AnalysisResult | null;
  metricMode?: "mean" | "max";
  setMetricMode?: (mode: "mean" | "max") => void;
  windowSize?: number;
  setWindowSize?: (size: number) => void;
  onSelectResidueIndex?: (idx: number) => void;
  selectedResidueIndex?: number | null;
  selectedGenomicVariant?: any | null;
}

export const LandscapeInspector: React.FC<LandscapeInspectorProps> = ({
  analysisResult,
  metricMode = "mean",
  setMetricMode,
  windowSize = 31,
  setWindowSize,
  onSelectResidueIndex,
  selectedResidueIndex: selectedResidueProp,
  selectedGenomicVariant: selectedGenomicVariantProp
}) => {
  const storeSelectedRes = useVariantAnalysisStore((s) => s.selectedResidueIndex);
  const storeHoveredRes = useVariantAnalysisStore((s) => s.hoveredResidueIndex);
  const storeGenomicVariant = useVariantAnalysisStore((s) => s.selectedGenomicVariant);
  const uniprotId = useVariantAnalysisStore((s) => s.uniprotId);
  const variant = useVariantAnalysisStore((s) => s.variant);
  const activeResIndex = selectedResidueProp ?? storeSelectedRes ?? storeHoveredRes;
  const selectedGenomicVariant = selectedGenomicVariantProp ?? storeGenomicVariant;

  const domains: UniprotFeatureItem[] = (analysisResult?.uniprotFeatures?.features || []).filter(
    (f: any) => f.type === "DOMAIN" || f.type === "REGION"
  );

  const landscapeMap = React.useMemo(() => {
    const map = new Map<number, any>();
    if (analysisResult?.landscapeData && Array.isArray(analysisResult.landscapeData)) {
      for (const item of analysisResult.landscapeData) {
        if (item && typeof item.residx === "number") {
          map.set(item.residx, item);
        }
      }
    }
    return map;
  }, [analysisResult?.landscapeData]);

  const activeResidueMatch = activeResIndex ? landscapeMap.get(activeResIndex) ?? null : null;

  const parsedProtein = React.useMemo(() => {
    const raw = variant || analysisResult?.metadata?.variant || "";
    if (!raw) return null;
    // Reject genomic coordinate strings (e.g. chr17:7674220:C>T or 10-102919946-C-G)
    if (/^(?:chr)?[\dXYM]+[-:]/i.test(raw)) {
      return null;
    }
    const match = raw.match(/^(?:p\.)?([A-Za-z]{1,3})(\d+)([A-Za-z]{1,3})?$/);
    if (!match) return null;
    const rawWt = match[1];
    const pos = parseInt(match[2], 10);
    const rawMut = match[3] || "";
    const wt = rawWt.length === 3 ? (AMINO_ACID_MAP_3_TO_1[rawWt.toUpperCase()] || rawWt) : rawWt;
    const mut = rawMut.length === 3 ? (AMINO_ACID_MAP_3_TO_1[rawMut.toUpperCase()] || rawMut) : rawMut;
    return { pos, wt, mut };
  }, [variant, analysisResult?.metadata?.variant]);

  const targetResidueIndex = React.useMemo(() => {
    if (analysisResult?.metadata?.residueIndex) {
      return analysisResult.metadata.residueIndex;
    }
    return parsedProtein?.pos ?? null;
  }, [analysisResult?.metadata?.residueIndex, parsedProtein]);

  const isTargetResidue = Boolean(activeResIndex && targetResidueIndex && activeResIndex === targetResidueIndex);

  const targetWildType = React.useMemo(() => {
    if (analysisResult?.metadata?.wildType) {
      return analysisResult.metadata.wildType;
    }
    return parsedProtein?.wt ?? "";
  }, [analysisResult?.metadata?.wildType, parsedProtein]);

  const targetMutant = React.useMemo(() => {
    if (analysisResult?.metadata?.mutant) {
      return analysisResult.metadata.mutant;
    }
    return parsedProtein?.mut ?? "";
  }, [analysisResult?.metadata?.mutant, parsedProtein]);

  const resSymbol = React.useMemo(() => {
    if (!activeResIndex) return "";
    if (activeResidueMatch?.residue) {
      return activeResidueMatch.residue;
    }
    if (isTargetResidue && targetWildType) {
      return targetWildType;
    }
    return "";
  }, [activeResIndex, activeResidueMatch, isTargetResidue, targetWildType]);

  const aaData = resSymbol ? AMINO_ACID_MAP_FULL[resSymbol] : null;

  const targetRevel = isTargetResidue && analysisResult?.conservationData?.revel !== undefined && analysisResult?.conservationData?.revel !== null
    ? parseFloat(String(analysisResult.conservationData.revel))
    : null;
  const targetAm = isTargetResidue && analysisResult?.predictorData?.amPathogenicity !== undefined && analysisResult?.predictorData?.amPathogenicity !== null
    ? parseFloat(String(analysisResult.predictorData.amPathogenicity))
    : null;

  const gerpScore = isTargetResidue && analysisResult?.conservationData?.gerp !== undefined && analysisResult?.conservationData?.gerp !== null
    ? parseFloat(String(analysisResult.conservationData.gerp))
    : (activeResidueMatch?.gerp !== undefined && activeResidueMatch?.gerp !== null ? Number(activeResidueMatch.gerp) : null);
  const phylopScore = isTargetResidue && analysisResult?.conservationData?.phylop !== undefined && analysisResult?.conservationData?.phylop !== null
    ? parseFloat(String(analysisResult.conservationData.phylop))
    : (activeResidueMatch?.phylop !== undefined && activeResidueMatch?.phylop !== null ? Number(activeResidueMatch.phylop) : null);

  const nearestSpatialNeighbors = React.useMemo(() => {
    if (!activeResIndex || !uniprotId || !variant) return [];
    return getNearestResidues(uniprotId, variant, activeResIndex);
  }, [activeResIndex, uniprotId, variant]);

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── Active Selection Telemetry HUD ── */}
      {(selectedGenomicVariant || activeResIndex) && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cs-accent-clay" />
            Active Position Telemetry
          </span>

          <div className="p-3 rounded-lg border border-cs-accent-clay/30 bg-cs-surface-2 space-y-2.5 animate-fade-in shadow-xs">
            {/* Genomic SNV Telemetry (if nucleotide selected) */}
            {selectedGenomicVariant && (
              <div className="space-y-1.5 pb-2 border-b border-cs-border-subtle">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-xs text-cs-text-primary">
                    chr{selectedGenomicVariant.chrom}:{selectedGenomicVariant.pos} {selectedGenomicVariant.ref}&gt;{selectedGenomicVariant.alt}
                  </span>
                  <span className={`font-mono text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    selectedGenomicVariant.acmgStrength === "PP3_Strong"
                      ? "bg-rose-700 text-white"
                      : selectedGenomicVariant.acmgStrength === "PP3_Moderate"
                        ? "bg-rose-500 text-white"
                        : selectedGenomicVariant.acmgStrength === "PP3_Supporting"
                          ? "bg-amber-500 text-white"
                          : selectedGenomicVariant.acmgStrength?.startsWith("BP4")
                            ? "bg-emerald-600 text-white"
                            : "bg-cs-surface border border-cs-border text-cs-text-muted"
                  }`}>
                    {selectedGenomicVariant.acmgStrength}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono pt-1">
                  <div className="flex flex-col">
                    <span className="text-[8.5px] text-cs-text-muted uppercase">AlphaGenome Phred</span>
                    <span className="font-bold text-cs-accent-clay">
                      {selectedGenomicVariant.phred !== null && selectedGenomicVariant.phred !== undefined
                        ? Number(selectedGenomicVariant.phred).toFixed(2)
                        : "N/A"}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8.5px] text-cs-text-muted uppercase">Codon Location</span>
                    <span className="text-cs-text-secondary">
                      {selectedGenomicVariant.codonIndex ? `Res #${selectedGenomicVariant.codonIndex} (Pos ${selectedGenomicVariant.codonPosition}/3)` : "Splice Flank"}
                    </span>
                  </div>
                </div>

                {selectedGenomicVariant.topModality && (
                  <div className="text-[9.5px] font-mono text-cs-text-muted bg-cs-surface p-1.5 rounded border border-cs-border-subtle">
                    <span className="text-cs-accent-clay font-semibold">Top Disrupted Modality: </span>
                    <span>{selectedGenomicVariant.topModality}</span>
                  </div>
                )}
              </div>
            )}

            {/* Protein Residue Telemetry */}
            {activeResIndex && (
              <div className="space-y-2.5">
                {/* Residue Identity Header */}
                <div className="flex items-start gap-2.5">
                  <div className={`h-9 w-9 rounded-lg shrink-0 flex items-center justify-center font-mono font-bold text-sm border ${
                    isTargetResidue
                      ? "bg-cs-danger-soft text-cs-danger border-cs-danger/30"
                      : aaData?.color
                        ? aaData.color
                        : "bg-cs-surface text-cs-accent-clay border-cs-border"
                  }`}>
                    {resSymbol || `#${activeResIndex}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-xs text-cs-text-primary">
                        {aaData?.name || `Residue #${activeResIndex}`} {resSymbol ? `(${resSymbol}${activeResIndex})` : `#${activeResIndex}`}
                      </span>
                      {isTargetResidue && (targetWildType || targetMutant) && (
                        <span className="text-[8px] font-mono uppercase bg-cs-danger-soft text-cs-danger border border-cs-danger/20 px-1 py-0.5 rounded font-bold">
                          Target ({AMINO_ACID_1_TO_3_TITLE[targetWildType] || targetWildType} → {AMINO_ACID_1_TO_3_TITLE[targetMutant] || targetMutant})
                        </span>
                      )}
                    </div>
                    {aaData?.property && (
                      <span className="text-[9.5px] text-cs-text-muted block truncate" title={aaData.property}>
                        {aaData.property}
                      </span>
                    )}
                  </div>
                </div>

                {/* Target Variant Direct Scores (if target residue) */}
                {isTargetResidue && (targetRevel !== null || targetAm !== null) && (
                  <div className="p-2 rounded-lg bg-cs-surface border border-cs-danger/20 text-[10px] font-mono space-y-1">
                    <span className="text-[8.5px] uppercase font-bold text-cs-danger tracking-wider block">
                      Target Mutation Direct Pathogenicity
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {targetRevel !== null && !isNaN(targetRevel) && (
                        <div>
                          <span className="text-cs-text-muted block text-[8px]">REVEL (Target)</span>
                          <strong className="text-cs-accent-clay">{targetRevel.toFixed(3)}</strong>
                        </div>
                      )}
                      {targetAm !== null && !isNaN(targetAm) && (
                        <div>
                          <span className="text-cs-text-muted block text-[8px]">AlphaMissense (Target)</span>
                          <strong className="text-cs-accent-clay">{targetAm.toFixed(3)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Surrounding Landscape Positional Metrics */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[9px] font-mono text-cs-text-muted">
                    <span className="uppercase tracking-wider">Positional Intolerance</span>
                    {activeResidueMatch && (
                      <span>{activeResidueMatch.revelCount || activeResidueMatch.amCount || 0} evaluated variants</span>
                    )}
                  </div>
                  {activeResidueMatch ? (
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-cs-surface p-2 rounded border border-cs-border-subtle">
                      <div>
                        <span className="text-cs-accent-clay font-bold block">REVEL</span>
                        <span className="text-cs-text-primary">
                          Mean: {activeResidueMatch.revelMean?.toFixed(3) ?? "N/A"}
                        </span>
                        <span className="text-cs-text-muted block text-[8.5px]">
                          Peak: {activeResidueMatch.revelMax?.toFixed(2) ?? "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-cs-accent-clay font-bold block">AlphaMissense</span>
                        <span className="text-cs-text-primary">
                          Mean: {activeResidueMatch.amMean?.toFixed(3) ?? "N/A"}
                        </span>
                        <span className="text-cs-text-muted block text-[8.5px]">
                          Peak: {activeResidueMatch.amMax?.toFixed(2) ?? "N/A"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] italic text-cs-text-muted p-2 rounded bg-cs-surface border border-cs-border-subtle">
                      No positional landscape scores available for residue #{activeResIndex}.
                    </div>
                  )}
                </div>

                {/* Conservation Scores (GERP++ & PhyloP) */}
                {(gerpScore !== null || phylopScore !== null) && (
                  <div className="flex items-center justify-between gap-2 p-1.5 rounded bg-cs-surface border border-cs-border-subtle text-[9.5px] font-mono">
                    <span className="text-cs-text-muted uppercase text-[8.5px]">Conservation</span>
                    <div className="flex items-center gap-3">
                      {gerpScore !== null && !isNaN(gerpScore) && (
                        <span>GERP++: <strong className="text-cs-good">{gerpScore.toFixed(2)}</strong></span>
                      )}
                      {phylopScore !== null && !isNaN(phylopScore) && (
                        <span>PhyloP: <strong className="text-cs-good">{phylopScore.toFixed(2)}</strong></span>
                      )}
                    </div>
                  </div>
                )}

                {/* 3D Spatial Neighbors */}
                {nearestSpatialNeighbors.length > 0 && (
                  <div className="pt-0.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-cs-text-muted flex items-center gap-1 mb-1">
                      <Atom className="w-3 h-3 text-cs-accent-clay" />
                      Spatial Neighbors (≤5Å)
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {nearestSpatialNeighbors.slice(0, 5).map((n, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-[9px] font-mono text-cs-text-secondary"
                          title={`${n.name}: ${n.properties} (${n.role})`}
                        >
                          {n.name} ({n.distance})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── 1. Sequence Visualizer Display Controls ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-cs-accent-clay" />
          Intolerance Smoothing & Metrics
        </span>

        <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-3">
          {/* Mean vs Peak Metric Mode (Mean is Default) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-cs-text-muted">
              Intolerance Aggregation
            </span>
            <div className="grid grid-cols-2 rounded-lg border border-cs-border p-0.5 bg-cs-surface font-semibold text-[11px]">
              <button
                type="button"
                onClick={() => setMetricMode?.("mean")}
                className={`py-1 rounded-md transition-all cursor-pointer text-center ${
                  metricMode === "mean"
                    ? "bg-cs-accent-clay text-white shadow-xs font-bold"
                    : "text-cs-text-muted hover:text-cs-text-primary"
                }`}
              >
                Mean (Default)
              </button>
              <button
                type="button"
                onClick={() => setMetricMode?.("max")}
                className={`py-1 rounded-md transition-all cursor-pointer text-center ${
                  metricMode === "max"
                    ? "bg-cs-accent-clay text-white shadow-xs font-bold"
                    : "text-cs-text-muted hover:text-cs-text-primary"
                }`}
              >
                Peak Intolerance
              </button>
            </div>
          </div>

          {/* Window Size Selector */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[9px] font-mono font-bold text-cs-text-muted">
              <span className="uppercase tracking-wider">Smoothing Window</span>
              <span className="text-cs-accent-clay font-bold">{windowSize} residues</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {[15, 21, 31, 41].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setWindowSize?.(size)}
                  className={`py-1 rounded border text-[10px] font-mono font-semibold transition-all cursor-pointer ${
                    windowSize === size
                      ? "border-cs-accent-clay bg-cs-accent-clay/10 text-cs-accent-clay font-bold"
                      : "border-cs-border bg-cs-surface text-cs-text-secondary hover:text-cs-text-primary"
                  }`}
                >
                  {size}aa
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Full-Protein Intolerance Minimap ── */}
      {analysisResult?.landscapeData && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <MapIcon className="w-3.5 h-3.5 text-cs-accent-clay" />
            Whole-Protein Minimap
          </span>

          <div className="rounded-lg border border-cs-border-subtle bg-cs-surface-2 p-2">
            <LandscapeMinimap
              landscapeData={analysisResult.landscapeData}
              currentAM={analysisResult.predictorData?.amPathogenicity}
              currentREVEL={analysisResult.conservationData?.revel}
              metricMode={metricMode}
            />
          </div>
        </div>
      )}

      {/* ── 3. Functional Domain Fast-Jump Index ── */}
      {domains.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-cs-accent-clay" />
              Domain Index
            </span>
            <span className="text-[9px] font-mono text-cs-text-muted">{domains.length} regions</span>
          </div>

          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-0.5">
            {domains.map((dom, dIdx) => (
              <button
                key={`${dom.description}_${dIdx}`}
                type="button"
                onClick={() => onSelectResidueIndex?.(dom.start)}
                className="p-2 rounded-lg border border-cs-border-subtle bg-cs-surface-2 hover:border-cs-accent-clay hover:bg-cs-bg-subtle text-left transition-all cursor-pointer flex flex-col gap-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[11px] text-cs-text-primary truncate">
                    {dom.description || "Domain Region"}
                  </span>
                  <span className="font-mono text-[9.5px] px-1.5 py-0.2 rounded bg-cs-surface border border-cs-border text-cs-text-secondary shrink-0">
                    {dom.start}–{dom.end}
                  </span>
                </div>
                <span className="text-[9.5px] text-cs-text-muted font-mono">
                  Length: {dom.end - dom.start + 1} aa
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(LandscapeInspector);
