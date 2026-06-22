import React from "react";
import { 
  Search, 
  Compass, 
  Dna, 
  Sparkles, 
  RotateCcw, 
  History, 
  Trash2, 
  Database 
} from "lucide-react";
import { FALLBACK_ANALYSES } from "../data";
import { AnalysisState, SearchHistoryItem } from "../types";
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3_TITLE } from "../aminoAcids";

interface VariantSearchPanelProps {
  isDark: boolean;
  classCard: string;
  classInput: string;
  classBorderSec: string;
  showCustomInputs: boolean;
  setShowCustomInputs: (show: boolean) => void;
  customGene: string;
  setCustomGene: (val: string) => void;
  customVariant: string;
  setCustomVariant: (val: string) => void;
  customUniprot: string;
  setCustomUniprot: (val: string) => void;
  searchVal: string;
  setSearchVal: (val: string) => void;
  analysisState: AnalysisState;
  handleSearchSubmit: (e: React.FormEvent) => void;
  gene: string;
  setGene: (val: string) => void;
  variant: string;
  setVariant: (val: string) => void;
  uniprotId: string;
  setUniprotId: (val: string) => void;
  setSelectedResidueIndex: (val: number | null) => void;
  setAnalysisState: (state: any) => void;
  history: SearchHistoryItem[];
  clearHistory: () => void;
  handleSelectHistoryItem: (item: SearchHistoryItem) => void;
}

export default function VariantSearchPanel({
  isDark,
  classCard,
  classInput,
  classBorderSec,
  showCustomInputs,
  setShowCustomInputs,
  customGene,
  setCustomGene,
  customVariant,
  setCustomVariant,
  customUniprot,
  setCustomUniprot,
  searchVal,
  setSearchVal,
  analysisState,
  handleSearchSubmit,
  gene,
  setGene,
  variant,
  setVariant,
  uniprotId,
  setUniprotId,
  setSelectedResidueIndex,
  setAnalysisState,
  history,
  clearHistory,
  handleSelectHistoryItem,
}: VariantSearchPanelProps) {


  return (
    <div className={`${classCard} p-5 transition-all`} id="variant-investigator-panel">
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-sm font-semibold uppercase tracking-wider font-mono flex items-center gap-2 transition-colors ${isDark ? "text-white" : "text-slate-800"}`}>
          <Search className="w-4 h-4 text-indigo-500" />
          Variant Investigator
        </h2>
        
        <button 
          type="button"
          onClick={() => setShowCustomInputs(!showCustomInputs)}
          className="text-xs font-semibold text-indigo-500 hover:text-indigo-400 transition flex items-center gap-1.5 selection:bg-transparent cursor-pointer"
        >
          <Compass className="w-3.5 h-3.5" />
          {showCustomInputs ? "Simple Search Mode" : "Advanced Custom Mode"}
        </button>
      </div>

      <form onSubmit={handleSearchSubmit} className="space-y-4">
        {showCustomInputs ? (
          /* Advanced mode multi-inputs */
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${isDark ? "text-slate-400" : "text-slate-550"}`}>Gene Symbol</label>
              <input 
                type="text" 
                required
                placeholder="e.g. PAH"
                value={customGene}
                onChange={(e) => setCustomGene(e.target.value)}
                className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-550 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-700"}`}
              />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${isDark ? "text-slate-400" : "text-slate-550"}`}>Variant Syntax</label>
              <input 
                type="text" 
                required
                placeholder="e.g. p.Arg273Cys"
                value={customVariant}
                onChange={(e) => setCustomVariant(e.target.value)}
                className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-550 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-700"}`}
              />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${isDark ? "text-slate-400" : "text-slate-550"}`}>UniProt ID</label>
              <input 
                type="text" 
                required
                placeholder="e.g. P04637"
                value={customUniprot}
                onChange={(e) => setCustomUniprot(e.target.value)}
                className={`w-full rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-550 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-700"}`}
              />
            </div>
          </div>
        ) : (
          /* Simple mode parse search */
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search gene or variant (e.g. NAE1 p.Arg215Trp)"
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              className={`w-full rounded-lg pl-3 pr-10 py-2.5 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-550 border transition-all ${classInput} ${isDark ? "text-indigo-300" : "text-indigo-705"}`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-505">
              <Dna className="w-4 h-4 text-indigo-550 animate-pulse" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={analysisState.isLoading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-505 active:bg-indigo-700 text-white text-xs font-semibold py-2.5 px-4 rounded-lg shadow-lg shadow-indigo-900/20 transition flex items-center justify-center gap-2 disabled:bg-indigo-605/50 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {analysisState.isLoading ? "Crunching Structural Dynamics..." : "Analyze Mutation Effect"}
          </button>
          
          <button
            type="button"
            onClick={() => {
              setSearchVal("NAE1 p.Arg215Trp");
              setGene("NAE1");
              setVariant("p.Arg215Trp");
              setUniprotId("Q13564");
              setSelectedResidueIndex(215);
              setAnalysisState({
                isLoading: false,
                error: null,
                result: {
                  analysis: FALLBACK_ANALYSES["Q13564_p.Arg215Trp"],
                  metadata: {
                    gene: "NAE1",
                    variant: "p.Arg215Trp",
                    uniprotId: "Q13564",
                    residueIndex: 215,
                    wildType: "Arg",
                    mutant: "Trp"
                  }
                }
              });
            }}
            title="Restore default Q13564 startup state"
            className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
              isDark 
                ? "bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-300 border-slate-700" 
                : "bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 border-slate-200 shadow-sm"
            }`}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Search History List */}
      {history.length > 0 && (
        <div className={`mt-4 pt-4 border-t ${classBorderSec}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`block text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <History className="w-3.5 h-3.5 text-indigo-500" />
              Recent Searches
            </span>
            <button
              type="button"
              onClick={clearHistory}
              className="text-[10px] font-semibold text-rose-500 hover:text-rose-400 transition flex items-center gap-1 selection:bg-transparent cursor-pointer"
              title="Clear search history"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {history.map((item, idx) => (
              <button
                key={`${item.gene}_${item.variant}_${idx}`}
                onClick={() => handleSelectHistoryItem(item)}
                className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] transition-all flex items-center gap-1.5 cursor-pointer ${
                  gene === item.gene && variant === item.variant
                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-600 dark:text-white dark:bg-indigo-600/30 shadow-md"
                    : isDark
                      ? "bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 text-slate-300"
                      : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm"
                }`}
              >
                <span className="font-bold tracking-tight">{item.gene}</span>
                <span className="font-mono text-[9px] text-indigo-500 dark:text-indigo-300">{item.variant}</span>
              </button>
            ))}
          </div>
        </div>
      )}



      {/* Variant Coordinate Breakdown Cards */}
      {(() => {
        const clean = variant.replace(/^p\./i, "");
        const match3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
        const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
        
        let details = null;
        if (match3) {
          const wt3 = match3[1].charAt(0).toUpperCase() + match3[1].slice(1).toLowerCase();
          const pos = match3[2];
          const mut3 = match3[3].charAt(0).toUpperCase() + match3[3].slice(1).toLowerCase();
          const wt1 = AMINO_ACID_3_TO_1[wt3] || "?";
          const mut1 = AMINO_ACID_3_TO_1[mut3] || "?";
          details = { wt1, wt3, pos, mut1, mut3 };
        } else if (match1) {
          const wt1 = match1[1].toUpperCase();
          const pos = match1[2];
          const mut1 = match1[3].toUpperCase();
          const wt3 = AMINO_ACID_1_TO_3_TITLE[wt1] || wt1;
          const mut3 = AMINO_ACID_1_TO_3_TITLE[mut1] || mut1;
          details = { wt1, wt3, pos, mut1, mut3 };
        }

        if (!details) return null;

        return (
          <div className={`mt-4 pt-4 border-t ${classBorderSec} space-y-3`}>
            <span className={`block text-[10px] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <Database className="w-3.5 h-3.5 text-indigo-500" />
              Variant Coordinate Breakdown
            </span>
            <div className="grid grid-cols-2 gap-3">
              {/* Card 1: Reference Gene */}
              <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-200 shadow-sm"
              }`}>
                <span className="text-[9px] font-bold text-slate-500 uppercase font-mono">Reference Locus</span>
                <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-sm font-extrabold tracking-tight">{gene}</span>
                  <a
                    href={`https://www.uniprot.org/uniprotkb/${uniprotId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-550 hover:underline font-mono"
                    title="View UniProt entry"
                  >
                    {uniprotId} ↗
                  </a>
                </div>
              </div>

              {/* Card 2: 3D Residue Position */}
              <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-200 shadow-sm"
              }`}>
                <span className="text-[9px] font-bold text-slate-500 uppercase font-mono">Residue Position</span>
                <div className="mt-1 text-sm font-extrabold font-mono text-amber-500">
                  #{details.pos}
                </div>
              </div>

              {/* Card 3: Wild-Type Residue */}
              <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-200 shadow-sm"
              }`}>
                <span className="text-[9px] font-bold text-slate-500 uppercase font-mono">Wild-Type Residue</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">
                    {details.wt1}
                  </span>
                  <span className="font-semibold text-[11px] text-slate-600 dark:text-slate-350">{details.wt3}</span>
                </div>
              </div>

              {/* Card 4: Substituted Mutant */}
              <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-200 shadow-sm"
              }`}>
                <span className="text-[9px] font-bold text-slate-500 uppercase font-mono">Substituted Mutant</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500">
                    {details.mut1}
                  </span>
                  <span className="font-semibold text-[11px] text-indigo-650 dark:text-indigo-400">{details.mut3}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
