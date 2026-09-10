import React from "react";
import { 
  Layers, 
  Activity, 
  Sparkles, 
  Target, 
  Info, 
  ShieldAlert, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Scale
} from "lucide-react";
import { AnalysisResult, PdbHomolog } from "../../types";

import type { StructuralMetrics } from "../../types";

interface StructureInspectorProps {
  analysisResult: AnalysisResult | null;
  viewMode: "wildtype" | "mutant" | "superimposed";
  setViewMode?: (mode: "wildtype" | "mutant" | "superimposed") => void;
  isFolding: boolean;
  foldingStatus: "failed" | "success" | "unavailable" | null;
  foldingDdG: number | null;
  homologs?: PdbHomolog[];
  isHomologsLoading?: boolean;
  customPdbUrl?: string | null;
  setCustomPdbUrl?: (url: string | null) => void;
  active3dModelTab?: "alphafold2" | "esm3";
  metrics?: StructuralMetrics | null;
  comparePdbData?: string | null;
  hasMutantModel?: boolean;
  bFactorMetadata?: { source: string; details?: string } | null;
}

export const StructureInspector: React.FC<StructureInspectorProps> = ({
  analysisResult,
  viewMode,
  setViewMode,
  isFolding,
  foldingStatus,
  foldingDdG,
  homologs = [],
  isHomologsLoading = false,
  customPdbUrl = null,
  setCustomPdbUrl,
  active3dModelTab = "alphafold2",
  metrics,
  comparePdbData,
  hasMutantModel = false,
  bFactorMetadata
}) => {
  const metadata = analysisResult?.metadata;
  const wtRes = metadata?.wildType || "WT";
  const mutRes = metadata?.mutant || "MUT";
  const residueIdx = metadata?.residueIndex || 0;

  const isEsmMode = active3dModelTab === "esm3";
  const hasCompareData = Boolean(comparePdbData || viewMode === "mutant");

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Active Coordinate Model Switcher ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
          Active Coordinate Model
        </span>

        <div className="grid grid-cols-3 gap-1.5">
          {/* Wild-Type */}
          <button
            type="button"
            onClick={() => setViewMode?.("wildtype")}
            className={`p-2 rounded-lg border text-[10.5px] font-semibold text-center transition-all cursor-pointer ${
              viewMode === "wildtype"
                ? "border-cs-border bg-cs-surface-2 text-cs-text-primary shadow-xs"
                : "border-transparent text-cs-text-secondary hover:bg-cs-bg-subtle"
            }`}
            title="View baseline reference wild-type coordinates"
          >
            <div className="flex flex-col items-center justify-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${viewMode === "wildtype" ? "bg-emerald-500" : "bg-cs-text-muted"}`} />
              <span className="truncate">{isEsmMode ? "WT (ESM)" : "WT (AF2)"}</span>
            </div>
          </button>

          {/* Mutant */}
          <button
            type="button"
            disabled={isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")}
            onClick={() => setViewMode?.("mutant")}
            className={`p-2 rounded-lg border text-[10.5px] font-semibold text-center transition-all cursor-pointer ${
              viewMode === "mutant"
                ? "border-cs-border bg-cs-surface-2 text-cs-text-primary shadow-xs"
                : "border-transparent text-cs-text-secondary hover:bg-cs-bg-subtle"
            } ${(isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")) ? "opacity-40 cursor-not-allowed" : ""}`}
            title={
              isEsmMode 
                ? "View de novo predicted mutant coordinates" 
                : isFolding 
                  ? "Repacking mutant side-chains..." 
                  : foldingStatus !== "success" 
                    ? "FoldX simulation in flight or not computed." 
                    : "View FoldX repacked mutant coordinates"
            }
          >
            <div className="flex flex-col items-center justify-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${viewMode === "mutant" ? "bg-amber-500" : "bg-cs-text-muted"}`} />
              <span className="truncate">{isFolding ? "Repacking..." : (isEsmMode ? "Mutant (ESM)" : "Mutant (FoldX)")}</span>
            </div>
          </button>

          {/* Superposition */}
          <button
            type="button"
            disabled={isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")}
            onClick={() => setViewMode?.("superimposed")}
            className={`p-2 rounded-lg border text-[10.5px] font-semibold text-center transition-all cursor-pointer ${
              viewMode === "superimposed"
                ? "border-cs-border bg-cs-surface-2 text-cs-text-primary shadow-xs"
                : "border-transparent text-cs-text-secondary hover:bg-cs-bg-subtle"
            } ${(isEsmMode ? !hasMutantModel : (isFolding || foldingStatus !== "success")) ? "opacity-40 cursor-not-allowed" : ""}`}
            title="Superimpose mutant on reference wild-type coordinates with dual side-chain stick visualization"
          >
            <div className="flex flex-col items-center justify-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${viewMode === "superimposed" ? "bg-pink-500" : "bg-cs-text-muted"}`} />
              <span className="truncate">Superposition</span>
            </div>
          </button>
        </div>

        {/* FoldX Repacking Details Card (Replacing floating FoldX banner dropdown) */}
        {!isEsmMode && foldingStatus === "success" && (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-cs-text-primary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                FoldX Model Energetics
              </span>
              {foldingDdG !== null && (
                <span className="text-[10.5px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  ΔΔG: {foldingDdG > 0 ? `+${foldingDdG.toFixed(2)}` : foldingDdG.toFixed(2)} kcal/mol
                </span>
              )}
            </div>
            <p className="text-[10px] text-cs-text-secondary font-sans leading-snug">
              Biophysically repacked coordinates reflecting local FoldX empirical force-field energy minimization.
            </p>
          </div>
        )}
      </div>

      {/* ── 2. WT vs MT Overlay Metrics (Relocated from Canvas to Inspector) ── */}
      {metrics && hasCompareData && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-pink-600 dark:text-pink-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              WT vs MT Overlay Metrics
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-pink-500/10 text-pink-600 border border-pink-500/20 font-semibold">
              Superposition
            </span>
          </div>

          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 font-mono text-[10.5px] space-y-2">
            <div className="flex items-center justify-between border-b border-cs-border-subtle pb-1.5">
              <span className="text-cs-text-secondary">Local Window RMSD (Cα):</span>
              <span className="font-bold text-pink-600 dark:text-pink-400">
                {metrics.localWindowRmsd !== undefined && metrics.localWindowRmsd !== null ? `${metrics.localWindowRmsd.toFixed(3)} Å` : "N/A"}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-cs-border-subtle pb-1.5">
              <span className="text-cs-text-secondary">Global Cα RMSD:</span>
              <span className="font-bold text-cs-text-primary">
                {metrics.globalRmsd !== undefined && metrics.globalRmsd !== null ? `${metrics.globalRmsd.toFixed(3)} Å` : "N/A"}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-cs-border-subtle pb-1.5">
              <span className="text-cs-text-secondary">Dihedral χ1 Deviation:</span>
              <span className="font-bold text-cs-text-primary">
                {metrics.chi1Deviation !== undefined && metrics.chi1Deviation !== null ? `${metrics.chi1Deviation.toFixed(1)}°` : "0.0°"}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-cs-border-subtle pb-1.5">
              <span className="text-cs-text-secondary">SASA Net Delta (WT → MT):</span>
              <span className="font-bold text-cs-text-primary">
                {metrics.sasaDiff?.delta !== undefined && metrics.sasaDiff?.delta !== null ? `${metrics.sasaDiff.delta.toFixed(1)} Å²` : "N/A"}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-cs-border-subtle pb-1.5">
              <span className="text-cs-text-secondary">Hydrogen-Bond Delta:</span>
              <span className="font-bold text-rose-500 font-mono">
                {metrics.hBondsDiff ? `-${metrics.hBondsDiff.lostCount} / +${metrics.hBondsDiff.gainedCount}` : "N/A"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-cs-text-secondary">Contact-Map Delta:</span>
              <span className="font-bold text-rose-500 font-mono">
                {metrics.contactsDiff ? `-${metrics.contactsDiff.lostCount} / +${metrics.contactsDiff.gainedCount}` : "N/A"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. Model Interpretation & Provenance Notices (Relocated from Canvas Top Banners) ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5 text-cs-accent-clay" />
          Model Provenance & Physics
        </span>

        {isEsmMode ? (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-primary space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold font-mono uppercase text-[10px] text-cs-text-primary">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              <span>ESMFold De Novo Structural Dynamics</span>
            </div>
            <p className="text-[10px] text-cs-text-secondary leading-snug font-sans">
              Single-sequence de novo models. For large multi-domain proteins (&gt;400 aa), elevated global Cα RMSD often reflects stochastic conformational sampling of flexible linkers rather than whole-domain denaturation.
            </p>
            <p className="text-[9.5px] text-cs-text-muted leading-snug font-sans">
              Tip: Local pocket alignment snaps structured domains (&lt;1.0 Å RMSD) to isolate active-site perturbations.
            </p>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-primary space-y-1">
            <div className="flex items-center gap-1.5 font-bold font-mono uppercase text-[10px] text-cs-text-primary">
              <Target className="w-3.5 h-3.5 text-emerald-500" />
              <span>FoldX Local Perturbation</span>
            </div>
            <p className="text-[10px] text-cs-text-secondary leading-snug font-sans">
              Rigid-backbone local comparison; displacement values are physically interpretable.
            </p>
          </div>
        )}

        {bFactorMetadata && (
          <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-primary space-y-1">
            <div className="flex items-center gap-1.5 font-bold font-mono uppercase text-[10px] text-amber-600 dark:text-amber-400">
              <Info className="w-3.5 h-3.5" />
              <span>B-Factor / pLDDT Notice</span>
            </div>
            <p className="text-[10px] text-cs-text-secondary leading-snug font-sans">
              {bFactorMetadata.source === "alphafold"
                ? "B-factors represent wild-type confidence (pLDDT) from AlphaFold DB, not physical temperature factors."
                : "B-factors represent wild-type experimental temperature factors from PDB."}
            </p>
          </div>
        )}
      </div>

      {/* ── 4. Experimental PDB Templates (Homologs) ── */}
      {setCustomPdbUrl && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
              PDB Experimental Templates
            </span>
            <span className="text-[9px] font-mono text-cs-text-muted">
              {homologs.length} structures
            </span>
          </div>

          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-0.5">
            {/* Default AlphaFold DB option */}
            <button
              type="button"
              onClick={() => setCustomPdbUrl(null)}
              className={`p-2 rounded-lg border text-[11px] transition-all flex items-center gap-2.5 w-full text-left cursor-pointer ${
                customPdbUrl === null 
                  ? "border-cs-border bg-cs-surface-2" 
                  : "border-transparent hover:bg-cs-bg-subtle"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${customPdbUrl === null ? "bg-emerald-500 animate-pulse" : "bg-cs-text-muted"}`} />
              <div className="flex flex-col text-left truncate w-full">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[11px] text-cs-text-primary">AlphaFold2 Model</span>
                  <span className="text-[9px] px-1 py-0.2 rounded font-mono bg-cs-surface border border-cs-border text-cs-text-muted">
                    Full-Length
                  </span>
                </div>
                <span className="text-[10px] text-cs-text-secondary truncate">
                  UniProt: {analysisResult?.metadata?.uniprotId || "Default"}
                </span>
              </div>
            </button>

            {/* Loading homologs */}
            {isHomologsLoading && (
              <div className="flex items-center gap-2 p-2 text-[10.5px] font-mono text-cs-text-muted">
                <span className="cs-spinner cs-spinner-sm shrink-0" />
                <span>Searching RCSB PDB for homologs...</span>
              </div>
            )}

            {/* Homolog hits */}
            {!isHomologsLoading && homologs.map((hom) => {
              const homUrl = `/api/v1/pdb/entry/${hom.pdbId}`;
              const isSelected = customPdbUrl === homUrl || customPdbUrl === `https://files.rcsb.org/download/${hom.pdbId}.pdb`;
              const identityVal = typeof hom.identity === "number" ? hom.identity : Math.round((hom.score || 0) * 100);
              const coverageVal = typeof hom.coverage === "number" ? hom.coverage : 80;
              const isCovered = hom.coversPosition ?? (
                residueIdx > 0 && hom.querySeqFrom !== undefined && hom.querySeqTo !== undefined
                  ? (residueIdx >= hom.querySeqFrom && residueIdx <= hom.querySeqTo)
                  : true
              );

              return (
                <button
                  key={hom.pdbId}
                  type="button"
                  onClick={() => setCustomPdbUrl(homUrl)}
                  title={`${hom.title}\n• Sequence Identity: ${identityVal}%\n• Alignment Coverage: ${coverageVal}%\n• Organism: ${hom.organism}\n• Aligned Region: ${hom.querySeqFrom ?? '?'}-${hom.querySeqTo ?? '?'}\n• Mutation Site Status: ${isCovered ? `In Range (covers pos ${residueIdx})` : `Out of Bounds (pos ${residueIdx} is outside ${hom.querySeqFrom}-${hom.querySeqTo})`}\n• Method: ${hom.method}${hom.resolution ? ` (${hom.resolution} Å)` : ''}`}
                  className={`p-2 rounded-lg border text-[11px] transition-all flex items-center gap-2 w-full text-left cursor-pointer ${
                    isSelected 
                      ? "border-cs-accent-clay bg-cs-surface-2 shadow-xs" 
                      : "border-cs-border-subtle hover:bg-cs-bg-subtle"
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSelected ? "var(--cs-accent-clay)" : (isCovered ? "#10b981" : "#f59e0b")
                    }}
                  />
                  <div className="flex flex-col text-left truncate w-full gap-0.5">
                    <div className="flex items-center justify-between gap-1 w-full">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono font-bold text-[11px] text-cs-text-primary">
                          {hom.pdbId}
                        </span>
                        {hom.querySeqFrom && hom.querySeqTo && (
                          <span className="text-[9px] font-mono text-cs-text-muted">
                            ({hom.querySeqFrom}–{hom.querySeqTo})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {residueIdx > 0 && (
                          isCovered ? (
                            <span className="text-[8.5px] px-1 py-0.2 rounded font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              In Range
                            </span>
                          ) : (
                            <span className="text-[8.5px] px-1 py-0.2 rounded font-mono font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              Out of Bounds
                            </span>
                          )
                        )}
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold bg-cs-surface border border-cs-border text-cs-text-secondary">
                          {identityVal}% ID
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[9.5px] truncate text-cs-text-secondary">
                      <span className="truncate italic">{hom.organism}</span>
                      {hom.resolution && (
                        <span className="font-mono text-[9px] shrink-0 ml-1 text-cs-text-muted">
                          {hom.resolution}Å
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {!isHomologsLoading && homologs.length === 0 && (
              <span className="text-[10px] p-2 italic font-mono text-cs-text-muted">
                No PDB homologs found (≥22% sequence identity)
              </span>
            )}
          </div>

          {/* Out of bounds active selection notice */}
          {customPdbUrl && (() => {
            const selectedHom = homologs.find(h => `/api/v1/pdb/entry/${h.pdbId}` === customPdbUrl || `https://files.rcsb.org/download/${h.pdbId}.pdb` === customPdbUrl);
            if (!selectedHom) return null;
            const isCovered = selectedHom.coversPosition ?? (
              residueIdx > 0 && selectedHom.querySeqFrom !== undefined && selectedHom.querySeqTo !== undefined
                ? (residueIdx >= selectedHom.querySeqFrom && residueIdx <= selectedHom.querySeqTo)
                : true
            );
            if (!isCovered && residueIdx > 0) {
              return (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-300 leading-snug">
                  <span className="font-semibold">Out of bounds template:</span> PDB {selectedHom.pdbId} covers residues {selectedHom.querySeqFrom ?? '?' }–{selectedHom.querySeqTo ?? '?'}. Mutation site (position {residueIdx}) is outside the aligned coordinates. Switch back to AlphaFold2 Model for full-length structural context.
                </div>
              );
            }
            if (selectedHom.coverage && selectedHom.coverage < 90) {
              return (
                <div className="p-2 rounded-lg bg-cs-surface-2 border border-cs-border-subtle text-[10px] text-cs-text-secondary leading-snug">
                  <span className="font-semibold text-cs-text-primary">Domain Construct:</span> PDB {selectedHom.pdbId} ({selectedHom.method}{selectedHom.resolution ? ` • ${selectedHom.resolution}Å` : ''}) covers {selectedHom.coverage}% of sequence{selectedHom.querySeqFrom && selectedHom.querySeqTo ? ` (${selectedHom.querySeqFrom}–${selectedHom.querySeqTo})` : ''}. Unmodelled domains are not present in this crystal construct.
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* ── 5. Mutated Residue Structural Neighborhood ── */}
      {residueIdx > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted">
            Target Residue Context
          </span>

          <div className="p-2.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-1.5">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-cs-text-secondary">Position:</span>
              <span className="font-mono font-bold text-cs-text-primary">Residue #{residueIdx}</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-cs-text-secondary">Mutation:</span>
              <span className="font-mono font-bold text-cs-accent-clay">{wtRes} → {mutRes}</span>
            </div>
            {analysisResult?.metadata?.pdbId && (
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-cs-text-secondary">AlphaFold ID:</span>
                <span className="font-mono text-[10px] text-cs-text-muted truncate max-w-[130px]">
                  {analysisResult.metadata.pdbId}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 6. ESM3 Constraints Warning ── */}
      {analysisResult?.metadata?.mutatedSequence && (
        <>
          {analysisResult.metadata.mutatedSequence.length > 768 ? (
            <div className="text-amber-600 dark:text-amber-400 p-2.5 rounded-lg border bg-cs-surface-2 border-cs-border-subtle text-[10.5px] leading-relaxed">
              ⚠️ <strong>ESM3 Size Limit:</strong> Protein sequence ({analysisResult.metadata.mutatedSequence.length} aa) exceeds Biohub 768 aa limit. Using AlphaFold2 coordinates.
            </div>
          ) : analysisResult.metadata.mutatedSequence.length > 400 ? (
            <div className="text-amber-600 dark:text-amber-400 p-2.5 rounded-lg border bg-cs-surface-2 border-cs-border-subtle text-[10.5px] leading-relaxed">
              ⚠️ <strong>ESM3 Token Notice:</strong> Protein exceeds public 400 aa threshold. Biohub API token configured in Settings is used for folding.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default React.memo(StructureInspector);
