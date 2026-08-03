import React from "react";
import { Atom } from "lucide-react";
import { AMINO_ACID_MAP_FULL, getSubstitutionGroup } from "./sequenceConstants";
import { AMINO_ACID_1_TO_3_TITLE } from "../../aminoAcids";
import { getNearestResidues } from "../../data";
import { ResidueDetailTooltipProps } from "./types";

export const ResidueDetailTooltip: React.FC<ResidueDetailTooltipProps> = ({
  hoveredResidue,
  hoveredResidueIndex,
  residueIndex,
  mutationIndex,
  sequence,
  mutation,
  uniprotId,
  variant,
  landscapeMap,
  conservationData,
  predictorData,
  computedResiduesCache,
  getGerpScore,
  getPhyloPScore,
  getBiophysicalConsequence,
  getSubstitutionalConsequences
}) => {
  const activeResOpt = hoveredResidue 
    ? { symbol: hoveredResidue.symbol, pos: hoveredResidue.pos, type: hoveredResidue.type }
    : (hoveredResidueIndex !== null && hoveredResidueIndex !== undefined && sequence && (hoveredResidueIndex - 1 >= 0) && (hoveredResidueIndex - 1 < sequence.length))
      ? { 
          symbol: sequence[hoveredResidueIndex - 1], 
          pos: hoveredResidueIndex, 
          type: (hoveredResidueIndex === mutationIndex) ? "wild" as const : "normal" as const
        }
      : (residueIndex !== null && residueIndex !== undefined && sequence && (residueIndex - 1 >= 0) && (residueIndex - 1 < sequence.length))
        ? {
            symbol: sequence[residueIndex - 1],
            pos: residueIndex,
            type: (residueIndex === mutationIndex) ? "wild" as const : "normal" as const
          }
        : {
            symbol: mutation.wt,
            pos: mutationIndex,
            type: "wild" as const
          };

  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-3 rounded-lg border transition-colors bg-cs-surface-2 border-cs-border-subtle">
      <div className="flex items-start gap-3 w-full">
        <div className={`h-11 w-11 rounded-xl shrink-0 flex flex-col items-center justify-center font-mono font-bold text-base shadow-inner border transition-colors ${
          activeResOpt?.type === "wild" ? "text-cs-good border-cs-good/20 bg-cs-good/5" :
          activeResOpt?.type === "mutant" ? "text-cs-danger border-cs-danger/20 bg-cs-danger/5" :
          activeResOpt ? "text-cs-accent-clay border-cs-accent-clay/20 bg-cs-accent-clay/5" : "text-cs-accent-clay"
        }`}>
          {activeResOpt ? activeResOpt.symbol : mutation.wt}
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-wider block text-cs-text-muted">
            {activeResOpt ? `Residue Position #${activeResOpt.pos} Info` : "Mutation Substitution Summary"}
          </span>

          {activeResOpt ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-cs-text-primary">
                  {AMINO_ACID_MAP_FULL[activeResOpt.symbol]?.name || "Unknown Amino Acid"}
                </span>
                {activeResOpt.pos === mutationIndex ? (
                  <span className="text-[8px] font-mono uppercase bg-cs-danger-soft text-cs-danger border border-cs-danger/20 px-1 rounded font-bold">
                    Target Mutation Site ({AMINO_ACID_1_TO_3_TITLE[mutation.wt] || mutation.wt} → {AMINO_ACID_1_TO_3_TITLE[mutation.mut] || mutation.mut})
                  </span>
                ) : (
                  <span className="text-[8px] font-mono uppercase bg-cs-surface-2 border border-cs-border text-cs-text-muted px-1 rounded">
                    Landscape Context
                  </span>
                )}
                <div className="text-xs text-cs-text-muted flex flex-wrap gap-x-4 gap-y-1 py-1 w-full">
                  <span className="w-full mb-1">Properties: <strong className="text-cs-accent-clay font-semibold">{AMINO_ACID_MAP_FULL[activeResOpt.symbol]?.property || "N/A"}</strong></span>
                  {(() => {
                    const match = landscapeMap.get(activeResOpt.pos);
                    const gerp = getGerpScore(activeResOpt.pos);
                    const phylop = getPhyloPScore(activeResOpt.pos);

                    const isTarget = activeResOpt.pos === mutationIndex;
                    const revelTarget = isTarget && conservationData?.revel !== undefined && conservationData?.revel !== null
                      ? parseFloat(conservationData.revel)
                      : null;
                    const amTarget = isTarget && predictorData?.amPathogenicity !== undefined && predictorData?.amPathogenicity !== null
                      ? parseFloat(predictorData.amPathogenicity)
                      : null;

                    return (
                      <div className="space-y-2 mt-1.5 w-full">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-b py-2 w-full transition-colors border-cs-border-subtle">
                          {/* REVEL stats block */}
                          <div className="flex flex-col gap-1 text-[11px] flex-1">
                            <span className="font-bold text-cs-accent-clay uppercase tracking-wider text-[9px] font-mono">REVEL Distribution</span>
                            {revelTarget !== null && (
                              <div className="flex justify-between">
                                <span>Target Mutation ({mutation.wt}→{mutation.mut}):</span>
                                <strong className="text-cs-accent-clay font-mono">{revelTarget.toFixed(3)}</strong>
                              </div>
                            )}
                            {match ? (
                              <>
                                <div className="flex justify-between opacity-85">
                                  <span>Positional Mean:</span>
                                  <strong className="font-mono text-cs-text-primary">{match.revelMean !== null && match.revelMean !== undefined ? match.revelMean.toFixed(3) : "N/A"}</strong>
                                </div>
                                <div className="flex justify-between opacity-85">
                                  <span>Positional Median:</span>
                                  <strong className="font-mono text-cs-text-primary">{match.revelMedian !== null && match.revelMedian !== undefined ? match.revelMedian.toFixed(3) : "N/A"}</strong>
                                </div>
                                <div className="flex justify-between opacity-85">
                                  <span>Range [Min - Max]:</span>
                                  <strong className="font-mono text-cs-text-primary">
                                    {match.revelMin !== null && match.revelMin !== undefined ? match.revelMin.toFixed(2) : "N/A"} - {match.revelMax !== null && match.revelMax !== undefined ? match.revelMax.toFixed(2) : "N/A"}
                                  </strong>
                                </div>
                                <div className="flex justify-between opacity-70 text-[10px]">
                                  <span>Substitutions Evaluated:</span>
                                  <span className="font-mono text-cs-text-muted">{match.revelCount || 0} variants</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-cs-text-muted italic text-[10px]">No surrounding landscape data available</div>
                            )}
                          </div>

                          {/* AlphaMissense stats block */}
                          <div className="flex flex-col gap-1 text-[11px] flex-1">
                            <span className="font-bold text-cs-accent-clay uppercase tracking-wider text-[9px] font-mono">AlphaMissense Distribution</span>
                            {amTarget !== null && (
                              <div className="flex justify-between">
                                <span>Target Mutation ({mutation.wt}→{mutation.mut}):</span>
                                <strong className="text-cs-accent-clay font-mono">{amTarget.toFixed(3)}</strong>
                              </div>
                            )}
                            {match ? (
                              <>
                                <div className="flex justify-between opacity-85">
                                  <span>Positional Mean:</span>
                                  <strong className="font-mono text-cs-text-primary">{match.amMean !== null && match.amMean !== undefined ? match.amMean.toFixed(3) : "N/A"}</strong>
                                </div>
                                <div className="flex justify-between opacity-85">
                                  <span>Positional Median:</span>
                                  <strong className="font-mono text-cs-text-primary">{match.amMedian !== null && match.amMedian !== undefined ? match.amMedian.toFixed(3) : "N/A"}</strong>
                                </div>
                                <div className="flex justify-between opacity-85">
                                  <span>Range [Min - Max]:</span>
                                  <strong className="font-mono text-cs-text-primary">
                                    {match.amMin !== null && match.amMin !== undefined ? match.amMin.toFixed(2) : "N/A"} - {match.amMax !== null && match.amMax !== undefined ? match.amMax.toFixed(2) : "N/A"}
                                  </strong>
                                </div>
                                <div className="flex justify-between opacity-70 text-[10px]">
                                  <span>Substitutions Evaluated:</span>
                                  <span className="font-mono text-cs-text-muted">{match.amCount || 0} variants</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-cs-text-muted italic text-[10px]">No surrounding landscape data available</div>
                            )}
                          </div>
                        </div>

                        {match && (match.revelCount > 0 || match.amCount > 0) && (
                          <div className="pt-2">
                            <details className="group cursor-pointer">
                              <summary className="text-[10px] font-mono uppercase select-none hover:opacity-85 transition-opacity outline-none text-cs-text-muted">
                                ▶ Inspect Raw dbNSFP Positional Entries ({Math.max(match.revelCount || 0, match.amCount || 0)} variants)
                              </summary>
                              <div className="mt-2 p-2 rounded-lg border text-[9.5px] font-mono space-y-1.5 transition-all bg-cs-bg-subtle border-cs-border text-cs-text-primary">
                                <div className="grid grid-cols-3 font-bold opacity-80 border-b border-cs-border-subtle pb-1">
                                  <span>Predictor</span>
                                  <span>Positional Range</span>
                                  <span>Evaluated Counts</span>
                                </div>
                                <div className="grid grid-cols-3 py-0.5 border-b border-cs-border-subtle/50">
                                  <span className="text-cs-accent-clay font-bold">REVEL</span>
                                  <span>{match.revelMean?.toFixed(3)} ({match.revelMin?.toFixed(2)} - {match.revelMax?.toFixed(2)})</span>
                                  <span>{match.revelCount || 0} transcript variants</span>
                                </div>
                                <div className="grid grid-cols-3 py-0.5">
                                  <span className="text-cs-accent-clay font-bold">AlphaMissense</span>
                                  <span>{match.amMean?.toFixed(3)} ({match.amMin?.toFixed(2)} - {match.amMax?.toFixed(2)})</span>
                                  <span>{match.amCount || 0} transcript variants</span>
                                </div>
                              </div>
                            </details>
                          </div>
                        )}

                        <div className="flex gap-4 text-[10.5px] font-mono py-1 opacity-90 border-t border-dashed border-cs-border-subtle pt-2 mt-1">
                          {gerp !== null && (
                            <span>GERP++: <strong className="text-cs-good">{gerp.toFixed(2)}</strong></span>
                          )}
                          {phylop !== null && (
                            <span>PhyloP: <strong className="text-cs-good">{phylop.toFixed(2)}</strong></span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
              <p className="text-[11px] leading-relaxed max-w-3xl border-t pt-2 mt-1 transition-colors text-cs-text-secondary border-cs-border-subtle">
                {getBiophysicalConsequence(activeResOpt.symbol, activeResOpt.pos)}
              </p>

              {/* 3D Local Microenvironment (5 Nearest spatial neighbors) */}
              {(() => {
                const presetResidues = getNearestResidues(uniprotId, variant, activeResOpt.pos);
                const cacheKey = `${uniprotId}_${activeResOpt.pos}`;
                const computedResidues = computedResiduesCache?.[cacheKey] || [];
                const nearestResidues = presetResidues.length > 0 ? presetResidues : computedResidues;

                if (nearestResidues.length === 0) return null;

                return (
                  <div className="mt-3 pt-3 border-t border-cs-border-subtle">
                    <span className="text-[10px] font-bold font-mono text-cs-accent-clay uppercase tracking-wider flex items-center gap-1.5 mb-2">
                      <Atom className="w-3.5 h-3.5" />
                      <span>Local 3D Microenvironment (5 Spatial Neighbors)</span>
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 w-full">
                      {nearestResidues.map((res, index) => (
                        <div 
                          key={index} 
                          className="p-2 rounded-lg border border-cs-border-subtle text-[10px] flex flex-col gap-1 transition-all bg-cs-surface text-cs-text-secondary hover:bg-cs-surface-2"
                        >
                          <div className="flex items-center justify-between gap-1 flex-wrap">
                            <span className="font-mono font-bold text-[10.5px] text-cs-accent-clay">{res.name}</span>
                            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20">
                              {res.distance}
                            </span>
                          </div>
                          <span className="text-[8.5px] font-medium opacity-85 truncate" title={res.properties}>
                            {res.properties}
                          </span>
                          <p className="text-[8.5px] leading-snug opacity-75 truncate" title={res.role}>
                            {res.role}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="mt-4 pt-3 border-t border-cs-border-subtle">
                <span className="text-[10px] font-bold font-mono text-cs-accent-clay uppercase tracking-wider block mb-3">
                  Substitutional Class Impact Profiles
                </span>
                <div className="flex flex-col gap-2 w-full">
                  {getSubstitutionalConsequences(activeResOpt.symbol, activeResOpt.pos).map((g, idx) => {
                    const isTestedClass = activeResOpt.pos === mutationIndex && g.name.startsWith(getSubstitutionGroup(mutation.mut));
                    const borderClass = isTestedClass 
                     ? "border-cs-accent-clay bg-cs-accent-clay/10 shadow-inner" 
                     : "border-cs-border-subtle bg-cs-surface-2";

                    return (
                      <div 
                        key={idx} 
                        className={`p-3 rounded-lg border text-[11px] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all ${borderClass}`}
                      >
                        <div className="flex flex-col gap-1 min-w-[150px] flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs tracking-wide">
                              {g.name.replace(/\(([^)]+)\)/, (match: string, p1: string) => {
                                const titleCodes = p1.split(",").map((s: string) => AMINO_ACID_1_TO_3_TITLE[s.trim()] || s.trim());
                                return `(${titleCodes.join(", ")})`;
                              })}
                            </span>
                            <span className={`font-mono text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              g.severity === "high" ? "bg-cs-danger-soft text-cs-danger border border-cs-danger/20" :
                              g.severity === "medium" ? "bg-cs-warn-soft text-cs-warn border border-cs-warn/20" :
                              "bg-cs-good-soft text-cs-good border border-cs-good/20"
                            }`}>
                              {g.severity}
                            </span>
                            {isTestedClass && (
                              <span className="text-[8px] font-mono font-bold bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20 px-1.5 py-0.5 rounded shadow-sm animate-pulse">
                                Tested Swap
                              </span>
                            )}
                          </div>
                          <p className="text-[10.5px] leading-snug mt-0.5 text-cs-text-muted">
                            {g.consequence}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-cs-text-secondary">
              Wild-type <strong className="text-cs-good font-semibold">{AMINO_ACID_MAP_FULL[mutation.wt]?.name || mutation.wt}</strong> at index #{mutationIndex} substituted with <strong className="text-cs-danger font-semibold">{AMINO_ACID_MAP_FULL[mutation.mut]?.name || mutation.mut}</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
