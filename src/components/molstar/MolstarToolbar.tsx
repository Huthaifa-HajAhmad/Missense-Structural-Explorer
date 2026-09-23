import React from "react";
import { Target, Cpu, Camera, ChevronUp, Download, ClipboardCopy, Maximize2, Minimize2, HelpCircle } from "lucide-react";
import { MolstarToolbarProps } from "./types";
import { useVariantAnalysisActions } from "../../context/VariantAnalysisContext";

export const MolstarToolbar: React.FC<MolstarToolbarProps> = ({
  comparePdbData,
  customPdbData,
  mutantStatus,
  active3dModelTab = "alphafold2",
  structureProvenance,
  viewMode,
  alignmentScope = "local",
  onAlignmentScopeChange,
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
  const { setIsHowToInspectOpen } = useVariantAnalysisActions();

  const isEsmMode = active3dModelTab === "esmfold2" || active3dModelTab === "esm3";
  const hasCustomExp = Boolean(customPdbUrl);
  const isExp = hasCustomExp || (!isEsmMode && (structureProvenance?.source === "experimental" || templateSource === "experimental"));
  const isHomolog = !hasCustomExp && structureProvenance?.source === "homolog";
  const isAf = !hasCustomExp && !isEsmMode && (structureProvenance?.source === "alphafold" || Boolean(uniprotId));

  let dotColor = "var(--cs-accent)";
  let dotGlow = "none";
  let sourceLabel = "No Structure Loaded";
  let sourceTooltip = "3D Structural Coordinate Model";

  if (comparePdbData) {
    dotColor = "#06b6d4"; // Cyan
    sourceLabel = "Superimposed (Wild-Type vs Mutant)";
    sourceTooltip = "Structural superposition of Wild-Type and Mutant models";
  } else if (viewMode === "mutant") {
    dotColor = mutantStatus === "success" ? "#10b981" : "#f59e0b";
    sourceLabel = mutantStatus === "success" ? "FoldX Mutant Model" : "Mutant Model";
    sourceTooltip = "FoldX thermodynamic mutant repacked model";
  } else if (isEsmMode) {
    dotColor = "#a855f7"; // Purple
    dotGlow = "0 0 6px #a855f7";
    sourceLabel = "ESMFold-2 Model (De Novo)";
    sourceTooltip = "De novo structural prediction via ESMFold-2 (Lin et al. 2023 / JapanFold)";
  } else if (isExp) {
    dotColor = "#3b82f6"; // Blue
    dotGlow = "0 0 6px #3b82f6";
    const selectedPdbId = customPdbUrl ? customPdbUrl.split("/").pop()?.replace(".pdb", "").replace(".ent", "").toUpperCase() : null;
    const resolvedId = selectedPdbId || structureProvenance?.pdbId || activePdbId || pdbId || "PDB";
    const resString = structureProvenance?.resolution ? ` • ${structureProvenance.resolution}Å` : "";
    sourceLabel = `RCSB PDB: ${resolvedId.toUpperCase()}${resString}`;
    sourceTooltip = `Experimental Structure (PDB ${resolvedId}${structureProvenance?.method ? ` • ${structureProvenance.method}` : ""}${structureProvenance?.resolution ? ` • ${structureProvenance.resolution}Å` : ""})`;
  } else if (isHomolog) {
    dotColor = "#f59e0b"; // Amber
    const resolvedId = structureProvenance?.pdbId || "Homolog";
    const idString = structureProvenance?.identity ? ` • ${structureProvenance.identity}% ID` : "";
    sourceLabel = `Homolog: ${resolvedId.toUpperCase()}${idString}`;
    sourceTooltip = `Experimental Homolog Template (${resolvedId})`;
  } else if (isAf) {
    dotColor = "#10b981"; // Emerald Green
    dotGlow = "0 0 6px #10b981";
    const ver = structureProvenance?.afdbVersion ? ` ${structureProvenance.afdbVersion}` : "";
    sourceLabel = `AlphaFold DB (AF-${uniprotId}-F1 • Full-Length${ver})`;
    sourceTooltip = "Canonical Full-Length AlphaFold Structure Model from AlphaFold DB";
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b z-20 shrink-0 pointer-events-auto shadow-xs" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      {/* Left: Unified Protein Source Badge, Gene, Residue, Focus Button */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
        <span 
          className="flex items-center gap-1.5 px-3 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px] transition-all"
          style={{
            background: "var(--cs-surface-2)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
          title={sourceTooltip}
        >
          <span 
            className="w-2 h-2 rounded-full shrink-0 transition-all" 
            style={{ backgroundColor: dotColor, boxShadow: dotGlow }} 
          />
          <span>{sourceLabel}</span>
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
            className="px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[10px] font-mono font-semibold transition-all hover:bg-[var(--cs-bg-subtle)] active:scale-[0.96] cursor-pointer"
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
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold outline-none cursor-pointer border transition-all hover:border-[var(--cs-accent)] focus:ring-2 focus:ring-[var(--cs-accent)]/20"
            style={{
              background: "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
          >
            <option value="confidence">pLDDT / B-factor</option>
            <option value="biomolecular">Cartoon & Sticks</option>
            <option value="esm3-allosteric">ESMFold-2 / ESM3 Allosteric Heatmap</option>
            {Boolean(comparePdbData) && <option value="displacement">Backbone Displacement Heatmap</option>}
          </select>
        </div>

        {/* Alignment Scope Toggle in Comparison View */}
        {comparePdbData && onAlignmentScopeChange && (
          <div className="flex items-center gap-1.5 pl-2 border-l" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline" style={{ color: "var(--cs-text-muted)" }}>
              Alignment:
            </span>
            <div className="inline-flex rounded-lg p-0.5 border text-[10px] font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
              <button
                type="button"
                onClick={() => onAlignmentScopeChange("local")}
                className={`px-2 py-0.5 rounded transition-all active:scale-[0.96] cursor-pointer ${
                  alignmentScope !== "global"
                    ? "bg-[var(--cs-accent-clay)] text-white shadow-xs font-bold"
                    : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
                }`}
                title="Align Kabsch frame on ±15 residue mutation pocket (prevents flexible terminal linkers from skewing alignment)"
              >
                Local Pocket
              </button>
              <button
                type="button"
                onClick={() => onAlignmentScopeChange("global")}
                className={`px-2 py-0.5 rounded transition-all active:scale-[0.96] cursor-pointer ${
                  alignmentScope === "global"
                    ? "bg-[var(--cs-accent-clay)] text-white shadow-xs font-bold"
                    : "text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)]"
                }`}
                title="Align Kabsch frame over entire protein chain (measures whole-chain domain reorientation)"
              >
                Global
              </button>
            </div>
          </div>
        )}

        {/* pLDDT Filter Selector */}
        {templateSource !== "experimental" && (
          <div className="flex items-center gap-1.5 pl-2 border-l" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline" style={{ color: "var(--cs-text-muted)" }}>
              pLDDT Filter:
            </span>
            <select
              value={plddtFilter}
              onChange={(e) => setPlddtFilter(e.target.value as "none" | "30" | "50" | "70")}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold outline-none cursor-pointer border transition-all hover:border-[var(--cs-accent)] focus:ring-2 focus:ring-[var(--cs-accent)]/20"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all active:scale-[0.96] cursor-pointer select-none"
          style={{
            background: isPocketPanelOpen ? "var(--cs-accent-clay)" : "var(--cs-surface)",
            borderColor: isPocketPanelOpen ? "var(--cs-accent-clay)" : "var(--cs-border)",
            color: isPocketPanelOpen ? "#ffffff" : "var(--cs-text-primary)"
          }}
          title="Run binding pocket analysis"
        >
          <Cpu className="w-4 h-4" style={{ color: isPocketPanelOpen ? "#ffffff" : "var(--cs-accent)" }} />
          <span>Pocket Finder</span>
        </button>

        {/* Capture View Dropdown Button */}
        <div className="relative flex" ref={captureMenuRef}>
          <button
            type="button"
            onClick={() => setCaptureMenuOpen(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all active:scale-[0.96] cursor-pointer select-none"
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
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-colors cursor-pointer text-left hover:bg-[var(--cs-bg-subtle)] active:scale-[0.96]"
                style={{ color: "var(--cs-text-primary)" }}
              >
                <Download className="w-4 h-4 shrink-0" style={{ color: "var(--cs-accent)" }} />
                <span>Download PNG</span>
              </button>
              <div className="h-px" style={{ background: "var(--cs-border-subtle)" }} />
              <button
                type="button"
                onClick={handleCopyCapture}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-colors cursor-pointer text-left hover:bg-[var(--cs-bg-subtle)] active:scale-[0.96]"
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
          onClick={() => setIsHowToInspectOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all active:scale-[0.96] cursor-pointer select-none hover:bg-[var(--cs-bg-subtle)]"
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
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all active:scale-[0.96] cursor-pointer select-none hover:bg-[var(--cs-bg-subtle)]"
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
