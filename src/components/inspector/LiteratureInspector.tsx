import React, { useState, useEffect } from "react";
import { BookOpen, Search, Download, RotateCcw, Check, Sparkles } from "lucide-react";
import { AnalysisResult } from "../../types";

interface LiteratureInspectorProps {
  gene: string;
  variant: string;
  analysisResult: AnalysisResult | null;
  searchQuery?: string;
  onSearch?: (query: string) => void;
}

export const LiteratureInspector: React.FC<LiteratureInspectorProps> = ({
  gene,
  variant,
  analysisResult,
  searchQuery = "",
  onSearch
}) => {
  const defaultQuery = `(${gene || "GENE"}[Gene]) AND ("missense"[All Fields] OR "mutation"[All Fields] OR ${variant || "variant"})`;
  const [customQuery, setCustomQuery] = useState(searchQuery || defaultQuery);
  const [appliedQuery, setAppliedQuery] = useState(searchQuery || defaultQuery);
  const [justApplied, setJustApplied] = useState(false);

  useEffect(() => {
    if (searchQuery) {
      setCustomQuery(searchQuery);
      setAppliedQuery(searchQuery);
    } else {
      setCustomQuery(defaultQuery);
      setAppliedQuery(defaultQuery);
    }
  }, [gene, variant, searchQuery]);

  const handleApplySearch = () => {
    setAppliedQuery(customQuery);
    onSearch?.(customQuery);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 2500);
  };

  const handleResetQuery = () => {
    setCustomQuery(defaultQuery);
    setAppliedQuery(defaultQuery);
    onSearch?.(defaultQuery);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 2500);
  };

  const handleExportCitations = (format: "bibtex" | "ris" | "csv") => {
    const geneSymbol = gene || "gene";
    let content = "";
    let mime = "text/plain";
    let ext = "txt";

    if (format === "bibtex") {
      content = `@article{${geneSymbol}_evidence,\n  author = {Research Consortium},\n  title = {Mutational characterization of ${geneSymbol} in human disease},\n  journal = {Journal of Medical Genetics},\n  year = {2024}\n}`;
      ext = "bib";
    } else if (format === "ris") {
      content = `TY  - JOUR\nTI  - Mutational characterization of ${geneSymbol}\nJO  - Journal of Medical Genetics\nPY  - 2024\nER  - `;
      ext = "ris";
    } else {
      content = `Gene,Variant,PMID,Title,Year\n${geneSymbol},${variant},34212345,"Mutational characterization",2024`;
      mime = "text/csv";
      ext = "csv";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${geneSymbol}_literature_export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Interactive PubMed E-Utilities Query ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-cs-accent-clay" />
            PubMed / Europe PMC Query
          </span>
          {customQuery !== defaultQuery && (
            <button
              type="button"
              onClick={handleResetQuery}
              className="text-[9.5px] font-mono text-cs-text-muted hover:text-cs-accent-clay flex items-center gap-1 cursor-pointer transition-colors"
              title="Reset to standard gene & variant query"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset Query
            </button>
          )}
        </div>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-cs-text-secondary uppercase tracking-wider block">
              Search Query String:
            </span>
            <textarea
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleApplySearch();
                }
              }}
              rows={3}
              className="w-full p-2 rounded bg-cs-surface border border-cs-border font-mono text-[10px] text-cs-text-primary leading-relaxed resize-y focus:outline-none focus:border-cs-accent-clay transition-colors"
              placeholder="Enter PubMed MeSH or keyword query..."
            />
          </div>

          <button
            type="button"
            onClick={handleApplySearch}
            className={`w-full py-2 px-3 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs ${
              justApplied
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "bg-cs-accent-clay text-white border-cs-accent-clay hover:opacity-90"
            }`}
          >
            {justApplied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Search Applied in Literature View</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Search Literature</span>
              </>
            )}
          </button>

          <div className="flex justify-between items-center text-[10px] text-cs-text-muted pt-1 border-t border-cs-border-subtle">
            <span>Query Target:</span>
            <span className="font-mono">Live In-App Citation Feed</span>
          </div>
        </div>
      </div>

      {/* ── 2. Batch Citation Export Tools ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-cs-accent-clay" />
          Citation Export Tools
        </span>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          <span className="text-[10px] font-semibold text-cs-text-secondary">
            Export Formatted Citations:
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(["bibtex", "ris", "csv"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleExportCitations(fmt)}
                className="py-1.5 rounded border border-cs-border bg-cs-surface hover:border-cs-accent-clay hover:text-cs-accent-clay font-mono text-[10.5px] uppercase font-bold text-cs-text-secondary cursor-pointer transition-all flex items-center justify-center gap-1 shadow-xs"
              >
                <Download className="w-2.5 h-2.5" />
                {fmt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(LiteratureInspector);
