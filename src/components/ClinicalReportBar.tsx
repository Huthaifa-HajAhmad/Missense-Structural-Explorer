import React, { useState, useEffect, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import { 
  ChevronUp, 
  ChevronDown, 
  Copy, 
  Check, 
  FileText, 
  Sparkles, 
  RefreshCw, 
  KeyRound
} from "lucide-react";
import { AnalysisState } from "../types";
import { useSettings } from "../context/SettingsContext";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { isFallbackNarrative, setCachedVariant } from "../services/pipeline/variantCache";
import {
  AiStatusStrip,
  AcmgEvidenceList,
  EvidenceInventory,
  EnergeticsSummary,
  ReportBibliography,
  ReportSection,
  StructuralContext,
  SynthesisProvenance,
  VerdictChip,
} from "./report/ReportBlocks";
import {
  buildEvidenceInventory,
  deriveAiStatus,
  formatDeltaG,
  summarizeEvidence,
} from "./report/reportStatus";

interface ClinicalReportBarProps {
  analysisState: AnalysisState;
  isDark: boolean;
  fullPage?: boolean;  // When true: always-expanded, no toggle bar, fills container
  onRetryNarrative?: () => void;
  isNarrativeLoading?: boolean;
  /** Optional: lets the report deep-link into the Console and Literature views. */
  onNavigateToView?: (view: any) => void;
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
  isNarrativeLoading: propIsNarrativeLoading,
  onNavigateToView,
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
  const reportSections = useVariantAnalysisStore(s => s.reportSections);

  const isNarrativeLoading = propIsNarrativeLoading ?? (storeIsNarrativeLoading || isSynthesizingLocally);
  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;

  // Auto-open when a new result arrives (only relevant in bar mode)
  useEffect(() => {
    if (!fullPage && hasResult) setIsOpen(true);
  }, [hasResult, fullPage]);

  const classification = result?.clinvar?.classification ?? result?.ruleBasedInsights?.acmgVerdict ?? "";
  const narrative     = result?.analysis ?? "";
  const isFallback    = isFallbackNarrative(narrative, result?.isFallback, result?.fallbackReason);

  const verdict = classifyVerdict(classification);
  const styles  = VERDICT_STYLES[verdict];

  // ACMG criteria carry their reasons and provenance — the report renders them as evidence rows.
  const acmgCriteria = useMemo(() => {
    const items = result?.insights?.acmgCriteria?.length
      ? result.insights.acmgCriteria
      : result?.ruleBasedInsights?.acmgCriteria ?? [];
    return items as Array<{ code: string; reason?: string; source?: string }>;
  }, [result]);

  // `ruleBasedInsights.acmgVerdict` is the deterministic verdict; prefer it for the headline.
  const ruleVerdict = result?.ruleBasedInsights?.acmgVerdict;
  const headlineVerdict = ruleVerdict || result?.insights?.acmgVerdict || classification;

  const plausibility = result?.insights?.plausibility || result?.ruleBasedInsights?.plausibility || "";

  const aiStatus = useMemo(
    () =>
      deriveAiStatus({
        isFallback,
        fallbackReason: result?.fallbackReason,
        fallbackMessage: result?.fallbackMessage,
        fallbackRetryable: result?.fallbackRetryable,
        providerDetail: result?.providerDetail,
        attemptedModels: result?.attemptedModels,
        isKeyActive,
        hasNarrative: Boolean(narrative),
        isNarrativeLoading,
      }),
    [
      isFallback,
      result?.fallbackReason,
      result?.fallbackMessage,
      result?.fallbackRetryable,
      result?.providerDetail,
      result?.attemptedModels,
      isKeyActive,
      narrative,
      isNarrativeLoading,
    ]
  );

  const evidenceSources = useMemo(() => buildEvidenceInventory(result), [result]);
  const evidenceSummary = useMemo(() => summarizeEvidence(evidenceSources), [evidenceSources]);

  const handleCopy = async () => {
    if (!narrative) return;
    try {
      await navigator.clipboard.writeText(
        `${classification}\n\n${narrative}\n\nACMG Evidence: ${acmgCriteria.map(c => c.code).join(", ")}`
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
        const mergedResult = {
          ...result,
          analysis: narrativeData.analysis,
          isFallback: narrativeData.isFallback ?? false,
          fallbackReason: narrativeData.fallbackReason,
          fallbackMessage: narrativeData.fallbackMessage,
          fallbackRetryable: narrativeData.fallbackRetryable,
          providerDetail: narrativeData.providerDetail,
          attemptedModels: narrativeData.attemptedModels,
          insights: narrativeData.insights ?? result.insights
        };

        setAnalysisState(prev => (prev.result ? { ...prev, result: mergedResult } : prev));

        // Keep local cache fresh
        const targetGene = gene || result.metadata?.gene || "";
        const targetVariant = variant || result.metadata?.variant || "";
        const targetUniprot = uniprotId || result.metadata?.uniprotId || "";
        setCachedVariant(targetGene, targetVariant, targetUniprot, { analysisResult: mergedResult });

        if (narrativeData.isFallback) {
          // Report *why* it degraded rather than a generic success-shaped message.
          addNotification(
            narrativeData.fallbackRetryable === false ? "warn" : "info",
            narrativeData.fallbackMessage ||
              "AI synthesis was unavailable; the report shows database-derived evidence and rule-based ACMG criteria."
          );
        } else {
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

  // Full-page mode: the report reads as a document, with one honest status statement.
  if (fullPage) {
    return (
      <div className="report-page p-6 flex flex-col gap-5 h-full overflow-y-auto" style={{ color: "var(--cs-text-primary)" }}>

        {/* Screen title + actions */}
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="screen-title flex items-center gap-2">
              <FileText className="w-5 h-5" style={{ color: "var(--cs-accent-clay)" }} strokeWidth={1.75} />
              Clinical Report
            </h1>
            <p className="screen-tab-description">
              A structured, evidence-backed summary assembled from biophysical, evolutionary and
              clinical databases, with the provenance of every contributing source.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {narrative && !isNarrativeLoading && (
              <button
                type="button"
                onClick={handleCopy}
                className="report-press flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer shadow-sm hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                style={{
                  color: copied ? "var(--cs-good)" : "var(--cs-text-primary)",
                  background: "var(--cs-surface-2)",
                  border: "1px solid var(--cs-border)",
                }}
              >
                {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Report</>}
              </button>
            )}

            {isKeyActive ? (
              <button
                type="button"
                onClick={handleSynthesizeNarrative}
                disabled={isNarrativeLoading}
                className="report-press flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer shadow-sm bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              >
                {isNarrativeLoading ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Synthesizing…</>
                ) : isFallback ? (
                  <><Sparkles className="w-3.5 h-3.5" /> Generate AI Narrative</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5" /> Re-synthesize</>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openSettingsTab("connections")}
                className="report-press flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                style={{
                  color: "var(--cs-text-secondary)",
                  background: "var(--cs-surface-2)",
                  borderColor: "var(--cs-border)",
                }}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Configure Gemini
              </button>
            )}
          </div>
        </header>

        {/* One honest status statement — never "ready" while degraded */}
        <AiStatusStrip
          status={aiStatus}
          onRetry={handleSynthesizeNarrative}
          onOpenConsole={onNavigateToView ? () => onNavigateToView("console") : undefined}
        />

        {/* Headline verdict + synthesis provenance */}
        <div className="flex flex-wrap items-center gap-2.5">
          {headlineVerdict ? (
            <VerdictChip verdict={headlineVerdict} tone={classifyVerdict(headlineVerdict)} />
          ) : (
            <span className="text-[12.5px]" style={{ color: "var(--cs-text-muted)" }}>
              No classification available
            </span>
          )}
          <SynthesisProvenance model={(result?.insights as any)?.model} isAi={!isFallback && Boolean(narrative)} />
          {acmgCriteria.length > 0 ? (
            <span className="text-[11px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
              {acmgCriteria.length} ACMG {acmgCriteria.length === 1 ? "criterion" : "criteria"} applied
            </span>
          ) : null}
        </div>

        {/* Summary + narrative */}
        {reportSections.summary && (
          <ReportSection id="report-summary" title="Executive Summary & Clinical Narrative">
            {plausibility ? (
              <p
                className="text-[13px] leading-relaxed m-0 mb-3 pb-3"
                style={{ color: "var(--cs-text-secondary)", borderBottom: "1px solid var(--cs-border-subtle)" }}
              >
                {plausibility}
              </p>
            ) : null}

            {isNarrativeLoading ? (
              <div
                className="rounded-xl border p-5 space-y-3 animate-pulse"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
                aria-busy="true"
                aria-label="Synthesizing clinical narrative"
              >
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--cs-accent-clay)" }} />
                  <span className="text-[11px] font-mono font-semibold" style={{ color: "var(--cs-accent-clay)" }}>
                    Synthesizing narrative from curated evidence…
                  </span>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="h-3.5 rounded w-5/6" style={{ background: "var(--cs-border-subtle)" }} />
                  <div className="h-3.5 rounded w-full" style={{ background: "var(--cs-border-subtle)" }} />
                  <div className="h-3.5 rounded w-2/3" style={{ background: "var(--cs-border-subtle)" }} />
                </div>
              </div>
            ) : narrative ? (
              <div className="report-prose-wrapper">
                <div className="report-prose">
                  <Markdown
                    components={{
                      h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2">{children}</h2>,
                      h3: ({ children }) => (
                        <h3 className="text-sm font-semibold mt-4 mb-2 flex items-center gap-2 pb-1 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-5 mb-4 space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-5 mb-4 space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>{children}</strong>,
                      code: ({ children }) => (
                        <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--cs-surface-2)", border: "1px solid var(--cs-border-subtle)" }}>
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
            ) : (
              <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
                No narrative has been generated for this variant yet.
              </p>
            )}
          </ReportSection>
        )}

        {/* ACMG evidence */}
        {reportSections.acmg && (
          <ReportSection
            id="report-acmg"
            title="ACMG / AMP Pathogenicity Evidence"
            meta={
              <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                {acmgCriteria.length || "0"}
              </span>
            }
          >
            <AcmgEvidenceList criteria={acmgCriteria} />
          </ReportSection>
        )}

        {/* Energetics */}
        {reportSections.energetics && (
          <ReportSection id="report-energetics" title="Biophysical Free-Energy Calculations">
            <EnergeticsSummary result={result} formatDeltaG={formatDeltaG} />
          </ReportSection>
        )}

        {/* Structure */}
        {reportSections.structure && (
          <ReportSection id="report-structure" title="3D Macromolecular Coordinates">
            <StructuralContext
              metadata={result?.metadata}
              foldingStatus={(result as any)?.foldingStatus ?? null}
            />
          </ReportSection>
        )}

        {/* Bibliography */}
        {reportSections.literature && (
          <ReportSection id="report-literature" title="Scientific Literature Bibliography">
            <ReportBibliography gene={gene || result?.metadata?.gene || ""} variant={variant || result?.metadata?.variant || ""} />
          </ReportSection>
        )}

        {/* Provenance — always visible; it is the trust anchor of the document */}
        <ReportSection
          id="report-provenance"
          title="Evidence Provenance & Completeness"
          defaultOpen
          meta={
            <span className="font-mono" style={{ color: evidenceSummary.present === evidenceSummary.total ? "var(--cs-good)" : "var(--cs-warn)" }}>
              {evidenceSummary.present}/{evidenceSummary.total}
            </span>
          }
        >
          <EvidenceInventory
            sources={evidenceSources}
            present={evidenceSummary.present}
            total={evidenceSummary.total}
          />
          {aiStatus.diagnostics?.providerDetail ? (
            <p
              className="text-[10px] font-mono mt-3 mb-0 pt-2.5 leading-relaxed break-words"
              style={{ color: "var(--cs-text-muted)", borderTop: "1px solid var(--cs-border-subtle)" }}
            >
              Last model error: {aiStatus.diagnostics.providerDetail}
            </p>
          ) : null}
        </ReportSection>
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
            <RefreshCw className="w-3 h-3 animate-spin" /> Synthesizing…
          </span>
        )}

        {/* ACMG chips — only when open, truncated strip */}
        {isOpen && acmgCriteria.length > 0 && (
          <div className="flex items-center gap-1 overflow-hidden">
            {acmgCriteria.slice(0, 5).map((criterion) => (
              <span
                key={criterion.code}
                className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border"
                style={{
                  borderColor: "var(--cs-border)",
                  background: "var(--cs-surface-2)",
                  color: "var(--cs-text-muted)",
                }}
              >
                {criterion.code}
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
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded transition-colors cursor-pointer bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/25"
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
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-colors cursor-pointer"
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
              <span>Generating AI synthesis…</span>
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
