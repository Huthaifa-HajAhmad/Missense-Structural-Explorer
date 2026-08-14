import React, { useState, useEffect, useCallback } from "react";
import { 
  BookOpen, 
  Search, 
  ExternalLink, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle,
  Copy,
  CheckCircle2
} from "lucide-react";
import { useApiClient } from "../apiClient";

interface LiteratureViewProps {
  gene: string;
  variant: string;
  uniprotId: string;
}

interface Citation {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: number | null;
}

export default function LiteratureView({ gene, variant, uniprotId }: LiteratureViewProps) {
  const { apiClient } = useApiClient();
  const [citations, setCitations] = useState<Citation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCitations = useCallback(async (forceSync = false) => {
    if (!gene) return;
    setIsLoading(true);
    setError(null);
    try {
      if (forceSync) {
        setSyncing(true);
      }
      
      const data = await apiClient.getLiterature(gene, forceSync);
      setCitations(data.citations || []);
    } catch (err: any) {
      console.error("[Literature Fetch Error]:", err);
      setError(err.message || "Failed to load literature citations.");
    } finally {
      setIsLoading(false);
      setSyncing(false);
    }
  }, [gene, apiClient]);

  useEffect(() => {
    fetchCitations();
  }, [gene]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleCopyPmid = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter citations locally
  const filteredCitations = citations.filter(c => {
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.abstract.toLowerCase().includes(q) ||
      c.authors.toLowerCase().includes(q) ||
      c.journal.toLowerCase().includes(q) ||
      (c.year && String(c.year).includes(q))
    );
  });

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--cs-bg)" }}>
      {/* View Header */}
      <div className="px-5 py-4 border-b border-cs-border-subtle flex items-center justify-between bg-cs-surface-2">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-cs-accent-clay/10 text-cs-accent-clay">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-cs-text-primary">Scientific Literature</h2>
            <p className="text-[10px] text-cs-text-muted font-mono uppercase tracking-wider">
              PubMed & Europe PMC citations for {gene}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchCitations(true)}
          disabled={isLoading || syncing}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-cs-border hover:bg-cs-surface-3 transition-colors disabled:opacity-50 text-cs-text-secondary"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync PubMed"}
        </button>
      </div>

      {/* Local Filter Bar */}
      {citations.length > 0 && (
        <div className="p-3 border-b border-cs-border-subtle bg-cs-surface-1">
          <div className="relative">
            <Search className="w-4 h-4 text-cs-text-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search literature by author, title, abstract, or year..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-9 pr-4 py-2 border rounded-lg bg-cs-surface-2 border-cs-border text-cs-text-primary placeholder:text-cs-text-muted focus:outline-none focus:border-cs-accent-clay transition-colors"
            />
          </div>
        </div>
      )}

      {/* Main Literature List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && !syncing ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
            <span className="text-xs text-cs-text-muted font-mono">Loading publication index...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-200 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold text-xs uppercase tracking-wider block mb-0.5">Sync Error</span>
              <p className="text-xs text-rose-300">{error}</p>
              <button
                onClick={() => fetchCitations()}
                className="mt-2 text-xs font-bold text-cs-accent-clay hover:underline block"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : filteredCitations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-cs-border rounded-xl">
            <BookOpen className="w-8 h-8 text-cs-text-muted mb-2 opacity-40" />
            <h3 className="text-xs font-semibold text-cs-text-primary">No literature matched</h3>
            <p className="text-[11px] text-cs-text-muted mt-1 max-w-xs">
              {searchQuery 
                ? "No articles found matching your query filter. Try clearing the search bar." 
                : `We haven't indexed any functional literature for ${gene} yet. Click "Sync PubMed" above to query E-utilities.`}
            </p>
          </div>
        ) : (
          filteredCitations.map(citation => {
            const isExpanded = !!expandedIds[citation.id];
            return (
              <div 
                key={citation.id} 
                className="cs-card border border-cs-border-subtle rounded-xl bg-cs-surface-2 overflow-hidden shadow-sm hover:border-cs-border transition-all"
              >
                {/* Header Card */}
                <div 
                  onClick={() => toggleExpand(citation.id)}
                  className="px-4 py-3 cursor-pointer hover:bg-cs-surface-3 transition-colors flex items-start justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {citation.year && (
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/10">
                          {citation.year}
                        </span>
                      )}
                      <span className="text-[10px] font-semibold text-cs-text-muted truncate max-w-[200px]" title={citation.journal}>
                        {citation.journal}
                      </span>
                      <span className="text-[10px] text-cs-text-muted font-mono">
                        PMID: {citation.id}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold leading-relaxed text-cs-text-primary text-pretty font-serif">
                      {citation.title}
                    </h4>
                    <p className="text-[10px] text-cs-text-secondary truncate">
                      {citation.authors}
                    </p>
                  </div>
                  
                  <div className="text-cs-text-muted p-1 shrink-0">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Expanded Abstract Section */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-cs-border-subtle bg-cs-surface-1/50 space-y-3">
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold font-mono text-cs-text-muted uppercase tracking-wider block">Abstract</span>
                      <p className="text-xs text-cs-text-secondary leading-relaxed text-pretty whitespace-pre-line">
                        {citation.abstract}
                      </p>
                    </div>

                    {/* Actions bar */}
                    <div className="flex items-center gap-3 pt-2 border-t border-cs-border-subtle">
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${citation.id}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] font-semibold text-cs-accent-clay hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View on PubMed
                      </a>
                      <button
                        onClick={(e) => handleCopyPmid(citation.id, e)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-cs-text-muted hover:text-cs-text-primary"
                      >
                        {copiedId === citation.id ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            PMID Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy PMID
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
