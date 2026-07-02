import React, { useState } from "react";
import { 
  Search, 
  Dna, 
  Sparkles, 
  History, 
  Trash2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";

interface VariantSearchPanelProps {
  isDark: boolean;
  classCard: string;
  classInput: string;
  classBorderSec: string;
  customGene: string;
  setCustomGene: (val: string) => void;
  customVariant: string;
  setCustomVariant: (val: string) => void;
  customUniprot: string;
  setCustomUniprot: (val: string) => void;
  analysisState: AnalysisState;
  handleSearchSubmit: (e: React.FormEvent) => void;
  gene: string;
  variant: string;
  uniprotId: string;
  history: SearchHistoryItem[];
  clearHistory: () => void;
  handleSelectHistoryItem: (item: SearchHistoryItem) => void;
}

export default function VariantSearchPanel({
  isDark,
  classCard,
  classInput,
  classBorderSec,
  customGene,
  setCustomGene,
  customVariant,
  setCustomVariant,
  customUniprot,
  setCustomUniprot,
  analysisState,
  handleSearchSubmit,
  gene,
  variant,
  history,
  clearHistory,
  handleSelectHistoryItem,
}: VariantSearchPanelProps) {
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  return (
    <div className={`${classCard} p-4 transition-all`} id="variant-search-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className={`text-sm font-semibold uppercase tracking-wider font-mono flex items-center gap-2 transition-colors ${isDark ? "text-white" : "text-slate-800"}`}>
          <Search className="w-4 h-4 text-indigo-500" />
          Variant Query
        </h2>
      </div>

      <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        {/* Gene Symbol */}
        <div className="sm:col-span-3 flex flex-col gap-1">
          <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Gene
          </label>
          <input
            type="text"
            required
            placeholder="e.g. FGFR3"
            value={customGene}
            onChange={(e) => setCustomGene(e.target.value)}
            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-700"}`}
          />
        </div>

        {/* Variant */}
        <div className="sm:col-span-3 flex flex-col gap-1">
          <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Variant
          </label>
          <div className="relative">
            <input
              type="text"
              required
              placeholder="e.g. p.Gly380Arg"
              value={customVariant}
              onChange={(e) => setCustomVariant(e.target.value)}
              className={`w-full rounded-lg pl-2.5 pr-8 py-1.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-700"}`}
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <Dna className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            </div>
          </div>
        </div>

        {/* UniProt ID */}
        <div className="sm:col-span-3 flex flex-col gap-1">
          <label className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            UniProt ID
          </label>
          <input
            type="text"
            placeholder="e.g. P22607 (optional)"
            value={customUniprot}
            onChange={(e) => setCustomUniprot(e.target.value)}
            className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-700"}`}
          />
        </div>

        {/* Action Button */}
        <div className="sm:col-span-3 flex">
          <button
            type="submit"
            disabled={analysisState.isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold py-1.5 px-3 rounded-lg shadow-md transition flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {analysisState.isLoading ? "Crunching..." : "Analyze"}
          </button>
        </div>
      </form>

      {/* Format Hints Row */}
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 mt-2 text-[9px] font-mono leading-tight">
        <p className={isDark ? "text-slate-500" : "text-slate-400"}>
          Accepted: p.Gly380Arg · G380R · 380R (HGVS protein)
        </p>
      </div>

      {/* Search History — collapsible */}
      {history.length > 0 && (
        <div className={`mt-3 pt-3 border-t ${classBorderSec}`}>
          <button
            type="button"
            onClick={() => setHistoryCollapsed(p => !p)}
            className="w-full flex items-center justify-between mb-2 cursor-pointer"
          >
            <span className={`text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <History className="w-3.5 h-3.5 text-indigo-500" />
              Recent Queries
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); clearHistory(); }}
                className="text-[10px] font-semibold text-rose-500 hover:text-rose-400 transition flex items-center gap-1 cursor-pointer"
                title="Clear query history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
              {historyCollapsed
                ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                : <ChevronUp className="w-3.5 h-3.5 text-slate-400" />}
            </div>
          </button>

          {!historyCollapsed && (
            <div className="flex flex-wrap gap-1.5">
              {history.map((item, idx) => (
                <button
                  key={`${item.gene}_${item.variant}_${idx}`}
                  onClick={() => handleSelectHistoryItem(item)}
                  className={`text-left px-3 py-1.5 rounded-xl border text-[11px] transition-all duration-300 flex items-center gap-2 cursor-pointer ${
                    gene === item.gene && variant === item.variant
                      ? "bg-indigo-500/15 border-indigo-500 text-indigo-600 dark:text-white dark:bg-indigo-600/30 shadow-md shadow-indigo-500/5 font-semibold"
                      : isDark
                        ? "bg-slate-900/40 hover:bg-slate-800/60 border-slate-800 hover:border-slate-700 text-slate-350"
                        : "bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700 shadow-sm"
                  }`}
                >
                  <span className="font-bold tracking-tight">{item.gene}</span>
                  <span className="font-mono text-[9px] text-indigo-500 dark:text-indigo-300">{item.variant}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
