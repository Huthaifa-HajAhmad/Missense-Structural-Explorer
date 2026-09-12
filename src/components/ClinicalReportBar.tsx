import React, { useState, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import { 
  ChevronUp, 
  ChevronDown, 
  Copy, 
  Check, 
  FileText, 
  Sparkles, 
  RefreshCw, 
  KeyRound, 
  ExternalLink,
  ShieldAlert,
  Cpu
} from "lucide-react";
import { AnalysisState } from "../types";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { isFallbackNarrative, setCachedVariant } from "../services/pipeline/variantCache";

interface ClinicalReportBarProps {
  analysisState: AnalysisState;
  isDark: boolean;
  fullPage?: boolean;  // When true: always-expanded, no toggle bar, fills container
  onRetryNarrative?: () => void;
  isNarrativeLoading?: boolean;
}

function classifyVerdict(classification: string): "pathogenic" | "benign" | "uncertain" | "none" {
  const c = classification.toLowerCase();
  if (c.includes("pathogenic") && !c.includes("benign")) return "pathogenic";
  if (c.includes("benign")) return "benign";
  if (c.includes("uncertain") || c.includes("vus")) return "uncertain";
  return "none";
}

const VERDICT_STYLES = {
  pathogenic: {
    badge: "bg-red-500/10 text-red-500 border border-red-500/25",
    dot:   "bg-red-500",
  },
  benign: {
    badge: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/25",
    dot:   "bg-emerald-500",
  },
  uncertain: {
    badge: "bg-amber-500/10 text-amber-600 border border-amber-500/25",
    dot:   "bg-amber-500",
  },
  none: {
    badge: "bg-slate-500/10 text-slate-500 border border-slate-500/20",
    dot:   "bg-slate-500",
  },
};

function ClinicalReportBar({ 
  analysisState, 
  isDark, 
  fullPage = false,
  onRetryNarrative: propOnRetryNarrative,
  isNarrativeLoading: propIsNarrativeLoading
}: ClinicalReportBarProps) {
  const result = analysisState.result;
  const hasResult = !!result;
  const [isOpen, setIsOpen] = useState(fullPage ? true : false);
  const [copied, setCopied] = useState(false);
  const [isSynthesizingLocally, setIsSynthesizingLocally] = useState(false);

  const { openSettingsTab, hasConfiguredGeminiKey, serverGeminiReady, settings } = useSettings();
  const { apiClient } = useApiClient();

  const storeIsNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const userDirections = useVariantAnalysisStore(s => s.userDirections);
  const setAnalysisState = useVariantAnalysisStore(s => s.setAnalysisState);
  const setIsNarrativeLoading = useVariantAnalysisStore(s => s.setIsNarrativeLoading);
  const addNotification = useVariantAnalysisStore(s => s.addNotification);

  const isNarrativeLoading = propIsNarrativeLoading ?? (storeIsNarrativeLoading || isSynthesizingLocally);
  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;

  // Auto-open when a new result arrives (only relevant in bar mode)
  useEffect(() => {
    if (!fullPage && hasResult) setIsOpen(true);
  }, [hasResult, fullPage]);

  const classification = result?.clinvar?.classification ?? result?.ruleBasedInsights?.acmgVerdict ?? "";
  const narrative     = result?.analysis ?? "";
  const acmgCriteria  = (result?.insights?.acmgCriteria ?? result?.ruleBasedInsights?.acmgCriteria ?? []).map(c => c.code);
  const isFallback    = isFallbackNarrative(narrative, result?.isFallback);

  const verdict = classifyVerdict(classification);
  const styles  = VERDICT_STYLES[verdict];

  const handleCopy = async () => {
    if (!narrative) return;
    try {
      await navigator.clipboard.writeText(
        `${classification}\n\n${narrative}\n\nACMG Evidence: ${acmgCriteria.join(", ")}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied
    }
  };

  const handleSynthesizeNarrative = useCallback(async () => {
    if (propOnRetryNarrative) {
      propOnRetryNarrative();
      return;
    }
    if (!result) return;

    setIsSynthesizingLocally(true);
    setIsNarrativeLoading(true);

    try {
      const narrativeData = await apiClient.getNarrative({
        gene: gene || result.metadata?.gene || "",
        variant: variant || result.metadata?.variant || "",
        uniprotId: uniprotId || result.metadata?.uniprotId || "",
        userDirections: userDirections || undefined,
        acmgWeighting: settings.acmgWeighting,
        clinvar: result.clinvar || null,
        predictorData: result.predictorData || null,
        conservationData: result.conservationData || null,
        stringInteractions: result.stringInteractions || null,
        gnomadConstraint: result.gnomadConstraint || null,
        gnomadFrequency: result.gnomadFrequency || null,
        uniprotFeatures: result.uniprotFeatures || null,
        sequence: (result.metadata as any)?.sequence || null
      });

      if (narrativeData?.analysis) {
        setAnalysisState(prev => {
          if (!prev.result) return prev;
          const updatedResult = {
            ...prev.result,
            analysis: narrativeData.analysis,
            isFallback: narrativeData.isFallback ?? false,
            fallbackReason: narrativeData.fallbackReason,
            insights: narrativeData.insights ?? prev.result.insights
          };
          return {
            ...prev,
            result: updatedResult
          };
        });

        // Keep local cache fresh
        const targetGene = gene || result.metadata?.gene || "";
        const targetVariant = variant || result.metadata?.variant || "";
        const targetUniprot = uniprotId || result.metadata?.uniprotId || "";
        setCachedVariant(targetGene, targetVariant, targetUniprot, {
          analysisResult: {
            ...result,
            analysis: narrativeData.analysis,
            isFallback: narrativeData.isFallback ?? false,
            fallbackReason: narrativeData.fallbackReason ?? null,
            insights: narrativeData.insights ?? result.insights
          }
        });

        if (!narrativeData.isFallback) {
          addNotification(
            "success",
            "Clinical report updated with calibrated multi-layer Gemini insights."
          );
        }
      }
    } catch (err: any) {
      addNotification(
        "error",
        err.message || "Failed to generate AI narrative from Gemini API."
      );
    } finally {
      setIsSynthesizingLocally(false);
      setIsNarrativeLoading(false);
    }
  }, [
    propOnRetryNarrative,
    result,
    apiClient,
    gene,
    variant,
    uniprotId,
    userDirections,
    settings.acmgWeighting,
    setAnalysisState,
    setIsNarrativeLoading,
    addNotification
  ]);

  if (!hasResult && !isNarrativeLoading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8" style={{ color: "var(--cs-text-muted)" }}>
      <FileText className="w-8 h-8 opacity-30" />
      <p className="text-sm">No analysis loaded. Run a variant query to generate a clinical report.</p>
    </div>
  );

  // Full-page mode: expanded always, no bar chrome
  if (fullPage) {
    return (
      <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto" style={{ color: "var(--cs-text-primary)" }}>

        {/* Screen title + description */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="screen-title flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              Clinical Report
            </h1>
            <p className="screen-tab-description">
              A structured, evidence-backed narrative summary synthesized across biophysical, evolutionary, and clinical databases.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {narrative && !isNarrativeLoading && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-sm hover:brightness-110 active:scale-95"
                style={{
                  color: copied ? "var(--cs-good)" : "var(--cs-text-primary)",
                  background: "var(--cs-surface-2)",
                  border: "1px solid var(--cs-border)",
                }}
              >
                {copied ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Report</>}
              </button>
            )}

            {isKeyActive && (
              <button
                type="button"
                onClick={handleSynthesizeNarrative}
                disabled={isNarrativeLoading}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer shadow-sm bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isNarrativeLoading ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Synthesizing...</>
                ) : isFallback ? (
                  <><Sparkles className="w-3.5 h-3.5" /> Generate AI Narrative</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5" /> Re-synthesize</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* AI Activation / Fallback Status Banner */}
        {isFallback && !isNarrativeLoading && (
          <div 
            className="rounded-xl border p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all"
            style={{ 
              background: isKeyActive 
                ? "linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)" 
                : "rgba(245, 158, 11, 0.07)",
              borderColor: isKeyActive ? "rgba(99, 102, 241, 0.25)" : "rgba(245, 158, 11, 0.25)"
            }}
          >
            <div className="flex items-start gap-3">
              {isKeyActive ? (
                <Cpu className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              )}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: isKeyActive ? "var(--cs-accent-clay)" : "var(--cs-warn)" }}>
                  {isKeyActive ? "AI Session Token Ready — Synthesize Live Report" : "Gemini API Session Token Not Linked"}
                </h4>
                <p className="text-xs leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                  {isKeyActive 
                    ? "A valid Gemini credentials session is active. You can now generate an in-depth AI synthesis combining FoldX, AlphaMissense, PopEVE, and ACMG codes."
                    : "Currently viewing rule-based fallback report. Connect your Gemini API key in Settings for calibrated multi-layer clinical reasoning and literature integration."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-stretch md:self-auto flex-shrink-0">
              {isKeyActive ? (
                <button
                  type="button"
                  onClick={handleSynthesizeNarrative}
                  className="w-full md:w-auto flex items-center justify-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg transition-all cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white shadow-md active:scale-95"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Synthesize AI Narrative Now
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openSettingsTab("connections")}
                  className="w-full md:w-auto flex items-center justify-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg transition-all cursor-pointer bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 active:scale-95"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Configure Gemini Key
                </button>
              )}
            </div>
          </div>
        )}

        {/* Classification verdict & chips */}
        <div className="flex flex-wrap items-center gap-4">
          {classification && (
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1 rounded-full ${styles.badge}`}>
                <span className={`w-2 h-2 rounded-full animate-pulse ${styles.dot}`} />
                {classification}
              </span>
            </div>
          )}

          {!isFallback && !isNarrativeLoading && narrative && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              Gemini 2.5 Synthesized
            </span>
          )}

          {/* ACMG criteria chips */}
          {acmgCriteria.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest font-mono mr-1" style={{ color: "var(--cs-text-muted)" }}>
                ACMG:
              </span>
              {acmgCriteria.map((code: string) => (
                <span
                  key={code}
                  className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded border"
                  style={{
                    borderColor: "var(--cs-border)",
                    background: "var(--cs-surface-2)",
                    color: "var(--cs-text-secondary)",
                  }}
                >
                  {code}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Narrative Shimmer Loading Skeleton */}
        {isNarrativeLoading && (
          <div className="report-prose-wrapper w-full">
            <div 
              className="rounded-2xl border p-6 space-y-4 animate-pulse"
              style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
            >
              <div className="flex items-center gap-3">
                <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                <span className="text-xs font-mono font-semibold text-indigo-400 tracking-wide">
                  Synthesizing clinical evidence and ACMG criteria with Gemini 2.5...
                </span>
              </div>
              <div className="space-y-2.5 pt-2">
                <div className="h-4 bg-slate-700/30 rounded w-5/6" />
                <div className="h-4 bg-slate-700/30 rounded w-full" />
                <div className="h-4 bg-slate-700/30 rounded w-4/6" />
              </div>
              <div className="space-y-2.5 pt-4">
                <div className="h-4 bg-slate-700/30 rounded w-1/3" />
                <div className="h-4 bg-slate-700/30 rounded w-full" />
                <div className="h-4 bg-slate-700/30 rounded w-11/12" />
                <div className="h-4 bg-slate-700/30 rounded w-3/4" />
              </div>
            </div>
          </div>
        )}

        {/* Narrative — editorial serif prose rendered with react-markdown */}
        {!isNarrativeLoading && narrative && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p
                className="text-[10px] font-bold uppercase tracking-widest font-mono"
                style={{ color: "var(--cs-text-muted)" }}
              >
                Clinical Narrative
              </p>
            </div>

            {/* 72ch reading column with Lora serif */}
            <div className="report-prose-wrapper">
              <div className="report-prose">
                <Markdown
                  components={{
                    h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2">{children}</h2>,
                    h3: ({ children }) => (
                      <h3 className="text-sm font-semibold mt-4 mb-2 flex items-center gap-2 pb-1 border-b" style={{ borderColor: "var(--cs-border)" }}>
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 mb-4 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 mb-4 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>{children}</strong>,
                    code: ({ children }) => (
                      <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--cs-surface-2)", border: "1px solid var(--cs-border)" }}>
                        {children}
                      </code>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 pl-4 italic my-3" style={{ borderColor: "var(--cs-accent-clay)", color: "var(--cs-text-secondary)" }}>
                        {children}
                      </blockquote>
                    )
                  }}
                >
                  {narrative}
                </Markdown>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`report-bar ${isOpen ? "open" : "closed"}`}
      style={{ background: "var(--cs-surface)" }}
    >
      {/* Clickable header strip */}
      <div
        className="report-bar-header"
        onClick={() => setIsOpen((p) => !p)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => e.key === "Enter" && setIsOpen((p) => !p)}
      >
        <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--cs-accent-clay)" }} />

        {/* Classification badge */}
        {classification && (
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${styles.dot}`} />
            {classification}
          </span>
        )}

        {isNarrativeLoading && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-indigo-400">
            <RefreshCw className="w-3 h-3 animate-spin" /> Synthesizing...
          </span>
        )}

        {/* ACMG chips — only when open, truncated strip */}
        {isOpen && acmgCriteria.length > 0 && (
          <div className="flex items-center gap-1 overflow-hidden">
            {acmgCriteria.slice(0, 5).map((code: string) => (
              <span
                key={code}
                className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border"
                style={{
                  borderColor: "var(--cs-border)",
                  background: "var(--cs-surface-2)",
                  color: "var(--cs-text-muted)",
                }}
              >
                {code}
              </span>
            ))}
            {acmgCriteria.length > 5 && (
              <span className="text-[9px]" style={{ color: "var(--cs-text-muted)" }}>
                +{acmgCriteria.length - 5}
              </span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Re-synthesize button in bar mode */}
          {isOpen && isKeyActive && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleSynthesizeNarrative(); }}
              disabled={isNarrativeLoading}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded transition-all cursor-pointer bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/25"
              title="Generate fresh AI narrative"
            >
              <Sparkles className="w-3 h-3" />
              <span>{isFallback ? "AI Synthesize" : "Re-run"}</span>
            </button>
          )}

          {/* Copy button — only visible when open */}
          {isOpen && narrative && !isNarrativeLoading && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-all cursor-pointer"
              style={{
                color: copied ? "var(--cs-good)" : "var(--cs-text-muted)",
                background: "var(--cs-surface-2)",
                border: "1px solid var(--cs-border)",
              }}
              aria-label="Copy clinical report"
            >
              {copied
                ? <><Check className="w-3 h-3" /> Copied</>
                : <><Copy className="w-3 h-3" /> Copy Report</>}
            </button>
          )}

          {/* Chevron */}
          {isOpen
            ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--cs-text-muted)" }} />
            : <ChevronUp   className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--cs-text-muted)" }} />}
        </div>
      </div>

      {/* Narrative text rendered via Markdown */}
      {isOpen && (
        <div className="report-bar-content">
          {isNarrativeLoading ? (
            <div className="flex items-center gap-2 p-3 text-xs text-indigo-400 animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Generating AI synthesis...</span>
            </div>
          ) : narrative ? (
            <div 
              className="text-[11.5px] leading-relaxed markdown-prose-compact"
              style={{ color: "var(--cs-text-secondary)", fontFamily: "var(--cs-font-sans)" }}
            >
              <Markdown
                components={{
                  h1: ({ children }) => <h1 className="text-xs font-bold mt-2 mb-1">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-xs font-semibold mt-2 mb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-[11px] font-semibold mt-2 mb-0.5 text-indigo-300">{children}</h3>,
                  p: ({ children }) => <p className="mb-2">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li className="leading-normal">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold text-slate-200">{children}</strong>
                }}
              >
                {narrative}
              </Markdown>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default React.memo(ClinicalReportBar);

