import React from "react";
import { Target, Cpu, Camera, ChevronUp, Download, ClipboardCopy, Maximize2, Minimize2, HelpCircle } from "lucide-react";
import { MolstarToolbarProps } from "./types";
import { useVariantAnalysisActions } from "../../context/VariantAnalysisContext";

export const MolstarToolbar: React.FC<MolstarToolbarProps> = ({
  comparePdbData,
  customPdbData,
  mutantStatus,
  active3dModelTab = "alphafold2",
  viewMode,
  activePdbId,
  customPdbUrl,
  pdbSource,
  pdbId,
  uniprotId,
  gene,
  residueIndex,
  focusOnPocketResidue,
  viewerStyle,
  setViewerStyle,
  templateSource,
  plddtFilter,
  setPlddtFilter,
  isPocketPanelOpen,
  setIsPocketPanelOpen,
  setShowPocket,
  captureMenuOpen,
  setCaptureMenuOpen,
  captureMenuRef,
  handleDownloadCapture,
  handleCopyCapture,
  isFullscreen,
  handleToggleFullscreen
}) => {
  const analysisActions = useVariantAnalysisActions();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b z-20 shrink-0 pointer-events-auto shadow-xs" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      {/* Left: Unified Protein Source Badge, Gene, Residue, Focus Button */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
        <span 
          className="flex items-center gap-1.5 px-3 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px]"
          style={{
            background: "var(--cs-surface-2)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--cs-accent)" }} />
          <span>
            {comparePdbData ? (
              "Superimposed (Wild-Type vs Mutant)"
            ) : viewMode === "mutant" ? (
              mutantStatus === "success" ? "FoldX Mutant Model" : "Mutant Model"
            ) : active3dModelTab === "esm3" ? (
              "ESM3 Structure Model"
            ) : customPdbUrl ? (
              `RCSB PDB: ${activePdbId || customPdbUrl.split("/").pop()?.replace(".pdb", "").replace(".ent", "").toUpperCase() || "Template"}`
            ) : activePdbId ? (
              `RCSB PDB: ${activePdbId.toUpperCase()}`
            ) : templateSource === "experimental" && pdbId ? (
              `RCSB PDB: ${pdbId.toUpperCase()}`
            ) : uniprotId ? (
              `AlphaFold DB (AF-${uniprotId}-F1 • Full-Length)`
            ) : (
              "No Structure Loaded"
            )}
          </span>
        </span>

        {gene && (
          <span 
            className="px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px]"
            style={{
              background: "var(--cs-surface-2)",
              borderColor: "var(--cs-border-subtle)",
              color: "var(--cs-text-secondary)"
            }}
          >
            Gene: <strong style={{ color: "var(--cs-text-primary)" }}>{gene}</strong>
          </span>
        )}

        {residueIndex !== null && (
          <span 
            className="px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px]"
            style={{
              background: "var(--cs-accent-mag-soft)",
              borderColor: "var(--cs-accent-mag)",
              color: "var(--cs-accent-mag)"
            }}
          >
            Residue: <strong>#{residueIndex}</strong>
          </span>
        )}

        {residueIndex !== null && (
          <button
            type="button"
            onClick={() => focusOnPocketResidue(residueIndex)}
            className="px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[10px] font-mono font-semibold transition-all hover:bg-[var(--cs-bg-subtle)] cursor-pointer"
            style={{
              background: "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-accent)"
            }}
            title={`Focus 3D camera on residue ${residueIndex}`}
          >
            <Target className="w-3 h-3" style={{ color: "var(--cs-accent)" }} />
            <span>Focus Residue #{residueIndex}</span>
          </button>
        )}
      </div>

      {/* Right: Actions (Representation, pLDDT Filter, Pocket Finder, Capture View, Fullscreen) */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Representation Style Selector */}
        <div className="flex items-center gap-1.5 pl-2 border-l" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline" style={{ color: "var(--cs-text-muted)" }}>
            Representation:
          </span>
          <select
            value={viewerStyle}
            onChange={(e) => setViewerStyle(e.target.value as "confidence" | "biomolecular" | "esm3-allosteric" | "displacement")}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold outline-none cursor-pointer border transition-colors"
            style={{
              background: "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
          >
            <option value="confidence">pLDDT / B-factor</option>
            <option value="biomolecular">Cartoon & Sticks</option>
            <option value="esm3-allosteric">ESM3 Allosteric Heatmap</option>
            <option value="displacement">Backbone Displacement Heatmap</option>
          </select>
        </div>

        {/* pLDDT Filter Selector */}
        {templateSource !== "experimental" && (
          <div className="flex items-center gap-1.5 pl-2 border-l" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline" style={{ color: "var(--cs-text-muted)" }}>
              pLDDT Filter:
            </span>
            <select
              value={plddtFilter}
              onChange={(e) => setPlddtFilter(e.target.value as "none" | "30" | "50" | "70")}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold outline-none cursor-pointer border transition-colors"
              style={{
                background: "var(--cs-surface)",
                borderColor: "var(--cs-border)",
                color: "var(--cs-text-primary)"
              }}
            >
              <option value="none">Show All</option>
              <option value="50">pLDDT &ge; 50</option>
              <option value="70">pLDDT &ge; 70</option>
            </select>
          </div>
        )}

        {/* Pocket Finder Action Button */}
        <button
          type="button"
          onClick={() => {
            const next = !isPocketPanelOpen;
            setIsPocketPanelOpen(next);
            setShowPocket(next);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none"
          style={{
            background: isPocketPanelOpen ? "var(--cs-accent-clay)" : "var(--cs-surface)",
            borderColor: isPocketPanelOpen ? "var(--cs-accent-clay)" : "var(--cs-border)",
            color: isPocketPanelOpen ? "#ffffff" : "var(--cs-text-primary)"
          }}
          title="Run binding pocket analysis"
        >
          <Cpu className={`w-4 h-4 ${isPocketPanelOpen ? "text-white animate-pulse" : ""}`} style={{ color: isPocketPanelOpen ? "#ffffff" : "var(--cs-accent)" }} />
          <span>Pocket Finder</span>
        </button>

        {/* Capture View Dropdown Button */}
        <div className="relative flex" ref={captureMenuRef}>
          <button
            type="button"
            onClick={() => setCaptureMenuOpen(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none"
            style={{
              background: captureMenuOpen ? "var(--cs-bg-subtle)" : "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
            title="Capture view options"
          >
            <Camera className="w-4 h-4" style={{ color: "var(--cs-accent)" }} />
            <span>Capture View</span>
            <ChevronUp className={`w-3.5 h-3.5 transition-transform ${captureMenuOpen ? "" : "rotate-180"}`} />
          </button>

          {captureMenuOpen && (
            <div 
              className="absolute top-full right-0 mt-1.5 w-44 rounded-xl border overflow-hidden z-30 animate-slide-in font-mono shadow-lg"
              style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
            >
              <button
                type="button"
                onClick={handleDownloadCapture}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-colors cursor-pointer text-left hover:bg-[var(--cs-bg-subtle)]"
                style={{ color: "var(--cs-text-primary)" }}
              >
                <Download className="w-4 h-4 shrink-0" style={{ color: "var(--cs-accent)" }} />
                <span>Download PNG</span>
              </button>
              <div className="h-px" style={{ background: "var(--cs-border-subtle)" }} />
              <button
                type="button"
                onClick={handleCopyCapture}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-colors cursor-pointer text-left hover:bg-[var(--cs-bg-subtle)]"
                style={{ color: "var(--cs-text-primary)" }}
              >
                <ClipboardCopy className="w-4 h-4 shrink-0" style={{ color: "var(--cs-accent)" }} />
                <span>Copy Image</span>
              </button>
            </div>
          )}
        </div>

        {/* 3D Inspection Guide Button */}
        <button
          type="button"
          onClick={() => analysisActions.setIsHowToInspectOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none hover:bg-[var(--cs-bg-subtle)]"
          style={{
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
          title="Open 3D Inspection Guide & Help"
        >
          <HelpCircle className="w-4 h-4" style={{ color: "var(--cs-accent)" }} />
          <span>3D Guide</span>
        </button>

        {/* Fullscreen Button */}
        <button
          type="button"
          onClick={handleToggleFullscreen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none hover:bg-[var(--cs-bg-subtle)]"
          style={{
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
