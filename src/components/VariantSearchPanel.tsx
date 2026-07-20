import React, { useState } from "react";
import { 
  Search, 
  Dna, 
  Sparkles, 
  History, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  Clipboard, 
  ShieldAlert,
  CheckCircle2,
  Circle,
  Zap,
  HelpCircle,
  ArrowRight,
  Layers,
  Activity,
  BarChart2,
  Map
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { MasterView } from "./MasterSidebar";
import { useVariantAnalysisContext } from "../context/VariantAnalysisContext";

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
  onViewChange?: (view: MasterView) => void;
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
  onViewChange,
}: VariantSearchPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const context = useVariantAnalysisContext();
  const userDirections = context?.state?.userDirections ?? "";
  const setUserDirections = context?.actions?.setUserDirections ?? (() => {});
  const loadingStep = context?.state?.loadingStep ?? "";
  const isFolding = context?.state?.isFolding ?? false;
  const isBiophysicalLoading = context?.state?.isBiophysicalLoading ?? false;
  const result = analysisState.result;

  const inputBase = `w-full rounded-lg px-3 py-2 text-[13px] outline-none border transition-all font-medium ${classInput}`;

  const PasteBtn = ({ setter }: { setter: (v: string) => void }) => (
    <button
      type="button"
      tabIndex={-1}
      title="Paste from clipboard"
      onClick={() => pasteFromClipboard(setter)}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded transition-opacity cursor-pointer text-[#8F897E] hover:text-[#C46849] active:scale-95"
    >
      <Clipboard className="w-3.5 h-3.5" />
    </button>
  );

  // Derive stage status & metrics for live workflow rail
  const getStageInfo = (stage: "evidence" | "structure" | "energetics" | "landscape") => {
    if (result) {
      if (stage === "evidence") {
        const clinvarText = result.clinvar?.classification || "Annotated";
        return { status: "Complete", desc: `ClinVar: ${clinvarText} · ACMG rules evaluated` };
      }
      if (stage === "structure") {
        return { status: "Complete", desc: `AlphaFold / PDB 3D coordinates ready` };
      }
      if (stage === "energetics") {
        if (isBiophysicalLoading) {
          return { status: "In Progress", desc: "Modeling PyRosetta & FoldX biophysical force-fields..." };
        }
        const ddgVal = result.foldingEnergetics?.foldx ?? result.foldingEnergetics?.dynamut2 ?? result.foldingEnergetics?.ddmut ?? result.dynamut2;
        const ddgText = ddgVal != null ? `ΔΔG = ${ddgVal > 0 ? "+" : ""}${ddgVal.toFixed(2)} kcal/mol` : "Biophysical force-field active";
        return { status: "Complete", desc: ddgText };
      }
      if (stage === "landscape") {
        const count = result.landscapeData?.length ?? 0;
        return { status: "Complete", desc: `${count} residue positions mapped & scored` };
      }
    }

    if (analysisState.isLoading) {
      const stepMatch = (loadingStep || "").match(/Step (\d+)\/4/);
      const currentStep = stepMatch ? parseInt(stepMatch[1], 10) : 1;
      
      if (stage === "evidence") return { status: currentStep === 1 ? "In Progress" : currentStep > 1 ? "Complete" : "Pending", desc: loadingStep || "Running evidence query..." };
      if (stage === "structure") return { status: currentStep === 2 ? "In Progress" : currentStep > 2 ? "Complete" : "Pending", desc: "Predicting 3D atomic coordinates..." };
      if (stage === "landscape") return { status: currentStep === 3 ? "In Progress" : currentStep > 3 ? "Complete" : "Pending", desc: "Mapping spatial mutation density..." };
      if (stage === "energetics") return { status: currentStep === 4 ? "In Progress" : currentStep > 4 ? "Complete" : "Pending", desc: "Calculating ΔΔG stability changes..." };
    }

    return { status: "Ready", desc: stage === "evidence" ? "ClinVar, gnomAD & ACMG rules engine" : stage === "structure" ? "AlphaFold DB & PDB 3D coordinates" : stage === "energetics" ? "FoldX, PyRosetta & EvoEF2 free-energy calculation" : "3D spatial mutation mapping & pocket impact" };
  };

  return (
    <div className="w-full flex flex-col gap-6 cs-fade-in no-scrollbar" id="variant-search-workspace">
      {/* ── Screen Header & Context Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--cs-border-subtle)]">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="p-1.5 rounded-lg bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)]">
              <Dna className="w-4 h-4" />
            </span>
            <h1 
              className="text-[20px] font-medium tracking-tight"
              style={{ color: "var(--cs-text-primary)" }}
            >
              Variant Analysis Workspace
            </h1>
          </div>
          <p className="text-[13px] max-w-3xl leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
            Enter target gene symbol, HGVS variant notation, and optional UniProt accession to run real-time structural, energetic, and clinical evidence pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <span className="badge-data-source">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Pipeline Online
          </span>
          <span className="badge-data-source">
            <Zap className="w-3 h-3" />
            v2.4 Engine
          </span>
        </div>
      </div>

      {/* ── Main Workspace Card (Flat 1px Hairline Border, No Elevation Shadow) ── */}
      <div 
        className="rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-none overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--cs-border-subtle)]">
          {/* ── LEFT COLUMN: Search Variant Form (col-span-7) ── */}
          <div className="lg:col-span-7 p-6 lg:p-7 flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--cs-text-primary)" }}>
                  <Search className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                  Search Variant
                </h2>
              </div>

              <form onSubmit={handleSearchSubmit} className="flex flex-col gap-4">
                {/* Row 1: Gene + Variant */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label 
                      className="text-[12px] font-medium flex justify-between items-center"
                      style={{ color: "var(--cs-text-secondary)" }}
                    >
                      <span>Gene Symbol <span className="text-rose-500">*</span></span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        placeholder="e.g. CNNM2"
                        value={customGene}
                        onChange={(e) => setCustomGene(e.target.value)}
                        className={inputBase + " pr-9 font-semibold tracking-wide uppercase"}
                        style={{ fontFamily: "var(--cs-font-mono)" }}
                      />
                      <PasteBtn setter={setCustomGene} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label 
                      className="text-[12px] font-medium flex justify-between items-center"
                      style={{ color: "var(--cs-text-secondary)" }}
                    >
                      <span>Variant Notation <span className="text-rose-500">*</span></span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        placeholder="e.g. p.Gly380Arg"
                        value={customVariant}
                        onChange={(e) => setCustomVariant(e.target.value)}
                        className={inputBase + " pr-9 font-semibold tracking-wide"}
                        style={{ fontFamily: "var(--cs-font-mono)" }}
                      />
                      <PasteBtn setter={setCustomVariant} />
                    </div>
                  </div>
                </div>

                {/* Row 2: UniProt ID (Optional) */}
                <div className="flex flex-col gap-1.5">
                  <label 
                    className="text-[12px] font-medium flex justify-between items-center"
                    style={{ color: "var(--cs-text-secondary)" }}
                  >
                    <span>UniProt Accession (Optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Q9H8M5 (Auto-resolved if omitted)"
                      value={customUniprot}
                      onChange={(e) => setCustomUniprot(e.target.value)}
                      className={inputBase + " pr-9 uppercase"}
                      style={{ fontFamily: "var(--cs-font-mono)" }}
                    />
                    <PasteBtn setter={setCustomUniprot} />
                  </div>
                </div>

                {/* AI Focus Area / Custom Instructions (Collapsible) */}
                <div className="border border-[var(--cs-border)] rounded-lg overflow-hidden bg-[var(--cs-surface-2)] transition-all">
                  <details className="group">
                    <summary className="flex justify-between items-center px-3.5 py-2.5 text-xs font-medium select-none cursor-pointer transition-colors hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                        AI Focus Area & Custom Analysis Instructions
                      </span>
                      <span className="transition-transform group-open:rotate-180 text-[var(--cs-text-muted)]">
                        <ChevronDown className="w-4 h-4" />
                      </span>
                    </summary>
                    <div className="p-3.5 border-t border-[var(--cs-border-subtle)] space-y-2.5">
                      <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] leading-relaxed flex gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <span style={{ color: "var(--cs-text-secondary)" }}>
                          <strong>Privacy Notice:</strong> Filtered workspace. Do not submit patient PII (names, MRNs, dates of birth).
                        </span>
                      </div>
                      <textarea
                        placeholder="e.g. Focus on structural disruption of cofactor binding loop, evaluate ACMG PM2/PS3 rules, or analyze active site residue proximity..."
                        value={userDirections}
                        onChange={(e) => {
                          const text = e.target.value.slice(0, 2000);
                          setUserDirections(text);
                        }}
                        maxLength={2000}
                        className="w-full h-20 rounded-md border p-2.5 text-xs outline-none bg-[var(--cs-surface)] resize-none border-[var(--cs-border)]"
                        style={{ color: "var(--cs-text-primary)" }}
                      />
                      <div className="flex justify-between items-center text-[10px]" style={{ color: "var(--cs-text-muted)" }}>
                        <span>Directs downstream AI narrative synthesis</span>
                        <span>{userDirections.length}/2000 chars</span>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Submit Action Button */}
                <button
                  type="submit"
                  disabled={analysisState.isLoading}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-[14px] font-semibold text-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-none hover:brightness-105 active:scale-[0.99]"
                  style={{ background: "var(--cs-accent-clay)" }}
                >
                  {analysisState.isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Executing Pipeline Analysis…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Analyze Variant
                      <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
                    </>
                  )}
                </button>
              </form>

              {/* Format Help Box (Plain Text Container Box replacing former example cards) */}
              <div className="mt-4 p-3.5 rounded-lg border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] text-[12px] flex items-start gap-3">
                <HelpCircle className="w-4 h-4 text-[var(--cs-accent-clay)] shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <span className="font-semibold block text-[12px]" style={{ color: "var(--cs-text-primary)" }}>
                    Supported Input Formats & Conventions
                  </span>
                  <div className="text-[11px] leading-relaxed space-y-0.5" style={{ color: "var(--cs-text-secondary)" }}>
                    <div>• <strong>Protein HGVS:</strong> <code className="font-mono">p.Gly380Arg</code>, <code className="font-mono">G380R</code>, <code className="font-mono">380R</code></div>
                    <div>• <strong>cDNA HGVS:</strong> <code className="font-mono">c.123A&gt;G</code></div>
                    <div>• <strong>ClinVar ID:</strong> <code className="font-mono">VCV000013920</code></div>
                    <div>• <strong>Gene Symbol:</strong> <code className="font-mono">CNNM2</code>, <code className="font-mono">MECP2</code>, <code className="font-mono">KIF1A</code> (HUGO symbol)</div>
                    <div>• <strong>UniProt Accession:</strong> <code className="font-mono">Q9H8M5</code>, <code className="font-mono">P51587</code> (Swiss-Prot ID)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Live & Interactive Workflow Pipeline Rail (col-span-5) ── */}
          <div className="lg:col-span-5 p-6 lg:p-7 bg-[var(--cs-surface-2)] flex flex-col justify-between gap-6">
            <div>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--cs-border-subtle)]">
                <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--cs-text-primary)" }}>
                  <Layers className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                  Workflow Pipeline
                </h2>
                <span className={result ? "text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-1.5" : "badge-data-source flex items-center gap-1.5"}>
                  <Activity className={`w-3 h-3 ${result ? "text-emerald-500" : "text-[var(--cs-accent-clay)]"}`} />
                  {analysisState.isLoading ? "Live Execution" : result ? "Result Loaded" : "Est. ~30 sec"}
                </span>
              </div>

              {/* Workflow Live Stages List */}
              <div className="space-y-3">
                {[
                  { key: "evidence", title: "Evidence Pipeline", Icon: BarChart2, targetView: "evidence" as MasterView },
                  { key: "structure", title: "3D Structure", Icon: Layers, targetView: "structure" as MasterView },
                  { key: "energetics", title: "Energetics Engine", Icon: Activity, targetView: "energetics" as MasterView },
                  { key: "landscape", title: "Landscape Minimap", Icon: Map, targetView: "landscape" as MasterView },
                ].map(({ key, title, Icon, targetView }) => {
                  const info = getStageInfo(key as any);
                  const isClickable = !!result && !!onViewChange;
                  return (
                    <div 
                      key={key}
                      onClick={() => isClickable && onViewChange?.(targetView)}
                      className={`p-3 rounded-lg border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] flex items-start gap-3 transition-all ${
                        isClickable ? "cursor-pointer hover:border-[var(--cs-accent-clay)] hover:shadow-sm" : ""
                      }`}
                    >
                      {info.status === "In Progress" || info.status === "Computing" ? (
                        <span className="cs-spinner cs-spinner-sm shrink-0 mt-1" />
                      ) : info.status === "Complete" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-4 h-4 text-[var(--cs-text-muted)] shrink-0 mt-0.5" />
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "var(--cs-text-primary)" }}>
                            <Icon className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
                            {title}
                          </span>
                          <span className={info.status === "Complete" ? "text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600" : "badge-data-source"}>
                            {info.status}
                          </span>
                        </div>
                        <p className="text-[11px] mt-1 leading-snug" style={{ color: "var(--cs-text-secondary)" }}>
                          {info.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pipeline Live Status Footer */}
            <div className="p-3 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] text-[11px] leading-relaxed flex items-center justify-between" style={{ color: "var(--cs-text-muted)" }}>
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[var(--cs-accent-clay)] shrink-0" />
                {analysisState.isLoading ? loadingStep || "Processing query..." : result ? "Click any stage card to open analysis tab" : "Parallel biophysical computation engine"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── LOWER SECTION: Recent Searches ── */}
      {history.length > 0 && (
        <div className={`p-4 rounded-xl border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-none ${classBorderSec}`}>
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setHistoryOpen(p => !p)}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <span className="p-1 rounded bg-[var(--cs-surface-2)] text-[var(--cs-accent-clay)] group-hover:bg-[var(--cs-bg-subtle)] transition-colors">
                <History className="w-3.5 h-3.5" />
              </span>
              <span className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: "var(--cs-text-secondary)" }}>
                Recent Searches ({history.length})
              </span>
              {historyOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
              )}
            </button>

            <button
              type="button"
              onClick={clearHistory}
              className="text-[11px] font-medium flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer hover:bg-rose-500/10 text-[var(--cs-text-muted)] hover:text-rose-500"
              title="Clear search history"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>

          {historyOpen && (
            <div className="flex flex-wrap gap-2 pt-1">
              {history.map((item, idx) => (
                <button
                  key={`${item.gene}_${item.variant}_${idx}`}
                  onClick={() => handleSelectHistoryItem(item)}
                  className="px-3 py-1.5 rounded-lg text-[12px] cursor-pointer flex items-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98]"
                  style={{
                    background: gene === item.gene && variant === item.variant
                      ? "var(--cs-accent-mag-soft)" : "var(--cs-surface-2)",
                    border: gene === item.gene && variant === item.variant
                      ? "1px solid var(--cs-accent-clay)" : "1px solid var(--cs-border)",
                  }}
                >
                  <span className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                    {item.gene}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--cs-text-secondary)" }}>
                    {item.variant}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
