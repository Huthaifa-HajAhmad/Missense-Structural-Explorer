import React from "react";
import { Sparkles, Target, Info, Activity, X, ChevronUp, ChevronDown } from "lucide-react";
import { MolstarInfoOverlayProps } from "./types";

export const MolstarInfoOverlay: React.FC<MolstarInfoOverlayProps> = ({
  comparePdbData,
  active3dModelTab = "alphafold2",
  customPdbData,
  bFactorMetadata,
  viewerStyle,
  isEsmFolding,
  loading,
  loadError,
  esmFoldPdb,
  esmFoldingError,
  uniprotId,
  pdbSource,
  pdbId,
  customPdbUrl,
  mutantStatus,
  mutantDdG,
  energyUnit,
  foldXPosition,
  isFoldXDragging,
  handleFoldXMouseDown,
  foldxBannerCollapsed,
  setFoldxBannerCollapsed,
  isPocketPanelOpen,
  setIsPocketPanelOpen,
  pocketPosition,
  handlePocketMouseDown,
  residueIndex,
  isPocketLoading,
  pocketError,
  computedPocket,
  showPocket,
  setShowPocket,
  disruptionWarning,
  isAlertClosed,
  setIsAlertClosed,
  alertPosition,
  isDragging,
  handleMouseDown,
  metrics,
  formatDdG
}) => {
  return (
    <>
      {/* 1. TOP PROVENANCE BADGES & WARNING CARDS */}
      {comparePdbData && (
        active3dModelTab === "esm3" ? (
          <div className="flex items-start gap-3 p-3 rounded-xl border text-purple-900 dark:text-purple-200" style={{ background: "var(--cs-surface-2)", borderColor: "rgba(168, 85, 247, 0.2)" }}>
            <Sparkles className="w-5 h-5 mt-0.5 text-purple-500 shrink-0" />
            <div>
              <h4 className="text-xs font-bold font-mono tracking-wide uppercase">ESMFold exploratory comparison</h4>
              <p className="text-[11px] leading-relaxed opacity-85 mt-0.5">
                Single-sequence de novo models; displacement may include prediction variance and should be treated as hypothesis-generating only.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-3 rounded-xl border text-emerald-900 dark:text-emerald-200" style={{ background: "var(--cs-surface-2)", borderColor: "rgba(16, 185, 129, 0.2)" }}>
            <Target className="w-5 h-5 mt-0.5 text-emerald-500 shrink-0" />
            <div>
              <h4 className="text-xs font-bold font-mono tracking-wide uppercase">FoldX local perturbation</h4>
              <p className="text-[11px] leading-relaxed opacity-85 mt-0.5">
                Rigid-backbone local comparison; displacement values are physically interpretable.
              </p>
            </div>
          </div>
        )
      )}

      {!comparePdbData && (customPdbData || active3dModelTab === "esm3") && bFactorMetadata && (viewerStyle !== "displacement") && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl border text-amber-900 dark:text-amber-200" style={{ background: "var(--cs-surface-2)", borderColor: "rgba(245, 158, 11, 0.2)" }}>
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">B-Factor Provenance Warning:</span>{" "}
            {bFactorMetadata.source === "alphafold" ? (
              "B-factors in this mutant model represent wild-type confidence (pLDDT) inherited from the AlphaFold DB. They do NOT reflect physical temperature factors or local displacements caused by the mutation."
            ) : bFactorMetadata.source === "experimental" ? (
              "B-factors in this mutant model represent wild-type experimental temperature factors inherited from the PDB. They do NOT reflect simulated mutant coordinates deviations."
            ) : (
              "B-factors in this model are inherited directly from the wild-type template structure."
            )}
          </div>
        </div>
      )}

      {/* FoldX / SCWRL4 result — collapsible draggable badge */}
      {customPdbData && mutantStatus && (
        <div
          className={`absolute z-20 max-w-[300px] pointer-events-auto select-none transition-shadow rounded-xl border border-l-4 border-l-indigo-500 overflow-hidden backdrop-blur-md ${
            isFoldXDragging ? "shadow-2xl" : "shadow-md"
          }`}
          onMouseDown={handleFoldXMouseDown}
          style={{
            top: `calc(0.75rem + ${foldXPosition.y}px)`,
            left: `calc(0.75rem + ${foldXPosition.x}px)`,
            cursor: isFoldXDragging ? 'grabbing' : 'grab',
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
        >
          {mutantStatus === "success" ? (
            <div>
              <button
                type="button"
                onClick={() => setFoldxBannerCollapsed(p => !p)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-[var(--cs-bg-subtle)]"
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-indigo-500 shrink-0 animate-pulse" />
                  <span className="text-[10px] font-bold font-mono uppercase tracking-wider">
                    FoldX Model
                  </span>
                  {mutantDdG !== null && mutantDdG !== undefined && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-accent)" }}>
                      ΔΔG: {mutantDdG.toFixed(2)} kcal/mol
                    </span>
                  )}
                </div>
                {foldxBannerCollapsed
                  ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                  : <ChevronUp className="w-3 h-3 text-slate-400 shrink-0" />}
              </button>
              {!foldxBannerCollapsed && (
                <div className="px-3 pb-2.5 pt-0 text-[10px] font-mono border-t" style={{ borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-secondary)" }}>
                  <p className="leading-relaxed mt-1.5">
                    <strong>Biophysically Repacked:</strong> Side-chain coordinates reflect local FoldX force-field energy minimisation.
                    {mutantDdG !== null && mutantDdG !== undefined
                      ? ` Predicted ΔΔG: ${formatDdG(mutantDdG, energyUnit)}.`
                      : " ΔΔG unavailable."}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Slide-out Automated Pocket Control Panel */}
      {isPocketPanelOpen && (
        <div
          id="pocket-finder-suite-panel"
          className="absolute top-14 right-3 max-h-[calc(100%-80px)] h-fit w-[310px] z-20 backdrop-blur-md rounded-xl border flex flex-col overflow-hidden shadow-2xl animate-fade-in pointer-events-auto transition-all"
          style={{
            transform: `translate(${pocketPosition.x}px, ${pocketPosition.y}px)`,
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between p-3.5 border-b cursor-grab active:cursor-grabbing select-none"
            style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}
            onMouseDown={handlePocketMouseDown}
          >
            <div className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 animate-pulse" style={{ color: "var(--cs-accent)" }} />
              <div>
                <h3 className="text-[11.5px] font-bold uppercase tracking-wider font-mono" style={{ color: "var(--cs-text-primary)" }}>Active Site Cavity Solver</h3>
                <p className="text-[8.5px] font-mono" style={{ color: "var(--cs-text-muted)" }}>3D Spatial Proximity & Pocket Analysis</p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => setIsPocketPanelOpen(false)}
              className="p-1 rounded-md transition-colors hover:bg-[var(--cs-bg-subtle)] cursor-pointer"
              style={{ color: "var(--cs-text-secondary)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 custom-scrollbar">
            {residueIndex === null ? (
              <div className="text-center py-6">
                <p className="text-xs font-mono" style={{ color: "var(--cs-text-muted)" }}>Select a residue to run coordinate calculations.</p>
              </div>
            ) : isPocketLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent)", borderTopColor: "transparent" }}></div>
                <p className="text-[9px] font-mono animate-pulse text-center uppercase tracking-wider px-2" style={{ color: "var(--cs-text-muted)" }}>
                  Analyzing Local Spatial Proximities Server-side...
                </p>
              </div>
            ) : pocketError ? (
              <div className="text-center py-12 px-3 font-mono text-xs border rounded-lg" style={{ borderColor: "var(--cs-border)", background: "var(--cs-surface-2)", color: "var(--cs-text-danger)" }}>
                <p className="font-bold mb-1">Server Calculation Error</p>
                <p className="text-[10px] opacity-80">{pocketError}</p>
              </div>
            ) : computedPocket ? (
              <>
                {/* Pocket Stats Bento Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-center font-mono">
                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Pocket Volume</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: "var(--cs-accent)" }}>{computedPocket.pocketVolume} Å³</strong>
                  </div>
                  
                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Affinity Prob.</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: "var(--cs-accent)" }}>{computedPocket.pocketScore}%</strong>
                  </div>

                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Centroid Dist.</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: computedPocket.pocketDistance !== null && computedPocket.pocketDistance < 10 ? "var(--cs-text-danger)" : "var(--cs-text-primary)" }}>
                      {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                        ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                        : "N/A"}
                    </strong>
                  </div>

                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Lining residues</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: "var(--cs-text-success)" }}>{computedPocket.pocketResidues?.length || 0}</strong>
                  </div>
                </div>

                {/* Predicted Substrate */}
                <div className="p-2.5 rounded-lg border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                  <span className="block text-[9.5px] uppercase font-bold font-mono" style={{ color: "var(--cs-text-muted)" }}>
                    Likely Target Co-Factor
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-accent)" }} />
                    <span className="text-[11.5px] font-bold truncate" style={{ color: "var(--cs-text-primary)" }}>{computedPocket.likelyCofactor}</span>
                  </div>
                </div>

                {/* Highlight Full Pocket Action */}
                <div className="flex items-center justify-between border-t border-b py-2.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <span className="text-[11px] font-bold font-mono uppercase" style={{ color: "var(--cs-text-muted)" }}>3D Highlights</span>
                  
                  <button
                    type="button"
                    onClick={() => setShowPocket(p => !p)}
                    className="px-3 py-1 rounded text-[10px] font-mono font-bold transition-all select-none cursor-pointer"
                    style={{
                      background: showPocket ? "var(--cs-accent)" : "var(--cs-surface-2)",
                      borderColor: "var(--cs-border)",
                      color: showPocket ? "#ffffff" : "var(--cs-text-primary)"
                    }}
                  >
                    {showPocket ? " Cavity ON" : " Cavity OFF"}
                  </button>
                </div>

                {/* Info redirect block */}
                <div className="p-3 rounded-lg border flex flex-col gap-1.5 leading-relaxed text-[11px]" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
                  <p>
                    💡 Detailed spatial lining residue metrics, distance calculations, and curated functional site annotations are available under the <strong>Function</strong> tab in the evidence dashboard.
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <p className="text-xs font-mono" style={{ color: "var(--cs-text-muted)" }}>No pocket coordinate results loaded.</p>
              </div>
            )}
          </div>
          
          {/* Footer panel caption */}
          <div className="p-2 border-t text-center text-[7.5px] font-mono uppercase select-none" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)", color: "var(--cs-text-muted)" }}>
            Spatial Proximity Threshold &lt; 10.0 Å
          </div>
        </div>
      )}

      {/* Disruption Warning Overlay Badge - Draggable and Closeable */}
      {disruptionWarning && !isAlertClosed && (
        <div
          id="disruption-warning-badge"
          onMouseDown={handleMouseDown}
          style={{
            transform: `translate(${alertPosition.x}px, ${alertPosition.y}px)`,
            cursor: isDragging ? 'grabbing' : 'grab',
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
          className="absolute top-3 right-12 max-w-[280px] backdrop-blur-md p-3.5 rounded-xl border border-l-4 border-l-rose-500 z-20 shadow-xl transition-shadow flex flex-col gap-1.5 animate-slide-in pointer-events-auto select-none"
        >
          <div className="flex items-center justify-between gap-4 border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
              <span className="text-[9px] font-extrabold uppercase tracking-widest font-mono" style={{ color: "var(--cs-text-danger)" }}>
                Biophysical Insight Alert
              </span>
            </div>
            
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsAlertClosed(true);
              }}
              className="p-1 rounded-md transition-colors hover:bg-[var(--cs-bg-subtle)] cursor-pointer"
              style={{ color: "var(--cs-text-secondary)" }}
              title="Dismiss alert"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          
          <h4 className="text-xs font-bold leading-tight flex items-center gap-1">
            {disruptionWarning.title}
          </h4>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
            {disruptionWarning.description}
          </p>
          
          <div className="text-[8px] font-mono text-right mt-0.5 select-none" style={{ color: "var(--cs-text-muted)" }}>
            ⌥ Click & drag to move
          </div>
        </div>
      )}

      {comparePdbData && metrics && (
        <div
          className="absolute z-20 w-[300px] pointer-events-auto shadow-md rounded-xl border border-l-4 border-l-pink-500 overflow-hidden backdrop-blur-md animate-slide-in"
          style={{
            bottom: "1rem",
            right: "1rem",
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-pink-500 shrink-0" />
              <span className="text-[10px] font-bold font-mono uppercase tracking-wider">
                WT vs MT Overlay Metrics
              </span>
            </div>
          </div>
          
          <div className="p-3 text-[10px] font-mono flex flex-col gap-2.5 max-h-[250px] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span className="text-slate-400">Local Window RMSD (Cα):</span>
              <span className="font-bold text-[11px] text-pink-500">
                {metrics.localWindowRmsd !== undefined && metrics.localWindowRmsd !== null ? `${metrics.localWindowRmsd.toFixed(3)} Å` : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span className="text-slate-400">Global Cα RMSD:</span>
              <span className="font-bold">
                {metrics.globalRmsd !== undefined && metrics.globalRmsd !== null ? `${metrics.globalRmsd.toFixed(3)} Å` : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span className="text-slate-400">Dihedral χ1 Deviation:</span>
              <span className="font-bold">
                {metrics.chi1Deviation !== undefined && metrics.chi1Deviation !== null ? `${metrics.chi1Deviation.toFixed(1)}°` : "0.0°"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span className="text-slate-400">SASA Net Delta (WT → MT):</span>
              <span className="font-bold">
                {metrics.sasaDiff?.delta !== undefined && metrics.sasaDiff?.delta !== null ? `${metrics.sasaDiff.delta.toFixed(1)} Å²` : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span className="text-slate-400">Hydrogen-Bond Delta:</span>
              <span className="font-bold text-red-500">
                {metrics.hBondsDiff ? `-${metrics.hBondsDiff.lostCount} / +${metrics.hBondsDiff.gainedCount}` : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Contact-Map Delta:</span>
              <span className="font-bold text-red-500">
                {metrics.contactsDiff ? `-${metrics.contactsDiff.lostCount} / +${metrics.contactsDiff.gainedCount}` : "N/A"}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
