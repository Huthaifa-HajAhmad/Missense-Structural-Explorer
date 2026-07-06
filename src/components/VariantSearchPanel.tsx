import React, { useState } from "react";
import { Search, Dna, Sparkles, History, Trash2, ChevronDown, ChevronUp, Loader2, Clipboard } from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";

interface VariantSearchPanelProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
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

/** Reads clipboard text and calls setter. Silently ignores permission errors. */
async function pasteFromClipboard(setter: (val: string) => void) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) setter(text.trim());
  } catch {
    // clipboard access denied or unavailable — no-op
  }
}

export default function VariantSearchPanel({
  isDark,
  classCard,
  classCardHeader,
  classCardTitle,
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
  const [historyOpen, setHistoryOpen] = useState(true);

  const inputBase = `w-full rounded-lg px-3 py-2 text-[13px] outline-none border transition-all font-medium ${classInput}`;

  const PasteBtn = ({ setter }: { setter: (v: string) => void }) => (
    <button
      type="button"
      tabIndex={-1}
      title="Paste from clipboard"
      onClick={() => pasteFromClipboard(setter)}
      className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded transition-opacity cursor-pointer hover:opacity-80 active:scale-95 ${
        isDark ? "text-[#8E82A0] hover:text-[#C46849]" : "text-[#8E82A0] hover:text-[#C46849]"
      }`}
    >
      <Clipboard className="w-3 h-3" />
    </button>
  );

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all cs-fade-in`} id="variant-search-panel">
      {/* Card Header */}
      <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors ${classCardHeader}`}>
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" style={{ color: "var(--cs-accent-clay)" }} />
          <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
            Variant Query Card
          </h3>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-5 flex-1 flex flex-col gap-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2.5">
          {/* Row 1: Gene + Variant */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#8E82A0" }}>
                Gene
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="e.g. MECP2"
                  value={customGene}
                  onChange={(e) => setCustomGene(e.target.value)}
                  className={inputBase + " pr-7 font-semibold tracking-wide"}
                  style={{ fontFamily: "monospace" }}
                />
                <PasteBtn setter={setCustomGene} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#8E82A0" }}>
                Variant
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="e.g. p.Arg255Ter"
                  value={customVariant}
                  onChange={(e) => setCustomVariant(e.target.value)}
                  className={inputBase + " pr-7 font-semibold tracking-wide"}
                  style={{ fontFamily: "monospace" }}
                />
                <PasteBtn setter={setCustomVariant} />
              </div>
            </div>
          </div>

          {/* Row 2: UniProt + Analyze */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#8E82A0" }}>
                UniProt ID
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="e.g. P51587 (opt.)"
                  value={customUniprot}
                  onChange={(e) => setCustomUniprot(e.target.value)}
                  className={inputBase + " pr-7"}
                  style={{ fontFamily: "monospace" }}
                />
                <PasteBtn setter={setCustomUniprot} />
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <button
                type="submit"
                disabled={analysisState.isLoading}
                className="w-full flex items-center justify-center gap-2 rounded-lg py-2 text-[13px] font-semibold text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "#C46849" }}
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
            </div>
          </div>

          {/* Format hint */}
          <p className="text-[10px]" style={{ color: "#8E82A0" }}>
            Accepts: p.Gly380Arg · G380R · 380R (HGVS protein notation)
          </p>
        </form>

        {/* Search History */}
        {history.length > 0 && (
          <div className={`mt-3 pt-3 border-t ${classBorderSec}`}>
            <button
              type="button"
              onClick={() => setHistoryOpen(p => !p)}
              className="w-full flex items-center justify-between mb-2 cursor-pointer"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#8E82A0" }}>
                <History className="w-3 h-3" />
                Recent
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); clearHistory(); }}
                  className="text-[10px] font-semibold transition-colors cursor-pointer hover:opacity-70"
                  style={{ color: "#D946AA" }}
                  title="Clear history"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {historyOpen
                  ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "#8E82A0" }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: "#8E82A0" }} />}
              </div>
            </button>

            {historyOpen && (
              <div className="flex flex-wrap gap-1.5">
                {history.map((item, idx) => (
                  <button
                    key={`${item.gene}_${item.variant}_${idx}`}
                    onClick={() => handleSelectHistoryItem(item)}
                    className={`cs-chip text-[11px] cursor-pointer ${gene === item.gene && variant === item.variant ? "active" : ""}`}
                  >
                    <span className="font-bold" style={{ color: "#1A1523" }}>{item.gene}</span>
                    <span className="font-mono text-[9px]" style={{ color: "#D946AA" }}>{item.variant}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
