import React, { useState, useEffect, useRef } from "react";
import { Search, Sparkles, History, Trash2, Loader2, Clipboard, ShieldAlert, X, ChevronDown } from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";

interface QueryStripProps {
  isDark: boolean;
  isOpen: boolean;
  onClose: () => void;
  customGene: string;
  setCustomGene: (val: string) => void;
  customVariant: string;
  setCustomVariant: (val: string) => void;
  customUniprot: string;
  setCustomUniprot: (val: string) => void;
  customGenomic: string;
  setCustomGenomic: (val: string) => void;
  analysisState: AnalysisState;
  handleSearchSubmit: (e: React.FormEvent) => void;
  gene: string;
  variant: string;
  history: SearchHistoryItem[];
  clearHistory: () => void;
  handleSelectHistoryItem: (item: SearchHistoryItem) => void;
}

async function pasteFromClipboard(setter: (val: string) => void) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) setter(text.trim());
  } catch {
    // clipboard access denied or unavailable
  }
}

export const QueryStrip: React.FC<QueryStripProps> = ({
  isDark,
  isOpen,
  onClose,
  customGene,
  setCustomGene,
  customVariant,
  setCustomVariant,
  customUniprot,
  setCustomUniprot,
  customGenomic,
  setCustomGenomic,
  analysisState,
  handleSearchSubmit,
  gene,
  variant,
  history,
  clearHistory,
  handleSelectHistoryItem,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const geneInputRef = useRef<HTMLInputElement>(null);
  const userDirections = useVariantAnalysisStore(s => s.userDirections);
  const { setUserDirections } = useVariantAnalysisActions();
  const isGenomicVariant = (customVariant && (
    /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i.test(customVariant.trim()) ||
    /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i.test(customVariant.trim()) ||
    /^(?:chr)?[0-9XYMT]+-\d+-[ACGTN]+-[ACGTN]+$/i.test(customVariant.trim())
  )) || !!customGenomic.trim();
  const isGeneRequired = !isGenomicVariant;
  const isVariantRequired = !customGenomic.trim();

  // Auto-focus gene input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        geneInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isOpen &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        // Only close if it's not a click on the header search trigger button
        const target = event.target as HTMLElement;
        if (!target.closest("#header-search-trigger")) {
          onClose();
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const inputClass = "w-full rounded-lg px-3 py-2 text-xs outline-none border transition-all font-medium bg-slate-950/40 text-slate-100 border-slate-800 focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20";

  const PasteBtn = ({ setter }: { setter: (v: string) => void }) => (
    <button
      type="button"
      tabIndex={-1}
      title="Paste from clipboard"
      onClick={() => pasteFromClipboard(setter)}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-opacity cursor-pointer hover:opacity-80 active:scale-95 text-slate-500 hover:text-teal-400"
    >
      <Clipboard className="w-3 h-3" />
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="absolute top-[44px] left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-md border-b border-slate-800/80 shadow-2xl transition-all duration-300 animate-slide-down"
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-3">
        {/* Form Grid */}
        <form
          onSubmit={(e) => {
            handleSearchSubmit(e);
            onClose(); // Auto-close on successful search
          }}
          className="flex flex-col md:flex-row md:items-end gap-3"
        >
          {/* Gene field */}
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Gene {isGeneRequired && <span className="text-rose-500">*</span>}
            </label>
            <div className="relative">
              <input
                ref={geneInputRef}
                type="text"
                required={isGeneRequired}
                placeholder="e.g. MECP2"
                value={customGene}
                onChange={(e) => setCustomGene(e.target.value)}
                className={`${inputClass} pr-8 font-semibold tracking-wide font-mono`}
              />
              <PasteBtn setter={setCustomGene} />
            </div>
          </div>

          {/* Variant field */}
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Variant {isVariantRequired && <span className="text-rose-500">*</span>}
            </label>
            <div className="relative">
              <input
                type="text"
                required={isVariantRequired}
                placeholder="e.g. p.Arg255Ter"
                value={customVariant}
                onChange={(e) => setCustomVariant(e.target.value)}
                className={`${inputClass} pr-8 font-semibold tracking-wide font-mono`}
              />
              <PasteBtn setter={setCustomVariant} />
            </div>
          </div>

          {/* Genomic Coordinates field */}
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Genomic Coordinates (Optional)
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="e.g. 20-23365054-G-A"
                value={customGenomic}
                onChange={(e) => setCustomGenomic(e.target.value)}
                className={`${inputClass} pr-8 font-mono`}
              />
              <PasteBtn setter={setCustomGenomic} />
            </div>
          </div>

          {/* UniProt ID field */}
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              UniProt ID (Optional)
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="e.g. P51587"
                value={customUniprot}
                onChange={(e) => setCustomUniprot(e.target.value)}
                className={`${inputClass} pr-8 font-mono`}
              />
              <PasteBtn setter={setCustomUniprot} />
            </div>
          </div>

          {/* Submit & Close Buttons */}
          <div className="flex gap-2 min-w-[200px]">
            <button
              type="submit"
              disabled={analysisState.isLoading}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-teal-600 hover:bg-teal-500 shadow-lg shadow-teal-600/10 active:scale-95"
            >
              {analysisState.isLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Analyze
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 cursor-pointer active:scale-95 transition-all"
              title="Close Search Panel (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Collapsible Custom Instructions & Recent History Block */}
        <div className="flex flex-col md:flex-row gap-4 border-t border-slate-800/60 pt-3 mt-1">
          {/* AI Focus Area Collapsible */}
          <div className="flex-1 min-w-[280px]">
            <details className="group">
              <summary className="flex justify-between items-center text-[10px] font-semibold uppercase tracking-widest select-none cursor-pointer text-slate-400 hover:text-slate-300">
                <span>AI Custom Focus Area (Optional)</span>
                <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 space-y-2 group-open:animate-fade-in">
                <textarea
                  placeholder="e.g. Focus on structural integrity of binding pocket..."
                  value={userDirections}
                  onChange={(e) => setUserDirections(e.target.value.slice(0, 2000))}
                  maxLength={2000}
                  className="w-full h-14 rounded border p-2 text-xs outline-none bg-slate-950/20 resize-none border-slate-800 text-slate-200 focus:border-teal-500/30"
                />
              </div>
            </details>
          </div>

          {/* Search History Chips */}
          {history.length > 0 && (
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  <History className="w-3 h-3" />
                  Recent Queries
                </span>
                <button
                  type="button"
                  onClick={clearHistory}
                  className="text-[10px] font-semibold text-pink-500 hover:text-pink-400 transition-colors cursor-pointer flex items-center gap-1 active:scale-95"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[60px] overflow-y-auto pr-1">
                {history.map((item, idx) => (
                  <button
                    key={`${item.gene}_${item.variant}_${idx}`}
                    onClick={() => {
                      handleSelectHistoryItem(item);
                      onClose();
                    }}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-950/30 border border-slate-800 hover:border-teal-500/30 text-xs text-slate-300 cursor-pointer hover:bg-slate-800/40 active:scale-95 transition-all ${
                      gene === item.gene && variant === item.variant ? "border-teal-500/50 bg-teal-500/5 text-teal-400 font-semibold" : ""
                    }`}
                  >
                    <span>{item.gene}</span>
                    <span className="text-[10px] font-mono text-pink-400/90">{item.variant}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
