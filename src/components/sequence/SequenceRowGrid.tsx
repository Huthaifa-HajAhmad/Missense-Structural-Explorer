import React from "react";
import { THRESHOLDS } from "../../shared/thresholds";
import { SequenceRowGridProps } from "./types";

export const SequenceRowGrid: React.FC<SequenceRowGridProps> = ({
  wildWindow,
  relativeStartIndex,
  mutationIndex,
  residueIndex,
  hoveredResidueIndex,
  mutation,
  landscapeMap,
  metricMode,
  getResidueBaseColor,
  getGerpScore,
  getPhyloPScore,
  onResidueClick,
  hoveredResidue,
  setHoveredResidue
}) => {
  return (
    <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4">
      {/* Main Visualizer Window */}
      <div className="relative overflow-x-auto rounded-xl border border-cs-border p-4 flex flex-col justify-center scrollbar-thin select-none transition-colors bg-cs-surface-2 w-fit max-w-full shrink-0">
        
        {/* Top Coordinate indexes */}
        <div className="flex font-mono text-[9px] h-4 pl-[76px] mb-1 text-cs-text-muted">
          {wildWindow.map((_, i) => {
            const absolutePos = relativeStartIndex + i;
            const isMutationPos = absolutePos === mutationIndex;
            const showLabel = absolutePos % 5 === 0 || isMutationPos;
            
            return (
              <div key={i} className="w-[28px] shrink-0 text-center flex flex-col items-center justify-end">
                {showLabel && (
                  <span className={`transition-colors font-semibold ${isMutationPos ? "text-cs-warn font-bold" : "text-cs-text-muted"}`}>
                    {absolutePos}
                  </span>
                )}
                <span className={`w-0.5 h-1 ${isMutationPos ? "bg-cs-warn" : "bg-cs-border"} mt-0.5`}></span>
              </div>
            );
          })}
        </div>

        {/* Wild-Type Row */}
        <div className="flex items-center font-mono text-xs pl-2">
          <span className="w-[68px] text-[9px] font-semibold text-cs-good pr-2 shrink-0 select-none uppercase tracking-wider text-right">
            WILD-TYPE
          </span>
          <div className="flex">
            {wildWindow.map((residue, i) => {
              const absolutePos = relativeStartIndex + i;
              const isTarget = absolutePos === mutationIndex;
              const isSelected = absolutePos === residueIndex;
              const isHovered = absolutePos === hoveredResidueIndex || (hoveredResidue && hoveredResidue.pos === absolutePos);
              
              let colorClass = getResidueBaseColor(residue);
              if (isTarget) {
                colorClass = "bg-cs-good-soft text-cs-good border-cs-good/30";
              }
              
              return (
                <button
                  key={i}
                  onClick={() => onResidueClick && onResidueClick(absolutePos)}
                  onMouseEnter={() => setHoveredResidue && setHoveredResidue({ symbol: residue, pos: absolutePos, type: isTarget ? "wild" : "normal" })}
                  onMouseLeave={() => setHoveredResidue && setHoveredResidue(null)}
                  className={`w-[28px] h-8 shrink-0 flex items-center justify-center font-bold border rounded transition-all cursor-pointer ${colorClass} ${
                    isTarget
                      ? "ring-2 ring-cs-good scale-105 z-10 font-black animate-pulse"
                      : isSelected
                        ? "ring-1 ring-cs-border scale-102 z-10"
                        : isHovered
                          ? "ring-1 ring-cs-border-subtle"
                          : ""
                  }`}
                  title={`Wild-Type residue ${residue} at index #${absolutePos}`}
                >
                  {residue}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mutant Row */}
        <div className="flex items-center font-mono text-xs pl-2 mb-1.5">
          <span className="w-[68px] text-[9px] font-semibold text-cs-danger pr-2 shrink-0 select-none uppercase tracking-wider text-right">
            MUTANT
          </span>
          <div className="flex">
            {wildWindow.map((residue, i) => {
              const absolutePos = relativeStartIndex + i;
              const isTarget = absolutePos === mutationIndex;
              const isSelected = absolutePos === residueIndex;
              const isHovered = absolutePos === hoveredResidueIndex || (hoveredResidue && hoveredResidue.pos === absolutePos);
              
              let displayRes = residue;
              let colorClass = getResidueBaseColor(residue);
              
              if (isTarget) {
                displayRes = mutation.mut;
                colorClass = "bg-cs-danger-soft text-cs-danger border-cs-danger/30";
              }
              
              return (
                <button
                  key={i}
                  onClick={() => onResidueClick && onResidueClick(absolutePos)}
                  onMouseEnter={() => setHoveredResidue && setHoveredResidue({ symbol: displayRes, pos: absolutePos, type: isTarget ? "mutant" : "normal" })}
                  onMouseLeave={() => setHoveredResidue && setHoveredResidue(null)}
                  className={`w-[28px] h-8 shrink-0 flex items-center justify-center font-bold border rounded transition-all cursor-pointer ${colorClass} ${
                    isTarget
                      ? "ring-2 ring-cs-danger scale-105 z-10 font-black animate-pulse"
                      : isSelected
                        ? "ring-1 ring-cs-border scale-102 z-10"
                        : isHovered
                          ? "ring-1 ring-cs-border-subtle"
                          : ""
                  }`}
                  title={isTarget ? `Mutated residue ${mutation.wt}→${mutation.mut} at index #${absolutePos}` : `Residue ${residue} at index #${absolutePos}`}
                >
                  {displayRes}
                </button>
              );
            })}
          </div>
        </div>

        {/* REVEL Score Row */}
        <div className="flex items-center font-mono text-xs pl-2 mb-1.5">
          <span className="w-[68px] text-[9px] font-semibold text-cs-text-secondary pr-2 shrink-0 select-none uppercase tracking-wider text-right" title="Rare Exome Variant Ensemble Learner (Pathogenicity Score)">
            REVEL
          </span>
          <div className="flex">
            {wildWindow.map((_, i) => {
              const absolutePos = relativeStartIndex + i;
              const match = landscapeMap.get(absolutePos);
              
              const score = match 
                ? (metricMode === "mean" ? (match.revelMean ?? match.revelMax ?? null) : (match.revelMax ?? match.revelMean ?? null))
                : null;
                
              const isTarget = absolutePos === mutationIndex;
              const isSelected = absolutePos === residueIndex;
              
              let colorClass = "bg-cs-bg-subtle/80 text-cs-text-muted border-cs-border-subtle";
              if (score !== null) {
                if (score >= THRESHOLDS.revel.pathogenicStrong) {
                  colorClass = "bg-cs-danger-soft text-cs-danger border-cs-danger/30";
                } else if (score >= THRESHOLDS.revel.pathogenicSupporting) {
                  colorClass = "bg-cs-danger-soft/60 text-cs-danger/90 border-cs-danger/20";
                } else if (score >= THRESHOLDS.revel.benign) {
                  colorClass = "bg-cs-warn-soft text-cs-warn border-cs-warn/25";
                } else {
                  colorClass = "bg-cs-good-soft text-cs-good border-cs-good/20";
                }
              }

              const formatted = score !== null ? score.toFixed(2) : "N/A";
              
              return (
                <button
                  key={i}
                  onClick={() => onResidueClick && onResidueClick(absolutePos)}
                  className={`w-[28px] h-8 shrink-0 flex items-center justify-center font-bold border rounded text-[8px] transition-all cursor-pointer ${colorClass} ${
                    isTarget
                      ? "ring-2 ring-cs-accent-clay scale-105 z-10 font-black animate-pulse"
                      : isSelected
                        ? "ring-1 ring-cs-border scale-102 z-10"
                        : ""
                  }`}
                  title={isTarget
                    ? `Target Mutation ${mutation.wt}→${mutation.mut} Score: ${score !== null ? score.toFixed(3) : "N/A"}${metricMode === "mean" && match?.revelMean ? ` (Positional Mean Intolerance: ${match.revelMean.toFixed(3)})` : ""}`
                    : `Neighbor Position #${absolutePos} ${metricMode === "mean" ? "Mean Intolerance" : "Peak Constraint"}: ${score !== null ? score.toFixed(3) : "N/A"}`
                  }
                >
                  {formatted}
                </button>
              );
            })}
          </div>
        </div>

        {/* AlphaMissense Score Row */}
        <div className="flex items-center font-mono text-xs pl-2 mb-1.5">
          <span className="w-[68px] text-[9px] font-semibold text-cs-text-secondary pr-2 shrink-0 select-none uppercase tracking-wider text-right" title="Google DeepMind AlphaMissense (Pathogenicity Score)">
            ALPHA_MS
          </span>
          <div className="flex">
            {wildWindow.map((_, i) => {
              const absolutePos = relativeStartIndex + i;
              const match = landscapeMap.get(absolutePos);
              
              const score = match 
                ? (metricMode === "mean" ? (match.amMean ?? match.amMax ?? null) : (match.amMax ?? match.amMean ?? null))
                : null;
                
              const isTarget = absolutePos === mutationIndex;
              const isSelected = absolutePos === residueIndex;
              
              let colorClass = "bg-cs-bg-subtle/80 text-cs-text-muted border-cs-border-subtle";
              if (score !== null) {
                if (score >= THRESHOLDS.alphaMissense.pathogenicSupporting) {
                  colorClass = "bg-cs-danger-soft text-cs-danger border-cs-danger/30";
                } else if (score > THRESHOLDS.alphaMissense.likelyBenign) {
                  colorClass = "bg-cs-warn-soft text-cs-warn border-cs-warn/25";
                } else {
                  colorClass = "bg-cs-good-soft text-cs-good border-cs-good/20";
                }
              }

              const formatted = score !== null ? score.toFixed(2) : "N/A";
              
              return (
                <button
                  key={i}
                  onClick={() => onResidueClick && onResidueClick(absolutePos)}
                  className={`w-[28px] h-8 shrink-0 flex items-center justify-center font-bold border rounded text-[8px] transition-all cursor-pointer ${colorClass} ${
                    isTarget
                      ? "ring-2 ring-cs-accent-clay scale-105 z-10 font-black animate-pulse"
                      : isSelected
                        ? "ring-1 ring-cs-border scale-102 z-10"
                        : ""
                  }`}
                  title={isTarget 
                    ? `Target Mutation ${mutation.wt}→${mutation.mut} Score: ${score !== null ? score.toFixed(3) : "N/A"}${metricMode === "mean" && match?.amMean ? ` (Positional Mean Intolerance: ${match.amMean.toFixed(3)})` : ""}`
                    : `Neighbor Position #${absolutePos} ${metricMode === "mean" ? "Mean Intolerance" : "Peak Constraint"}: ${score !== null ? score.toFixed(3) : "N/A"}`
                  }
                >
                  {formatted}
                </button>
              );
            })}
          </div>
        </div>

        {/* GERP++ Score Row */}
        <div className="flex items-center font-mono text-xs pl-2 mb-1.5">
          <span className="w-[68px] text-[9px] font-semibold text-cs-good pr-2 shrink-0 select-none uppercase tracking-wider text-right" title="GERP++ Conservation Score">
            GERP++
          </span>
          <div className="flex">
            {wildWindow.map((_, i) => {
              const absolutePos = relativeStartIndex + i;
              const score = getGerpScore(absolutePos);
              const isTarget = absolutePos === mutationIndex;
              const isSelected = absolutePos === residueIndex;
              
              let colorClass = "bg-cs-bg-subtle/80 text-cs-text-muted border-cs-border-subtle";
              if (score !== null) {
                if (score >= THRESHOLDS.gerp.high) {
                  colorClass = "bg-cs-good-soft text-cs-good border-cs-good/30";
                } else if (score >= THRESHOLDS.gerp.moderate) {
                  colorClass = "bg-cs-warn-soft text-cs-warn border-cs-warn/30";
                } else {
                  colorClass = "bg-cs-surface-2 text-cs-text-muted border-cs-border-subtle/50";
                }
              }

              const formatted = score !== null ? score.toFixed(1) : "N/A";
              
              return (
                <button
                  key={i}
                  onClick={() => onResidueClick && onResidueClick(absolutePos)}
                  className={`w-[28px] h-8 shrink-0 flex items-center justify-center font-bold border rounded text-[8px] transition-all cursor-pointer ${colorClass} ${
                    isTarget
                      ? "ring-2 ring-cs-good scale-105 z-10 font-black"
                      : isSelected
                        ? "ring-1 ring-cs-border scale-102 z-10"
                        : ""
                  }`}
                  title={`GERP++ Score: ${score !== null ? score.toFixed(3) : "N/A"} at residue #${absolutePos}`}
                >
                  {formatted}
                </button>
              );
            })}
          </div>
        </div>

        {/* PhyloP Score Row */}
        <div className="flex items-center font-mono text-xs pl-2">
          <span className="w-[68px] text-[9px] font-semibold text-cs-good pr-2 shrink-0 select-none uppercase tracking-wider text-right" title="PhyloP Conservation Score">
            PHYLOP
          </span>
          <div className="flex">
            {wildWindow.map((_, i) => {
              const absolutePos = relativeStartIndex + i;
              const score = getPhyloPScore(absolutePos);
              const isTarget = absolutePos === mutationIndex;
              const isSelected = absolutePos === residueIndex;
              
              let colorClass = "bg-cs-bg-subtle/80 text-cs-text-muted border-cs-border-subtle";
              if (score !== null) {
                if (score >= THRESHOLDS.phylop.high) {
                  colorClass = "bg-cs-good-soft text-cs-good border-cs-good/30";
                } else if (score >= THRESHOLDS.phylop.moderate) {
                  colorClass = "bg-cs-warn-soft text-cs-warn border-cs-warn/30";
                } else {
                  colorClass = "bg-cs-surface-2 text-cs-text-muted border-cs-border-subtle/50";
                }
              }

              const formatted = score !== null ? score.toFixed(1) : "N/A";
              
              return (
                <button
                  key={i}
                  onClick={() => onResidueClick && onResidueClick(absolutePos)}
                  className={`w-[28px] h-8 shrink-0 flex items-center justify-center font-bold border rounded text-[8px] transition-all cursor-pointer ${colorClass} ${
                    isTarget
                      ? "ring-2 ring-cs-good scale-105 z-10 font-black"
                      : isSelected
                        ? "ring-1 ring-cs-border scale-102 z-10"
                        : ""
                  }`}
                  title={`PhyloP Score: ${score !== null ? score.toFixed(3) : "N/A"} at residue #${absolutePos}`}
                >
                  {formatted}
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* Threshold Legend Bar (Columns Layout to the Right of residues container) */}
      <div className="flex-1 min-w-[280px] lg:max-w-[420px] p-4 rounded-xl border border-cs-border-subtle bg-cs-surface-2 self-stretch flex flex-col gap-3 justify-start select-none font-sans">
        <span className="text-[10px] font-bold font-mono tracking-wider text-cs-text-primary uppercase border-b border-cs-border-subtle pb-1 mb-1 block">
          Threshold Legends
        </span>
        
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[10px] font-sans text-cs-text-secondary leading-normal">
          {/* Column 1: Pathogenicity */}
          <div className="flex flex-col gap-2.5">
            {/* REVEL Block */}
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[9px] uppercase tracking-wider text-cs-accent-clay">REVEL</span>
              <div className="flex flex-col gap-1 pl-1 font-mono text-[9px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-danger-soft border border-cs-danger/40 shrink-0"></span>
                  <span>Pathogenic (≥{THRESHOLDS.revel.pathogenicStrong.toFixed(2)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-warn-soft border border-cs-warn/30 shrink-0"></span>
                  <span>VUS ({THRESHOLDS.revel.benign.toFixed(2)}–{THRESHOLDS.revel.pathogenicStrong.toFixed(2)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-good-soft border border-cs-good/20 shrink-0"></span>
                  <span>Benign (&lt;{THRESHOLDS.revel.benign.toFixed(2)})</span>
                </div>
              </div>
            </div>

            {/* AlphaMissense Block */}
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[9px] uppercase tracking-wider text-cs-accent-clay">AlphaMissense</span>
              <div className="flex flex-col gap-1 pl-1 font-mono text-[9px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-danger-soft border border-cs-danger/40 shrink-0"></span>
                  <span>Pathogenic (≥{THRESHOLDS.alphaMissense.pathogenicSupporting})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-warn-soft border border-cs-warn/30 shrink-0"></span>
                  <span>VUS ({THRESHOLDS.alphaMissense.likelyBenign}–{THRESHOLDS.alphaMissense.pathogenicSupporting})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-good-soft border border-cs-good/20 shrink-0"></span>
                  <span>Benign (&lt;{THRESHOLDS.alphaMissense.likelyBenign})</span>
                </div>
              </div>
            </div>
          </div>

          {/* Column 2: Conservation */}
          <div className="flex flex-col gap-2.5">
            {/* GERP++ Block */}
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[9px] uppercase tracking-wider text-cs-good">GERP++</span>
              <div className="flex flex-col gap-1 pl-1 font-mono text-[9px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-good-soft border border-cs-good/40 shrink-0"></span>
                  <span>High (≥{THRESHOLDS.gerp.high.toFixed(1)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-warn-soft border border-cs-warn/30 shrink-0"></span>
                  <span>Mod ({THRESHOLDS.gerp.moderate.toFixed(1)}–{THRESHOLDS.gerp.high.toFixed(1)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-surface border border-cs-border shrink-0"></span>
                  <span>Low (&lt;{THRESHOLDS.gerp.moderate.toFixed(1)})</span>
                </div>
              </div>
            </div>

            {/* PhyloP Block */}
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[9px] uppercase tracking-wider text-cs-good">PhyloP</span>
              <div className="flex flex-col gap-1 pl-1 font-mono text-[9px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-good-soft border border-cs-good/40 shrink-0"></span>
                  <span>High (≥{THRESHOLDS.phylop.high.toFixed(1)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-warn-soft border border-cs-warn/30 shrink-0"></span>
                  <span>Mod ({THRESHOLDS.phylop.moderate.toFixed(1)}–{THRESHOLDS.phylop.high.toFixed(1)})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded bg-cs-surface border border-cs-border shrink-0"></span>
                  <span>Low (&lt;{THRESHOLDS.phylop.moderate.toFixed(1)})</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
