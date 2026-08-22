import React from "react";
import { Sliders, Map, Compass, Bookmark } from "lucide-react";
import { AnalysisResult, UniprotFeatureItem } from "../../types";
import LandscapeMinimap from "../LandscapeMinimap";

interface LandscapeInspectorProps {
  analysisResult: AnalysisResult | null;
  metricMode?: "mean" | "max";
  setMetricMode?: (mode: "mean" | "max") => void;
  windowSize?: number;
  setWindowSize?: (size: number) => void;
  onSelectResidueIndex?: (idx: number) => void;
}

export const LandscapeInspector: React.FC<LandscapeInspectorProps> = ({
  analysisResult,
  metricMode = "mean",
  setMetricMode,
  windowSize = 31,
  setWindowSize,
  onSelectResidueIndex
}) => {
  const domains: UniprotFeatureItem[] = (analysisResult?.uniprotFeatures?.features || []).filter(
    (f: any) => f.type === "DOMAIN" || f.type === "REGION"
  );

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
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
