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
  Moon
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
    pdbText,
    computedPocket,
    isPocketLoading,
    pocketError,
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
    isHowToInspectCollapsed,
    isLegendCollapsed,
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
    pathogenicity,
    computedResiduesCache
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
    setIsHowToInspectCollapsed,
    setIsLegendCollapsed,
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

      {/* Clinical & Privacy Warning Banner has been integrated into footer disclaimer */}

      {/* Main Grid Workspace */}
      <main className="flex-1 w-full max-w-full p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Controls & Insights (spanning 5/12 width) */}
        <section className={`lg:col-span-5 flex flex-col gap-6 w-full transition-all duration-300 ${settings.bentoLeftControls ? "lg:order-1" : "lg:order-2"}`}>
          
          {/* SEARCH & CONTROL PANEL */}
          <VariantSearchPanel
            isDark={isDark}
            classCard={classCard}
            classInput={classInput}
            classBorderSec={classBorderSec}
            showCustomInputs={showCustomInputs}
            setShowCustomInputs={setShowCustomInputs}
            customGene={customGene}
            setCustomGene={setCustomGene}
            customVariant={customVariant}
            setCustomVariant={setCustomVariant}
            customUniprot={customUniprot}
            setCustomUniprot={setCustomUniprot}
            searchVal={searchVal}
            setSearchVal={setSearchVal}
            analysisState={analysisState}
            handleSearchSubmit={handleSearchSubmit}
            gene={gene}
            setGene={setGene}
            variant={variant}
            setVariant={setVariant}
            setUniprotId={setUniprotId}
            setSelectedResidueIndex={setSelectedResidueIndex}
            setAnalysisState={setAnalysisState}
            history={history}
            clearHistory={clearHistory}
            handleSelectHistoryItem={handleSelectHistoryItem}
            uniprotId={uniprotId}
            resetViewerState={resetViewerState}
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
            pathogenicity={pathogenicity}
            loadingStep={loadingStep}
            formatEnergyString={formatEnergyString}
            selectedResidueIndex={selectedResidueIndex}
            settings={settings}
            classTextBody={classTextBody}
            classTextMute={classTextMute}
            classBorderSec={classBorderSec}
            computedResiduesCache={computedResiduesCache}
          />

          {/* UNIFIED EVIDENCE DASHBOARD */}
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
            computedPocket={computedPocket}
            isPocketLoading={isPocketLoading}
            pocketError={pocketError}
          />
        </section>

        {/* RIGHT COLUMN: 3D Molstar viewer (spanning 7/12 width) */}
        <section className={`lg:col-span-7 flex flex-col gap-6 w-full transition-all duration-300 ${settings.bentoLeftControls ? "lg:order-2" : "lg:order-1"}`}>
          <div className={`${classCard} p-4 transition-all`}>
            
            {/* Visualizer header */}
            <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b ${classBorderSec}`}>
              <div>
                <h3 className={`text-sm font-semibold uppercase tracking-wider font-mono flex items-center gap-2 ${
                  isDark ? "text-white" : "text-slate-800"
                }`}>
                  <Activity className="w-4 h-4 text-indigo-500" />
                  3D Molecular Workspace
                </h3>
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Rotate molecule by dragging, pinch/scroll to zoom. Double-click atom to center.
                </p>
              </div>

              {/* Quality details / legend */}
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-mono uppercase ${isDark ? "text-slate-500" : "text-slate-500"}`}>AlphaFold Quality (pLDDT):</span>
                <div className={`flex items-center h-2.5 rounded-full overflow-hidden border w-16 bg-slate-900 ${isDark ? "border-slate-700/80" : "border-slate-300"}`}>
                  <div className="w-1/4 h-full bg-[#f00]" title="Very Low"></div>
                  <div className="w-1/4 h-full bg-[#ff0]" title="Low"></div>
                  <div className="w-1/4 h-full bg-[#0ff]" title="Confident"></div>
                  <div className="w-1/4 h-full bg-[#00f]" title="Very High"></div>
                </div>
              </div>
            </div>

            {/* Dual Variant Comparison Control Bar */}
            {viewMode === "mutant" && (
              <div className={`p-4 rounded-xl border flex flex-col gap-3.5 mb-3 transition-all ${
                isDark 
                  ? "bg-slate-900/35 border-slate-800" 
                  : "bg-slate-50 border-slate-200/80 shadow-sm"
              }`}>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-pink-500 animate-pulse" />
                    <span className={`text-xs font-bold uppercase tracking-wider font-mono ${isDark ? "text-slate-400" : "text-slate-700"}`}>
                      Pairwise Variant Superposition & Comparison
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !compareMode;
                      setCompareMode(next);
                      if (next && !compareMutantPdb && !isFoldingCompare) {
                        const defaultAlt = getAlternativeVariants(gene)[0];
                        setCompareVariant(defaultAlt);
                        fetchCompareMutantFold(gene, defaultAlt, uniprotId);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border shrink-0 cursor-pointer ${
                      compareMode
                        ? "bg-pink-600/10 border-pink-500/30 text-pink-500 hover:bg-pink-600/20 shadow-sm"
                        : isDark
                          ? "bg-slate-700/10 border-slate-700/35 text-slate-400 hover:bg-slate-700/20 hover:text-slate-200"
                          : "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200 hover:text-slate-900 shadow-sm"
                    }`}
                  >
                    {compareMode ? "Disable Comparison" : "Enable Compare Mode"}
                  </button>
                </div>

                {compareMode && (
                  <div className="flex flex-col gap-3.5 pt-2.5 border-t border-dashed border-slate-700/30">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                      
                      {/* Variant Selection Field */}
                      <div className="md:col-span-4 flex flex-col gap-1">
                        <label className="text-[10px] font-semibold font-mono text-slate-400 uppercase">Select Comparison Variant</label>
                        <select
                          value={compareVariant}
                          onChange={(e) => {
                            const selectedVal = e.target.value;
                            setCompareVariant(selectedVal);
                            if (selectedVal !== "custom") {
                              fetchCompareMutantFold(gene, selectedVal, uniprotId);
                            }
                          }}
                          className={`w-full text-xs px-2.5 py-1.5 rounded-lg border focus:ring-1 focus:ring-pink-500 focus:outline-none cursor-pointer ${classInput}`}
                        >
                          {getAlternativeVariants(gene).map((alt) => (
                            <option key={alt} value={alt}>{alt}</option>
                          ))}
                          <option value="custom">Custom Mutation...</option>
                        </select>
                      </div>

                      {/* Custom variant text box if dropdown is set to custom */}
                      {compareVariant === "custom" && (
                        <div className="md:col-span-3 flex flex-col gap-1">
                          <label className="text-[10px] font-semibold font-mono text-slate-400 uppercase">Mutation (e.g. p.Gly300Ser)</label>
                          <input
                            type="text"
                            placeholder="p.Gly300Ser"
                            className={`px-2.5 py-1 text-xs w-full rounded-lg border focus:ring-1 focus:ring-pink-500 focus:outline-none ${classInput}`}
                            onBlur={(e) => {
                              if (e.target.value) {
                                let val = e.target.value.trim();
                                if (!val.startsWith("p.")) {
                                  val = "p." + val;
                                }
                                setCompareVariant(val);
                              }
                            }}
                          />
                        </div>
                      )}

                      {/* Layout Type Selection */}
                      <div className={`${compareVariant === "custom" ? "md:col-span-3" : "md:col-span-5"} flex flex-col gap-1`}>
                        <label className="text-[10px] font-semibold font-mono text-slate-400 uppercase font-bold">Workspace Layout Mode</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setComparisonLayout("superimposed")}
                            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              comparisonLayout === "superimposed"
                                ? "bg-indigo-600 border-indigo-500 text-white"
                                : isDark
                                  ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Superimposed
                          </button>
                          <button
                            type="button"
                            onClick={() => setComparisonLayout("side-by-side")}
                            className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              comparisonLayout === "side-by-side"
                                ? "bg-indigo-600 border-indigo-500 text-white"
                                : isDark
                                  ? "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Side-by-Side
                          </button>
                        </div>
                      </div>

                      {/* Run Simulation button */}
                      <div className="md:col-span-3 flex flex-col justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const actualVal = compareVariant === "custom" ? "p.Gly300Ser" : compareVariant;
                            fetchCompareMutantFold(gene, actualVal, uniprotId);
                          }}
                          disabled={isFoldingCompare}
                          className={`w-full py-1.5 rounded-lg text-xs font-bold font-mono transition-all border shadow-sm cursor-pointer ${
                            isFoldingCompare
                              ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
                              : "bg-pink-600 hover:bg-pink-500 text-white border-pink-700 hover:border-pink-600"
                          }`}
                        >
                          {isFoldingCompare ? "Developing Model..." : "Fold Variant 2"}
                        </button>
                      </div>
                    </div>

                    {/* Progress tracking under simulations */}
                    {isFoldingCompare && (
                      <div className="flex items-center gap-2 text-[11px] font-mono text-purple-400 animate-pulse bg-purple-500/5 px-2.5 py-1.5 rounded-lg border border-purple-500/10">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping"></span>
                        <span>Simulating biophysical side-chain mutations for {compareVariant}...</span>
                      </div>
                    )}

                    {foldingCompareError && (
                      <div className="text-[11px] font-mono text-rose-500 bg-rose-500/5 px-2.5 py-1.5 rounded-lg border border-rose-500/10">
                        <span>Failed to simulate comparison structure: {foldingCompareError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Segmented Control Toggle Switch */}
            <div className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 rounded-xl border mb-1 transition-all ${
              isDark 
                ? "bg-slate-900/60 border-slate-800/85" 
                : "bg-slate-100 border-slate-200"
            }`}>
              <span className={`text-[11px] font-mono pl-1 flex items-center gap-1.5 ${
                isDark ? "text-slate-400" : "text-slate-500"
              }`}>
                <Compass className="w-3.5 h-3.5 text-indigo-500" />
                Structural State Comparison:
              </span>
              <div className={`flex items-center p-1 rounded-lg border transition-all ${
                isDark 
                  ? "bg-slate-950 border-slate-800" 
                  : "bg-white border-slate-200 shadow-sm"
              }`}>
                <button
                  type="button"
                  id="view-wildtype-btn"
                  onClick={() => setViewMode("wildtype")}
                  className={`px-3 py-1.5 rounded-md font-sans text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === "wildtype"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
                      : isDark
                        ? "text-slate-400 hover:text-slate-200"
                        : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Wild-Type (AlphaFold)
                </button>
                <button
                  type="button"
                  id="view-mutant-btn"
                  onClick={() => setViewMode("mutant")}
                  className={`px-3 py-1.5 rounded-md font-sans text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === "mutant"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
                      : isDark
                        ? "text-slate-400 hover:text-slate-200"
                        : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Mutant (Simulated)
                </button>
              </div>
            </div>

            {/* Custom overlays for active folding or structure display */}
            {viewMode === "mutant" && isFolding && (
              <div className={`relative w-full h-[650px] rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-6 border transition-all ${
                isDark 
                  ? "bg-slate-900 border-slate-800 text-white" 
                  : "bg-slate-50 border-slate-200 text-slate-800"
              }`}>
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-indigo-600 dark:text-indigo-400 font-mono text-sm tracking-widest uppercase animate-pulse">
                  Folding Mutant Protein Structure...
                </p>
                <p className={`text-xs mt-2 text-center max-w-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Simulating side-chain biophysics at position #{selectedResidueIndex || "408"} and optimizing structural geometries. This can take several seconds...
                </p>
              </div>
            )}

            {viewMode === "mutant" && foldingError && (
              <div className={`relative w-full h-[650px] rounded-xl overflow-hidden shadow-inner flex flex-col items-center justify-center p-6 text-center border transition-all ${
                isDark 
                  ? "bg-slate-900 border-slate-800 text-rose-455" 
                  : "bg-rose-50/50 border-rose-200 text-rose-700"
              }`}>
                <AlertTriangle className="w-12 h-12 mb-3 text-rose-500 animate-pulse" />
                <p className={`font-semibold text-lg mb-2 ${isDark ? "text-white" : "text-slate-900"}`}>FoldX Biophysical Simulation Failed</p>
                <p className={`text-sm max-w-md mb-4 ${isDark ? "text-slate-400" : "text-slate-600"}`}>{foldingError}</p>
                <button 
                  type="button"
                  onClick={() => fetchMutantFold(gene, variant, uniprotId)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs px-4 py-2 rounded-lg transition shadow-md shadow-indigo-600/20 active:scale-95 cursor-pointer"
                >
                  Retry Folding
                </button>
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
                        />
                      </div>
                      
                      {/* Right Viewport: Variant 2 */}
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[10px] font-bold text-pink-500 font-mono px-1 flex items-center justify-between uppercase tracking-wider">
                          <span>Variant 2: {compareVariant}</span>
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
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}

            {/* Collapsible Info Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4 items-start">
              
              {/* How to Inspect Info Card */}
              <div className={`rounded-xl border overflow-hidden flex flex-col transition-colors self-start w-full ${
                isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50/50 border-slate-200 shadow-sm"
              }`}>
                <button
                  type="button"
                  onClick={() => setIsHowToInspectCollapsed(!isHowToInspectCollapsed)}
                  className={`w-full flex items-center justify-between p-4 transition-colors text-left focus:outline-none ${
                    !isHowToInspectCollapsed ? "border-b" : ""
                  } ${
                    isDark 
                      ? "bg-slate-900/60 hover:bg-slate-900 border-slate-800" 
                      : "bg-slate-100 hover:bg-slate-200 border-slate-200"
                  }`}
                >
                  <span className={`font-bold font-mono text-[10px] uppercase tracking-wider flex items-center gap-2 ${isDark ? "text-slate-100" : "text-slate-700"}`}>
                    <BookOpen className="w-4 h-4 text-indigo-500" />
                    How to inspect missense mutations
                  </span>
                  {isHowToInspectCollapsed ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {!isHowToInspectCollapsed && (
                  <div className="p-4 space-y-3.5 flex-1 select-none animate-slide-in">
                    <ul className={`space-y-3 text-[11px] pl-4 list-disc marker:text-indigo-500 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                      <li>
                        Analyze residue <strong className="text-amber-500 font-mono">#{selectedResidueIndex || "408"}</strong> inside the rendered 3D fold. Use right-click or scroll-wheel to zoom in/out of the atomic density pocket.
                      </li>
                      <li>
                        Determine structural state context: whether the mutation site belongs to outer alpha-helices, beta-sheet strands, or unstructured loops.
                      </li>
                      <li>
                        Check for steric clashes or broken hydrogen bonds resulting from size/charge differential substitution (e.g. basic Arg replaced with bulk aromatic Trp).
                      </li>
                      <li>
                        Compare native and simulated structures by toggling between <strong className="text-indigo-600 dark:text-indigo-400 font-bold">Wild-Type</strong> and synthetic <strong className="text-pink-500 dark:text-pink-400">Mutant (Simulated)</strong> views.
                      </li>
                    </ul>
                    <div className={`pt-2 border-t rounded ${isDark ? "border-slate-800/50 bg-slate-900/10" : "border-slate-200 bg-slate-100/30"}`}>
                      <p className={`text-[10px] italic ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        "{VARIANT_PRESETS.find(p => p.gene === gene)?.description || "Inspect chemical/geometric substitutions inside protein chain constructs."}"
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Structural Legend & Interactive Analytical Controls Card */}
              <div className={`rounded-xl border overflow-hidden flex flex-col transition-colors self-start w-full ${
                isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50/50 border-slate-200 shadow-sm"
              }`}>
                <button
                  type="button"
                  onClick={() => setIsLegendCollapsed(!isLegendCollapsed)}
                  className={`w-full flex items-center justify-between p-4 transition-colors text-left focus:outline-none ${
                    !isLegendCollapsed ? "border-b" : ""
                  } ${
                    isDark 
                      ? "bg-slate-900/60 hover:bg-slate-900 border-slate-800" 
                      : "bg-slate-100 hover:bg-slate-200 border-slate-200"
                  }`}
                >
                  <span className={`font-bold font-mono text-[10px] uppercase tracking-wider flex items-center gap-2 ${isDark ? "text-slate-100" : "text-slate-700"}`}>
                    <Layers className="w-4 h-4 text-indigo-500" />
                    Structural Legend & Analytical Controls
                  </span>
                  {isLegendCollapsed ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {!isLegendCollapsed && (
                  <div className="p-4 space-y-4 flex-1 text-xs select-none animate-slide-in">
                    
                    {/* Interactive analytical toggle */}
                    <div className={`p-2.5 rounded-lg border transition-colors ${
                      isDark ? "bg-slate-950/60 border-slate-800" : "bg-white border-slate-200 shadow-inner"
                    }`}>
                      <label className={`flex items-center gap-2.5 cursor-pointer ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                        <input
                          type="checkbox"
                          checked={showPolarContacts}
                          onChange={(e) => setShowPolarContacts(e.target.checked)}
                          className={`w-4 h-4 rounded focus:ring-indigo-500/45 focus:ring-2 cursor-pointer accent-indigo-500 ${
                            isDark ? "border-slate-700 bg-slate-950 text-indigo-600" : "border-slate-300 bg-white text-indigo-600"
                          }`}
                        />
                        <div className="flex-1">
                          <span className={`font-bold block text-[11px] uppercase tracking-wide font-mono ${isDark ? "text-white" : "text-slate-800"}`}>Show Polar Contacts</span>
                          <span className={`text-[10px] block mt-0.5 leading-tight ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            Dynamically calculate and visualize hydrogen bonds formed by target residue {selectedResidueIndex ?? ""}.
                          </span>
                        </div>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Left Sub-legend */}
                      <div className="space-y-3.5">
                        {/* Highlight Key */}
                        <div>
                          <p className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            Mutation Site Highlight
                          </p>
                          <div className={`space-y-1 p-2 rounded-lg border ${isDark ? "bg-slate-900/40 border-slate-800/60" : "bg-white border-slate-200 shadow-sm"}`}>
                            <div className="flex items-start gap-1.5">
                              <span className="w-3 h-3 rounded bg-[#F97316] shrink-0 border border-amber-500/20 flex items-center justify-center mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                              </span>
                              <div>
                                <span className="font-semibold text-amber-500 block font-mono text-[9px]">
                                  Orange Sidechain
                                </span>
                                <span className={`text-[9px] leading-snug block ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                                  Residue #{selectedResidueIndex ?? "N/A"} rendered in sunset orange (Ball-and-Stick) to reveal orientation.
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Pocket Atoms elements */}
                        <div>
                          <p className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                            Atomic Elements (CPK)
                          </p>
                          <div className={`grid grid-cols-2 gap-1.5 p-2 rounded-lg border text-[9px] font-mono ${
                            isDark ? "bg-slate-900/40 border-slate-800/60 text-slate-300" : "bg-white border-slate-200 text-slate-600 shadow-sm"
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
                              <span className="w-2 rounded-full h-2 bg-yellow-400 shrink-0"></span>
                              <span>Sulfur (S)</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right Sub-legend */}
                      <div className="space-y-3.5">
                        {/* Contacts Map */}
                        {showPolarContacts && (
                          <div>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                              Interactive Contacts
                            </p>
                            <div className={`space-y-1 p-2 rounded-lg border text-[9px] font-mono ${
                              isDark ? "bg-slate-900/40 border-slate-800/60 text-slate-300" : "bg-white border-slate-200 text-slate-600 shadow-sm"
                            }`}>
                              <div className="flex items-center gap-1.5">
                                <span className="w-4 h-0.5 border-t border-dashed border-sky-400 shrink-0"></span>
                                <span className={isDark ? "text-sky-300" : "text-sky-600 font-bold"}>H-Bonds / Polar</span>
                              </div>
                              <p className={`text-[8px] leading-tight ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                                Cyan dashed vectors computed by Molstar. Identifies pocket residues with broken polarity.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* pLDDT Score heat key */}
                        {viewMode === "wildtype" ? (
                          <div>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                              AlphaFold pLDDT Confidence
                            </p>
                            <div className={`p-2 rounded-lg border ${
                              isDark ? "bg-slate-900/40 border-slate-800/60" : "bg-white border-slate-200 shadow-sm"
                            }`}>
                              <div className="h-1 w-full rounded bg-gradient-to-r from-orange-500 via-yellow-400 to-indigo-600"></div>
                              <div className="flex items-center justify-between text-[8px] text-slate-500 font-mono mt-1">
                                <span>Low (&lt;50)</span>
                                <span>High (&gt;90)</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                              Scaffold Status
                            </p>
                            <div className={`p-2 rounded-lg border text-[9px] leading-relaxed ${
                              isDark ? "bg-slate-900/40 border-slate-800/60 text-slate-400" : "bg-white border-slate-200 text-slate-600 shadow-sm"
                            }`}>
                              {foldingStatus === "success"
                                ? "Computed via FoldX biophysical modeling. Geometries represent atomic force-field alignments."
                                : foldingStatus === "scwrl"
                                  ? "SCWRL4 side-chain repack (no ΔΔG)."
                                  : "Structure coordinates represent wild-type backbone."}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sequence Alignment Visualizer Card */}
          <SequenceVisualizer 
            uniprotId={uniprotId} 
            variant={variant} 
            residueIndex={viewMode === "mutant" ? foldedResidueIndex : selectedResidueIndex} 
            hoveredResidueIndex={hoveredResidueIndex}
            gene={gene} 
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
      <footer className={`border-t py-3 px-4 lg:px-6 text-xs mt-auto flex flex-col md:flex-row items-center justify-between gap-4 w-full max-w-full transition-colors ${
        isDark ? "bg-[#1e293b] border-slate-800 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-500"
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
    </div>
  );
}
