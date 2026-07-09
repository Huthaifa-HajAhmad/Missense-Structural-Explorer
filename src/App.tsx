import { useState, useEffect } from "react";
import { 
  Dna, 
  Search, 
  Sparkles, 
  Database, 
  RotateCcw, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Copy, 
  ExternalLink, 
  ShieldAlert, 
  Lightbulb, 
  Layers, 
  Compass, 
  Activity,
  Heart,
  BookOpen,
  MapPin,
  Atom,
  ChevronDown,
  ChevronUp,
  Settings,
  History,
  Trash2,
  Sun,
  Moon,
  Info,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { VARIANT_PRESETS, FALLBACK_ANALYSES, FALLBACK_INSIGHTS, getNearestResidues } from "./data";
import { AnalysisState, VariantPreset, NearestResidue, UserSettings } from "./types";
import MolstarViewer from "./components/MolstarViewer";
import SequenceVisualizer from "./components/SequenceVisualizer";
import Header from "./components/Header";
import VariantSearchPanel from "./components/VariantSearchPanel";
import ClinicalInsightsCard from "./components/ClinicalInsightsCard";
import EvidenceDashboardCard from "./components/EvidenceDashboardCard";
import SettingsModal from "./components/SettingsModal";

import useVariantAnalysis, {
  AMINO_ACID_NAMES_MAP,
  AMINO_ACID_PROPERTIES,
  parseMutationResidues,
  getAlternativeVariants
} from "./useVariantAnalysis";

export default function App() {
  const { state, actions } = useVariantAnalysis();
  const [isLowDisruptionWarningCollapsed, setIsLowDisruptionWarningCollapsed] = useState<boolean>(false);
  const {
    theme,
    isDark,
    gene,
    variant,
    uniprotId,
    selectedResidueIndex,
    hoveredResidueIndex,
    searchVal,
    customGene,
    customVariant,
    customUniprot,
    showCustomInputs,
    copied,
    customPdbUrl,
    viewMode,
    mutantPdb,
    foldedResidueIndex,
    isFolding,
    foldingError,
    foldingStatus,
    foldingDdG,
    foldingEnergetics,
    dynamut2Status,
    ddmutStatus,
    structuralDiff,
    pdbText,
    computedPocket,
    isPocketLoading,
    pocketError,
    isBiophysicalLoading,
    isClinicalLoading,
    compareMode,
    compareVariant,
    compareMutantPdb,
    compareFoldedResidueIndex,
    isFoldingCompare,
    foldingCompareError,
    compareFoldingStatus,
    compareFoldingDdG,
    comparisonLayout,
    showPolarContacts,
    settings,
    isSettingsOpen,
    isHowToInspectOpen,
    isLegendOpen,
    analysisState,
    loadingStep,
    history,
    classRoot,
    classHeader,
    classHeaderTitle,
    classHeaderSub,
    classCard,
    classCardHeader,
    classCardTitle,
    classCardSubText,
    classTextMute,
    classTextBody,
    classTextBright,
    classBorderSec,
    classBorderCardSep,
    classInput,
    classInputLabel,
    classBadgeAccent,
    classSubCard,
    disruptionWarningVariant1,
    disruptionWarningVariant2,
    computedResiduesCache,
    disruptionPredictor,
    triageOverride
  } = state;

  const {
    setTheme,
    toggleTheme,
    setGene,
    setVariant,
    setUniprotId,
    setSelectedResidueIndex,
    setHoveredResidueIndex,
    setSearchVal,
    setCustomGene,
    setCustomVariant,
    setCustomUniprot,
    setShowCustomInputs,
    setCopied,
    setCustomPdbUrl,
    setViewMode,
    setTriageOverride,
    setMutantPdb,
    setFoldedResidueIndex,
    setIsFolding,
    setFoldingError,
    setCompareMode,
    setCompareVariant,
    setCompareMutantPdb,
    setCompareFoldedResidueIndex,
    setIsFoldingCompare,
    setFoldingCompareError,
    setComparisonLayout,
    setShowPolarContacts,
    setSettings,
    setIsSettingsOpen,
    setIsHowToInspectOpen,
    setIsLegendOpen,
    setAnalysisState,
    setLoadingStep,
    setHistory,
    addToHistory,
    clearHistory,
    handleSelectHistoryItem,
    updateSetting,
    resetSettingsToDefault,
    formatEnergyString,
    handleSelectPreset,
    executeAnalysis,
    fetchMutantFold,
    fetchCompareMutantFold,
    handleSearchSubmit,
    handleCopyReport,
    fetchNearestResidues,
    resetViewerState,
    setPdbText
  } = actions;

  return (
    <div className={`min-h-screen flex flex-col font-sans select-none antialiased transition-colors duration-200 ${classRoot}`}>
      {/* Clinician Top Header */}
      <Header
        isDark={isDark}
        toggleTheme={toggleTheme}
        setIsSettingsOpen={setIsSettingsOpen}
        classHeader={classHeader}
        classHeaderTitle={classHeaderTitle}
        classHeaderSub={classHeaderSub}
        classBadgeAccent={classBadgeAccent}
      />

      {/* ── Claude Science Gene/Protein Stats Bar ── */}
      {(gene || analysisState.result) && (
        <div className={`border-b px-5 py-3 flex flex-wrap items-center gap-4 transition-colors ${
          isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-white border-[#DDD6ED]"
        }`}>
          {/* Gene name + protein info */}
          <div className="flex items-baseline gap-3 min-w-0">
            <h2 className={`text-2xl font-bold tracking-tight leading-none ${isDark ? "text-[#F9F8F6]" : "text-[#1A1523]"}`}>
              {gene || "—"}
            </h2>
            {analysisState.result?.predictorData && (
              <span className="text-[13px] font-normal leading-none" style={{ color: "#8E82A0" }}>
                {uniprotId && <span className="font-mono mr-2" style={{ color: "#C46849" }}>{uniprotId}</span>}
                {analysisState.result?.predictorData?.proteinName || ""}
              </span>
            )}
            {variant && (
              <span className="text-[13px] font-mono font-semibold" style={{ color: "#D946AA" }}>
                {variant}
              </span>
            )}
          </div>

          {/* Stat pills — using actual available data */}
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {analysisState.result?.predictorData?.amPathogenicity != null && (
              <div className="cs-stat-pill">
                <span className="cs-stat-pill-value">{Number(analysisState.result.predictorData.amPathogenicity).toFixed(3)}</span>
                <span className="cs-stat-pill-label">AM pathogenicity</span>
              </div>
            )}
            {analysisState.result?.predictorData?.caddPhred != null && (
              <div className="cs-stat-pill">
                <span className="cs-stat-pill-value">{Number(analysisState.result.predictorData.caddPhred).toFixed(1)}</span>
                <span className="cs-stat-pill-label">CADD Phred</span>
              </div>
            )}
            {analysisState.result?.gnomadConstraint?.oe_mis != null && (
              <div className="cs-stat-pill">
                <span className="cs-stat-pill-value">{Number(analysisState.result.gnomadConstraint.oe_mis).toFixed(2)}</span>
                <span className="cs-stat-pill-label">o/e missense</span>
              </div>
            )}
            {analysisState.result?.clinvar?.classification && (
              <div className="cs-stat-pill">
                <span
                  className="cs-stat-pill-value text-[12px]"
                  style={{
                    color: analysisState.result.clinvar.classification.toLowerCase().includes("pathogenic")
                      ? "#D946AA"
                      : analysisState.result.clinvar.classification.toLowerCase().includes("benign")
                        ? "#16A34A"
                        : "#D97706"
                  }}
                >
                  {analysisState.result.clinvar.classification}
                </span>
                <span className="cs-stat-pill-label">ClinVar</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Grid Workspace — Claude Science layout */}
      <main className="flex-1 w-full max-w-full p-4 lg:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN: Controls & Insights (spanning 5/12 width) */}
        <section className={`lg:col-span-5 flex flex-col gap-4 w-full transition-all duration-300 ${settings.bentoLeftControls ? "lg:order-1" : "lg:order-2"}`}>
          
          {/* SEARCH & CONTROL PANEL */}
          <VariantSearchPanel
            isDark={isDark}
            classCard={classCard}
            classCardHeader={classCardHeader}
            classCardTitle={classCardTitle}
            classInput={classInput}
            classBorderSec={classBorderSec}
            customGene={customGene}
            setCustomGene={setCustomGene}
            customVariant={customVariant}
            setCustomVariant={setCustomVariant}
            customUniprot={customUniprot}
            setCustomUniprot={setCustomUniprot}
            analysisState={analysisState}
            handleSearchSubmit={handleSearchSubmit}
            gene={gene}
            variant={variant}
            uniprotId={uniprotId}
            history={history}
            clearHistory={clearHistory}
            handleSelectHistoryItem={handleSelectHistoryItem}
          />

          {/* UNIFIED EVIDENCE DASHBOARD — directly below variant card */}
          <EvidenceDashboardCard
            isDark={isDark}
            classCard={classCard}
            classCardHeader={classCardHeader}
            classCardTitle={classCardTitle}
            classBorderSec={classBorderSec}
            classTextBody={classTextBody}
            classTextMute={classTextMute}
            analysisState={analysisState}
            foldingDdG={foldingDdG}
            foldingStatus={foldingStatus}
            foldingEnergetics={foldingEnergetics}
            dynamut2Status={dynamut2Status}
            ddmutStatus={ddmutStatus}
            computedPocket={computedPocket}
            isPocketLoading={isPocketLoading}
            pocketError={pocketError}
            disruptionPredictor={disruptionPredictor}
            isFolding={isFolding}
            foldingError={foldingError}
            structuralDiff={structuralDiff}
          />

          {/* CLINICAL INSIGHTS CARD */}
          <ClinicalInsightsCard
            isDark={isDark}
            classCard={classCard}
            classCardHeader={classCardHeader}
            classCardTitle={classCardTitle}
            analysisState={analysisState}
            handleCopyReport={handleCopyReport}
            copied={copied}
            gene={gene}
            variant={variant}
            uniprotId={uniprotId}
            loadingStep={loadingStep}
            formatEnergyString={formatEnergyString}
            selectedResidueIndex={selectedResidueIndex}
            settings={settings}
            classTextBody={classTextBody}
            classTextMute={classTextMute}
            classBorderSec={classBorderSec}
            computedResiduesCache={computedResiduesCache}
            isBiophysicalLoading={isBiophysicalLoading}
            isClinicalLoading={isClinicalLoading}
          />
        </section>

        {/* RIGHT COLUMN: 3D Molstar viewer (spanning 7/12 width) */}
        <section className={`lg:col-span-7 flex flex-col gap-4 w-full transition-all duration-300 ${settings.bentoLeftControls ? "lg:order-2" : "lg:order-1"}`}>
          <div className={`${classCard} p-4 transition-all`}>
            
            {/* Viewer header — Claude Science style */}
            <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b ${classBorderSec}`}>
              <div>
                <h3 className={`text-[13px] font-semibold flex items-center gap-2 ${isDark ? "text-[#F0EBFA]" : "text-[#1A1523]"}`}>
                  <Activity className="w-3.5 h-3.5" style={{ color: "#C46849" }} />
                  3D Molecular Workspace
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: "#8E82A0" }}>
                  Drag to rotate · Scroll to zoom · Click atom to select
                </p>
              </div>

              {/* pLDDT legend — Claude Science style */}
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium" style={{ color: "#8E82A0" }}>pLDDT:</span>
                  <div className="cs-plddt-bar w-14">
                    <div className="cs-plddt-vlow flex-1" title="Very Low <50" />
                    <div className="cs-plddt-low flex-1" title="Low 50-70" />
                    <div className="cs-plddt-high flex-1" title="High 70-90" />
                    <div className="cs-plddt-vhigh flex-1" title="Very High ≥90" />
                  </div>
                </div>
                {viewMode !== "wildtype" && (
                  <span className="text-[9px] font-medium" style={{ color: "#D97706" }}>⚠ Inherited pLDDT</span>
                )}
              </div>
            </div>

            {/* Structural State Controls — Claude Science segment style */}
            <div className={`flex flex-wrap items-center justify-between gap-2 py-2.5 border-b mb-3 ${classBorderSec}`}>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-medium" style={{ color: "#8E82A0" }}>Structure:</span>
                <div className="cs-seg-control">
                  <button
                    type="button"
                    onClick={() => setViewMode("wildtype")}
                    className={`cs-seg-btn ${viewMode === "wildtype" ? "active" : ""}`}
                  >
                    Wild-Type
                  </button>
                  {(disruptionPredictor?.level !== "low" || triageOverride) && (
                    <button
                      type="button"
                      onClick={() => setViewMode("mutant")}
                      className={`cs-seg-btn ${viewMode === "mutant" ? "active" : ""}`}
                    >
                      Mutant
                    </button>
                  )}
                </div>

                {viewMode === "mutant" && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !compareMode;
                      setCompareMode(next);
                      if (next) {
                        setCompareVariant("wildtype");
                        setCompareMutantPdb(pdbText);
                      }
                    }}
                    className={`cs-btn-ghost text-[11px] ${
                      compareMode ? "border-[#D946AA] text-[#D946AA] bg-[#FBE8F6]" : ""
                    }`}
                  >
                    ⇄ Compare {compareMode ? "ON" : "OFF"}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsHowToInspectOpen(true)}
                  className="cs-btn-ghost text-[11px] flex items-center gap-1.5"
                >
                  <BookOpen className="w-3.5 h-3.5 text-[#C46849]" />
                  <span>Guide</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLegendOpen(true)}
                  className="cs-btn-ghost text-[11px] flex items-center gap-1.5"
                >
                  <Layers className="w-3.5 h-3.5 text-[#C46849]" />
                  <span>Legend</span>
                </button>
              </div>
            </div>

            {((disruptionPredictor?.level === "low" && !triageOverride) || 
              (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70)) && (
              <div className={`rounded-xl border flex flex-col transition-all w-full my-3 ${
                isDark 
                  ? "bg-amber-500/5 border-amber-500/20 text-slate-305" 
                  : "bg-amber-50/40 border-amber-200 text-slate-700"
              }`}>
                {/* Header */}
                <button
                  type="button"
                  onClick={() => setIsLowDisruptionWarningCollapsed(!isLowDisruptionWarningCollapsed)}
                  className="w-full flex items-center justify-between p-3.5 text-left focus:outline-none cursor-pointer"
                  id="structural-analysis-alerts-toggle"
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <h4 className={`font-bold font-mono text-[11px] uppercase tracking-wider ${isDark ? "text-amber-305" : "text-amber-800"}`}>
                      Structural Analysis Alerts
                    </h4>
                    <span className={`text-[10px] font-sans ml-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      ({(disruptionPredictor?.level === "low" && !triageOverride) && (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70) 
                        ? "2 alerts active" 
                        : "1 alert active"})
                    </span>
                  </div>

                  {disruptionPredictor?.level === "low" && !triageOverride && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTriageOverride(true);
                        setViewMode("mutant");
                      }}
                      className="mr-3 bg-[#C46849] hover:bg-[#A95738] text-white font-mono font-bold text-[8.5px] uppercase tracking-wider px-2 py-0.5 rounded transition active:scale-95 cursor-pointer shrink-0"
                    >
                      View simulated mutant anyway
                    </button>
                  )}

                  {isLowDisruptionWarningCollapsed ? (
                    <ChevronDown className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-slate-555"}`} />
                  ) : (
                    <ChevronUp className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-slate-555"}`} />
                  )}
                </button>

                {/* Content */}
                {!isLowDisruptionWarningCollapsed && (
                  <div className="px-3.5 pb-3.5 text-xs select-none animate-slide-in flex flex-col gap-3.5">
                    
                    {/* Alert 1: Low Disruption */}
                    {disruptionPredictor?.level === "low" && !triageOverride && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="font-bold font-mono text-[10.5px] uppercase tracking-wider text-[#C46849]">
                            Low Structural Disruption Predicted
                          </h5>
                          {disruptionPredictor.reason && (
                            <span className="text-[9.5px] font-sans font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(196,104,73,0.12)", color: "var(--cs-accent-clay)" }}>
                              {disruptionPredictor.reason.replace(/^Fallback:\s*/i, "")}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2 leading-relaxed text-slate-700 dark:text-slate-350">
                          <p className="opacity-75 text-[10.5px] font-sans">
                            Because FoldX operates on a <strong>rigid-backbone approximation</strong>, wild-type and mutant backbones remain identical. 3D comparison is disabled by default to prevent displaying misleadingly identical structures.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Divider line if both alerts are active */}
                    {(disruptionPredictor?.level === "low" && !triageOverride) && 
                     (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70) && (
                      <div className="border-t border-slate-200 dark:border-slate-800/80" />
                    )}

                    {/* Alert 2: Low Confidence */}
                    {disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70 && (
                      <div className="flex flex-col gap-2">
                        <div>
                          <h5 className={`font-bold font-mono text-[10.5px] uppercase tracking-wider ${isDark ? "text-amber-400" : "text-amber-850"}`}>
                            Low-Confidence Structure Alert (pLDDT: {disruptionPredictor.plddt.toFixed(1)})
                          </h5>
                        </div>
                        <div className="leading-relaxed text-slate-700 dark:text-slate-350">
                          <p>
                            The local template structure at this residue has a low confidence score (pLDDT &lt; 70). Predictions generated from rigid-backbone models or biophysical force fields are highly speculative in disordered or low-confidence regions.
                          </p>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            )}

            {/* Compare controls row — compact and inline */}
            {viewMode === "mutant" && compareMode && (
              <div className={`p-2 rounded-lg border flex flex-wrap items-center gap-3 mb-3 text-xs transition-all ${
                isDark ? "bg-slate-900/25 border-slate-800" : "bg-slate-50 border-slate-200 shadow-sm"
              }`}>
                {/* Variant selection */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">Variant 2:</span>
                  <select
                    value={compareVariant}
                    onChange={(e) => {
                      const selectedVal = e.target.value;
                      setCompareVariant(selectedVal);
                      if (selectedVal === "wildtype") {
                        setCompareMutantPdb(pdbText);
                      } else if (selectedVal !== "custom") {
                        fetchCompareMutantFold(gene, selectedVal, uniprotId);
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded border focus:outline-none cursor-pointer ${classInput}`}
                  >
                    <option value="wildtype">Wild-Type (Template)</option>
                    {(() => {
                      const dynamicAlts = (analysisState.result?.metadata as any)?.alternativeVariants || getAlternativeVariants(gene);
                      return dynamicAlts.map((alt: string) => (
                        <option key={alt} value={alt}>{alt}</option>
                      ));
                    })()}
                    <option value="custom">Custom...</option>
                  </select>
                </div>

                {/* Custom variant field */}
                {compareVariant === "custom" && (
                  <input
                    type="text"
                    placeholder="e.g. p.Gly300Ser"
                    className={`px-2 py-1 text-xs rounded border focus:outline-none w-28 ${classInput}`}
                    onBlur={(e) => {
                      if (e.target.value) {
                        let val = e.target.value.trim();
                        if (!val.startsWith("p.")) val = "p." + val;
                        setCompareVariant(val);
                      }
                    }}
                  />
                )}

                {/* Layout selection */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400">Layout:</span>
                  <div className="flex items-center p-0.5 rounded border bg-slate-950/20 border-slate-800">
                    <button
                      type="button"
                      onClick={() => setComparisonLayout("superimposed")}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                        comparisonLayout === "superimposed"
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-450 hover:text-slate-200"
                      }`}
                    >
                      Superimposed
                    </button>
                    <button
                      type="button"
                      onClick={() => setComparisonLayout("side-by-side")}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                        comparisonLayout === "side-by-side"
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-450 hover:text-slate-200"
                      }`}
                    >
                      Side-by-Side
                    </button>
                  </div>
                </div>

                {/* Simulation button */}
                <button
                  type="button"
                  onClick={() => {
                    const actualVal = compareVariant === "custom" ? "p.Gly300Ser" : compareVariant;
                    fetchCompareMutantFold(gene, actualVal, uniprotId);
                  }}
                  disabled={isFoldingCompare}
                  className={`ml-auto px-2.5 py-1 rounded text-xs font-bold font-mono transition-all border shadow-sm cursor-pointer ${
                    isFoldingCompare
                      ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
                      : "bg-pink-600 hover:bg-pink-500 text-white border-pink-700"
                  }`}
                >
                  {isFoldingCompare ? "Folding..." : "Fold Variant 2"}
                </button>

                {isFoldingCompare && (
                  <div className="w-full flex items-center gap-2 text-[10px] font-mono text-purple-400 animate-pulse mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping"></span>
                    <span>Simulating biophysical side-chain mutations for {compareVariant}...</span>
                  </div>
                )}

                {foldingCompareError && (
                  <div className="w-full text-[10px] font-mono text-rose-500 mt-1">
                    <span>Failed: {foldingCompareError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Custom overlays for active folding or structure display */}
            {viewMode === "mutant" && isFolding && (
              <div className={`relative w-full h-[650px] rounded-xl overflow-hidden flex flex-col items-center justify-center p-6 border transition-all ${
                isDark 
                  ? "bg-[#1E1629] border-[#362B4A]" 
                  : "bg-[#F7F4FC] border-[#DDD6ED]"
              }`}>
                <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "#C46849", borderTopColor: "transparent" }}></div>
                <p className="text-sm font-semibold animate-pulse" style={{ color: "#C46849" }}>
                  Folding Mutant Protein Structure…
                </p>
                <p className="text-[12px] mt-2 text-center max-w-sm" style={{ color: "#8E82A0" }}>
                  Simulating side-chain biophysics at position #{selectedResidueIndex || "408"}. This can take several seconds…
                </p>
              </div>
            )}

            {viewMode === "mutant" && foldingError && (
              <div className={`relative w-full h-[650px] rounded-xl overflow-hidden flex flex-col items-center justify-center p-6 text-center border transition-all ${
                isDark 
                  ? "bg-[#1E1629] border-[#362B4A]" 
                  : "bg-[#FEF2F2] border-[#FECACA]"
              }`}>
                <AlertTriangle className="w-10 h-10 mb-3" style={{ color: "#DC2626" }} />
                <p className="font-semibold text-[15px] mb-2" style={{ color: isDark ? "#F0EBFA" : "#1A1523" }}>FoldX Biophysical Simulation Failed</p>
                <p className="text-[12px] max-w-md mb-4" style={{ color: "#8E82A0" }}>{foldingError}</p>
                <div className="flex items-center gap-3">
                  <button 
                    type="button"
                    onClick={() => fetchMutantFold(gene, variant, uniprotId)}
                    className="bg-[#C46849] hover:bg-[#A95738] text-white font-mono font-bold text-xs uppercase px-3 py-1.5 rounded transition active:scale-95 cursor-pointer"
                  >
                    Retry Folding
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setViewMode("wildtype");
                      setFoldingError(null);
                    }}
                    className="border font-mono font-bold text-xs uppercase px-3 py-1.5 rounded transition active:scale-95 cursor-pointer"
                    style={{ borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)", background: "var(--cs-surface)" }}
                  >
                    Show Wild-Type Structure
                  </button>
                </div>
              </div>
            )}



            {/* Render viewer when not loading or errored */}
            {!(viewMode === "mutant" && (isFolding || foldingError)) && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${viewMode}_${compareMode}_${comparisonLayout}`}
                  initial={{ opacity: 0, scale: 0.99, y: 3 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.99, y: -3 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="w-full"
                >
                  {compareMode && comparisonLayout === "side-by-side" && compareMutantPdb ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {/* Left Viewport: Variant 1 */}
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[10px] font-bold text-amber-500 font-mono px-1 flex items-center justify-between uppercase tracking-wider">
                          <span>Variant 1: {variant}</span>
                          <span className="text-[9px] text-slate-400 opacity-80 lowercase font-normal">Primary Model</span>
                        </div>
                        <MolstarViewer 
                          uniprotId={uniprotId} 
                          residueIndex={foldedResidueIndex} 
                          gene={gene} 
                          customPdbUrl={customPdbUrl || undefined}
                          customPdbData={mutantPdb || undefined}
                          showPolarContacts={showPolarContacts}
                          theme={theme}
                          onResidueHover={setHoveredResidueIndex}
                          onResidueClick={setFoldedResidueIndex}
                          disruptionWarning={disruptionWarningVariant1}
                          residueColorHex={parseInt(settings.residueColor.replace("#", "0x"), 16) || 0xF97316}
                          cameraDuration={settings.cameraDuration}
                          autoZoomOnSelect={settings.autoZoomOnSelect}
                          neonHighContrast={settings.neonHighContrast}
                          mutantStatus={foldingStatus}
                          mutantDdG={foldingDdG}
                          variant={variant}
                          energyUnit={settings.energyUnit}
                          fetchNearestResidues={fetchNearestResidues}
                          onPdbTextLoaded={setPdbText}
                          computedPocket={computedPocket}
                          isPocketLoading={isPocketLoading}
                          pocketError={pocketError}
                          pdbId={analysisState.result?.metadata?.pdbId}
                          pdbSource={analysisState.result?.metadata?.pdbSource}
                        />
                      </div>
                      
                      {/* Right Viewport: Variant 2 */}
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[10px] font-bold text-pink-500 font-mono px-1 flex items-center justify-between uppercase tracking-wider">
                          <span>Variant 2: {compareVariant === "wildtype" ? "Wild-Type (Template)" : compareVariant}</span>
                          <span className="text-[9px] text-slate-400 opacity-80 lowercase font-normal">Comparison Model</span>
                        </div>
                        {isFoldingCompare ? (
                          <div className={`relative w-full h-[650px] rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-6 border transition-all ${
                            isDark 
                              ? "bg-slate-900 border-slate-800 text-white" 
                              : "bg-slate-50 border-slate-200 text-slate-900"
                          }`}>
                            <div className="w-10 h-10 border-3 border-pink-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                            <p className="text-pink-500 font-mono text-xs uppercase tracking-wider animate-pulse">Folding Variant 2 structure...</p>
                          </div>
                        ) : foldingCompareError ? (
                          <div className={`relative w-full h-[650px] rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-6 text-center border transition-all ${
                            isDark ? "bg-slate-900 border-slate-800 text-rose-455" : "bg-rose-50 border-rose-200"
                          }`}>
                            <p className="text-xs font-semibold mb-2 text-rose-500">Simulating Variant 2 Failed</p>
                            <p className="text-[11px] mb-3 opacity-80 max-w-xs">{foldingCompareError}</p>
                            <button
                              type="button"
                              onClick={() => fetchCompareMutantFold(gene, compareVariant, uniprotId)}
                              className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-[10px] px-3 py-1.5 rounded"
                            >
                              Retry Simulation
                            </button>
                          </div>
                        ) : (
                          <MolstarViewer 
                            uniprotId={uniprotId} 
                            residueIndex={compareFoldedResidueIndex} 
                            gene={gene} 
                            customPdbUrl={customPdbUrl || undefined}
                            customPdbData={compareMutantPdb || undefined}
                            onResidueHover={setHoveredResidueIndex}
                            onResidueClick={setCompareFoldedResidueIndex}
                            disruptionWarning={disruptionWarningVariant2}
                            mutantStatus={compareFoldingStatus}
                            mutantDdG={compareFoldingDdG}
                            variant={compareVariant}
                            energyUnit={settings.energyUnit}
                            fetchNearestResidues={compareFoldedResidueIndex !== foldedResidueIndex ? fetchNearestResidues : undefined}
                            pdbId={analysisState.result?.metadata?.pdbId}
                            pdbSource={analysisState.result?.metadata?.pdbSource}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Default Superimposed layout */
                    <MolstarViewer 
                      uniprotId={uniprotId} 
                      residueIndex={viewMode === "mutant" ? foldedResidueIndex : selectedResidueIndex} 
                      gene={gene} 
                      customPdbUrl={customPdbUrl || undefined}
                      customPdbData={viewMode === "mutant" ? (mutantPdb || undefined) : undefined}
                      onResidueHover={setHoveredResidueIndex}
                      onResidueClick={(idx) => {
                        if (viewMode === "mutant") {
                          setFoldedResidueIndex(idx);
                        } else {
                          setSelectedResidueIndex(idx);
                        }
                      }}
                      comparePdbData={compareMode ? (compareMutantPdb || undefined) : undefined}
                      compareResidueIndex={compareMode ? compareFoldedResidueIndex : undefined}
                      compareVariant={compareMode ? compareVariant : undefined}
                      disruptionWarning={viewMode === "mutant" ? disruptionWarningVariant1 : null}
                      mutantStatus={foldingStatus}
                      mutantDdG={foldingDdG}
                      variant={variant}
                      energyUnit={settings.energyUnit}
                      fetchNearestResidues={fetchNearestResidues}
                      onPdbTextLoaded={setPdbText}
                      computedPocket={computedPocket}
                      isPocketLoading={isPocketLoading}
                      pocketError={pocketError}
                      pdbId={analysisState.result?.metadata?.pdbId}
                      pdbSource={analysisState.result?.metadata?.pdbSource}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Sequence Alignment Visualizer Card */}
          <SequenceVisualizer 
            uniprotId={uniprotId} 
            variant={variant} 
            residueIndex={viewMode === "mutant" ? foldedResidueIndex : selectedResidueIndex} 
            hoveredResidueIndex={hoveredResidueIndex}
            gene={gene} 
            predictorData={analysisState.result?.predictorData}
            conservationData={analysisState.result?.conservationData}
            landscapeData={analysisState.result?.landscapeData}
            computedResiduesCache={computedResiduesCache}
            disruptionPredictor={disruptionPredictor}
            uniprotFeatures={analysisState.result?.uniprotFeatures?.features || undefined}
            onResidueClick={(idx) => {
              if (viewMode === "mutant") {
                setFoldedResidueIndex(idx);
              } else {
                setSelectedResidueIndex(idx);
              }
            }}
          />
        </section>
      </main>

      {/* Lab footer */}
      <footer className={`border-t py-3 px-5 text-xs mt-auto flex flex-col md:flex-row items-center justify-between gap-4 w-full max-w-full transition-colors ${
        isDark ? "bg-[#201E1B] border-[#322F2A] text-[#827B70]" : "bg-white border-[#DDD6ED] text-[#8E82A0]"
      }`}>
        <div className="flex flex-col items-center md:items-start text-center md:text-left max-w-2xl">
          <p className="flex items-center gap-1.5 justify-center md:justify-start">
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 animate-pulse" />
            <span className="font-semibold text-xs">Missense & Fold</span>
          </p>
          <p className={`text-[9.5px] mt-0.5 leading-relaxed ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            Disclaimer: For research and decision-support only. Not for diagnostic procedures. This application is not HIPAA-compliant; do not input Protected Health Information (PHI) or patient-identifiable data. Variant queries are transmitted to external APIs (including Google Gemini AI, ClinVar, EBI, and Ensembl) for real-time analysis. No clinical action should be taken based solely on this system.
          </p>
        </div>
        <p className={`font-mono text-[9.5px] text-center md:text-right ${isDark ? "text-slate-500" : "text-slate-400"}`}>
          Computational Engine © 2026 • Powered by Gemini Flash
        </p>
      </footer>

      {/* Settings Panel Slide-out Modal */}
      <SettingsModal />

      {/* How to Inspect Modal Popup */}
      <AnimatePresence>
        {isHowToInspectOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm"
              onClick={() => setIsHowToInspectOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`relative max-w-md w-full rounded-2xl border shadow-xl p-6 transition-colors z-10 ${
                isDark ? "bg-[#261E35] border-[#362B4A] text-slate-100" : "bg-white border-[#DDD6ED] text-slate-900"
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#C46849]" />
                  How to inspect missense mutations
                </h3>
                <button
                  type="button"
                  onClick={() => setIsHowToInspectOpen(false)}
                  className="text-slate-500 hover:text-slate-400 focus:outline-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4 text-xs select-none">
                <ul className={`space-y-3.5 pl-4 list-disc marker:text-[#C46849] ${isDark ? "text-[#B2ABA0]" : "text-[#666055]"}`}>
                  <li>
                    Analyze residue <strong className="font-mono text-[#C46849]">#{selectedResidueIndex || "408"}</strong> inside the rendered 3D fold. Use right-click or scroll-wheel to zoom.
                  </li>
                  <li>
                    Determine structural state context: outer alpha-helices, beta-sheet strands, or loops.
                  </li>
                  <li>
                    Check for steric clashes or broken hydrogen bonds resulting from substitution size/charge differentials.
                  </li>
                  <li>
                    Compare structures by toggling between <strong className="font-semibold text-slate-950 dark:text-slate-100">Wild-Type</strong> and simulated <strong className="text-[#D946AA] font-semibold">Mutant</strong> views.
                  </li>
                </ul>
                <div className={`p-3 rounded-lg border ${isDark ? "border-[#322F2A] bg-[#201E1B]/40" : "border-[#ECEAE4] bg-[#FAF9F6]"}`}>
                  <p className="text-[11px] italic text-slate-500">
                    "{VARIANT_PRESETS.find(p => p.gene === gene)?.description || "Inspect chemical/geometric substitutions inside protein chain constructs."}"
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Structural Legend & Controls Modal Popup */}
      <AnimatePresence>
        {isLegendOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm"
              onClick={() => setIsLegendOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`relative max-w-lg w-full rounded-2xl border shadow-xl p-6 transition-colors z-10 ${
                isDark ? "bg-[#261E35] border-[#362B4A] text-slate-100" : "bg-white border-[#DDD6ED] text-slate-900"
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#C46849]" />
                  Structural Legend & Controls
                </h3>
                <button
                  type="button"
                  onClick={() => setIsLegendOpen(false)}
                  className="text-slate-500 hover:text-slate-400 focus:outline-none cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4 text-xs select-none">
                
                {/* Interactive analytical toggle */}
                <div className={`p-3 rounded-lg border transition-colors ${
                  isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-[#FAF9F6] border-[#ECEAE4]"
                }`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showPolarContacts}
                      onChange={(e) => setShowPolarContacts(e.target.checked)}
                      className="w-4 h-4 rounded cursor-pointer accent-[#C46849] focus:ring-[#C46849]/30"
                    />
                    <div className="flex-1">
                      <span className="font-bold block text-[11px] uppercase tracking-wide font-mono">Show Polar Contacts</span>
                      <span className="text-[10px] block mt-0.5 leading-tight text-slate-500">
                        Dynamically calculate and visualize hydrogen bonds formed by target residue {selectedResidueIndex ?? ""}.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Left Sub-legend */}
                  <div className="space-y-4">
                    {/* Highlight Key */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-450">
                        Mutation Site Highlight
                      </p>
                      <div className={`space-y-1 p-2 rounded-lg border ${isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-white border-[#E5E1DC] shadow-sm"}`}>
                        <div className="flex items-start gap-1.5">
                          <span className="w-3 h-3 rounded bg-[#C46849] shrink-0 flex items-center justify-center mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                          </span>
                          <div>
                            <span className="font-semibold block font-mono text-[9px] text-[#C46849]">
                              Clay Sidechain
                            </span>
                            <span className="text-[9px] leading-snug block text-slate-500">
                              Residue #{selectedResidueIndex ?? "N/A"} rendered in sunset clay to reveal orientation.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Pocket Atoms elements */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-450">
                        Atomic Elements (CPK)
                      </p>
                      <div className={`grid grid-cols-2 gap-1.5 p-2 rounded-lg border text-[9px] font-mono ${
                        isDark ? "bg-[#201E1B] border-[#322F2A] text-slate-400" : "bg-[#FAF9F6] border-[#ECEAE4] text-slate-600"
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-neutral-400 shrink-0"></span>
                          <span>Carbon (C)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-rose-500 shrink-0"></span>
                          <span>Oxygen (O)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-blue-500 shrink-0"></span>
                          <span>Nitrogen (N)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 rounded-full h-2 bg-yellow-500 shrink-0"></span>
                          <span>Sulfur (S)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Sub-legend */}
                  <div className="space-y-4">
                    {/* Contacts Map */}
                    {showPolarContacts && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-450">
                          Interactive Contacts
                        </p>
                        <div className={`space-y-1 p-2 rounded-lg border text-[9px] font-mono ${
                          isDark ? "bg-[#201E1B] border-[#322F2A] text-slate-400" : "bg-white border-[#E5E1DC] text-slate-650 shadow-sm"
                        }`}>
                          <div className="flex items-center gap-1.5">
                            <span className="w-4 h-0.5 border-t border-dashed border-sky-400 shrink-0"></span>
                            <span className={isDark ? "text-sky-300" : "text-sky-600 font-bold"}>H-Bonds / Polar</span>
                          </div>
                          <p className="text-[8px] leading-tight text-slate-500">
                            Cyan dashed vectors computed by Molstar. Identifies pocket residues with broken polarity.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* pLDDT Score heat key */}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-450">
                        AlphaFold pLDDT Confidence
                      </p>
                      <div className={`p-2 rounded-lg border space-y-1.5 ${
                        isDark ? "bg-[#201E1B] border-[#322F2A]" : "bg-white border-[#E5E1DC] shadow-sm"
                      }`}>
                        <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-orange-500 via-yellow-400 to-indigo-600"></div>
                        <div className="flex items-center justify-between text-[8px] text-slate-500 font-mono">
                          <span>Low (&lt;50)</span>
                          <span>High (&gt;90)</span>
                        </div>
                        {viewMode !== "wildtype" && (
                          <div className={`text-[8.5px] leading-normal pt-1.5 border-t ${
                            isDark ? "border-[#322F2A] text-slate-500" : "border-[#ECEAE4] text-slate-450"
                          }`}>
                            <span className="font-semibold text-amber-500">⚠ Inherited pLDDT:</span> Color confidence is inherited from the wild-type template.
                          </div>
                        )}
                      </div>
                    </div>

                    {viewMode !== "wildtype" && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-slate-450">
                          Scaffold Status
                        </p>
                        <div className={`p-2 rounded-lg border text-[9px] leading-relaxed ${
                          isDark ? "bg-[#201E1B] border-[#322F2A] text-slate-400" : "bg-white border-[#E5E1DC] text-slate-600 shadow-sm"
                        }`}>
                          {foldingStatus === "success"
                            ? "Computed via FoldX biophysical modeling. Geometries represent atomic force-field alignments."
                            : "Structure coordinates represent wild-type backbone."}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {state.notifications?.map((notif: any) => (
          <div
            key={notif.id}
            className={`pointer-events-auto p-3.5 rounded-xl shadow-xl border flex items-start gap-3 transition-all duration-300 transform translate-y-0 scale-100 animate-slide-in backdrop-blur-md ${
              state.isDark
                ? "bg-slate-900/90 border-slate-805 text-white"
                : "bg-white/95 border-slate-200 text-slate-900"
            }`}
          >
            {notif.type === "success" && (
              <span className="text-emerald-500 text-sm mt-0.5 font-bold">✓</span>
            )}
            {notif.type === "error" && (
              <span className="text-rose-500 text-sm mt-0.5">⚠️</span>
            )}
            {notif.type === "info" && (
              <span className="text-blue-500 text-sm mt-0.5">ℹ️</span>
            )}
            <div className="flex-1">
              <p className="text-[9px] leading-none font-extrabold tracking-wider uppercase opacity-45 mb-1 font-mono">
                {notif.type === "success" ? "Analysis Ready" : notif.type === "error" ? "Notification Error" : "System Update"}
              </p>
              <p className="text-[11px] leading-normal font-medium">{notif.message}</p>
            </div>
            <button
              onClick={() => actions.removeNotification(notif.id)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1 mt-0.5 font-bold transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
