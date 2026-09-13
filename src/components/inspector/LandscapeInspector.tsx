import React from "react";
import { Sliders, Map, Compass, Bookmark, Atom, Sparkles, Activity, Dna } from "lucide-react";
import { AnalysisResult, UniprotFeatureItem } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { getNearestResidues } from "../../data";
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

  const activeResidueMatch = React.useMemo(() => {
    if (!activeResIndex || !analysisResult?.landscapeData) return null;
    return analysisResult.landscapeData.find((d: any) => d.residx === activeResIndex) || null;
  }, [activeResIndex, analysisResult?.landscapeData]);

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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-cs-accent-clay uppercase tracking-wider">
                    Protein Residue #{activeResIndex}
                  </span>
                  {activeResidueMatch && (
                    <span className="text-[8.5px] font-mono text-cs-text-muted">
                      {activeResidueMatch.revelCount || activeResidueMatch.amCount || 0} evaluated variants
                    </span>
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
                  <div className="text-[10px] italic text-cs-text-muted">
                    No positional landscape scores available for residue #{activeResIndex}.
                  </div>
                )}

                {/* 3D Spatial Neighbors */}
                {nearestSpatialNeighbors.length > 0 && (
                  <div className="pt-1">
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
            <Map className="w-3.5 h-3.5 text-cs-accent-clay" />
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
