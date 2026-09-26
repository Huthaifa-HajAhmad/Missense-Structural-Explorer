import React, { useState, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import { 
  FileText, 
  RefreshCw, 
  Compass,
  Maximize2,
  Minimize2
} from "lucide-react";
import { AnalysisState } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import type { ReportSectionKey } from "../stores/slices/uiSlice";
import { isFallbackNarrative } from "../services/pipeline/variantCache";
import { variantNumberingView } from "../shared/numbering";
import {
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
  formatDeltaG,
  summarizeEvidence,
} from "./report/reportStatus";

interface ClinicalReportBarProps {
  analysisState: AnalysisState;
  isDark: boolean;
  fullPage?: boolean;  // Kept for 100% type backwards compatibility
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

function ClinicalReportBar({ 
  analysisState, 
  isDark: _isDark, 
  onRetryNarrative: _onRetryNarrative,
  isNarrativeLoading: propIsNarrativeLoading,
  onNavigateToView,
}: ClinicalReportBarProps) {
  const result = analysisState.result;
  const hasResult = !!result;

  const reportSections = useVariantAnalysisStore(s => s.reportSections);
  const toggleReportSection = useVariantAnalysisStore(s => s.toggleReportSection);

  // Section disclosure state for controlled expand / collapse
  const [sectionOpenState, setSectionOpenState] = useState<Record<string, boolean>>({
    summary: true,
    acmg: true,
    energetics: true,
    structure: true,
    literature: false,
    provenance: true,
  });

  const toggleSection = useCallback((key: string) => {
    setSectionOpenState(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const expandAll = useCallback(() => {
    setSectionOpenState({
      summary: true,
      acmg: true,
      energetics: true,
      structure: true,
      literature: true,
      provenance: true,
    });
  }, []);

  const collapseAll = useCallback(() => {
    setSectionOpenState({
      summary: false,
      acmg: false,
      energetics: false,
      structure: false,
      literature: false,
      provenance: false,
    });
  }, []);

  const handleNavigateSection = useCallback((sectionKey: string) => {
    // If the section is disabled in store reportSections, re-enable it so it mounts in the DOM
    const key = sectionKey as ReportSectionKey;
    if (reportSections && reportSections[key] === false) {
      toggleReportSection(key);
    }
    setSectionOpenState(prev => ({ ...prev, [sectionKey]: true }));
    setTimeout(() => {
      const el = document.getElementById(`report-${sectionKey}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }, [reportSections, toggleReportSection]);

  const storeIsNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);

  // Live biophysical state subscriptions
  const storeFoldingEnergetics = useVariantAnalysisStore(
    s => s.primaryBiophysics?.foldingEnergetics ?? s.foldingEnergetics
  );
  const storeFoldingDdG = useVariantAnalysisStore(
    s => s.primaryBiophysics?.foldingDdG ?? s.foldingDdG
  );
  const storeFoldingStatus = useVariantAnalysisStore(
    s => s.primaryBiophysics?.foldingStatus ?? s.foldingStatus
  );

  const isNarrativeLoading = propIsNarrativeLoading ?? storeIsNarrativeLoading;

  const classification = result?.clinvar?.classification ?? result?.ruleBasedInsights?.acmgVerdict ?? "";
  const narrative     = result?.analysis ?? "";
  const isFallback    = isFallbackNarrative(narrative, result?.isFallback, result?.fallbackReason);

  // ACMG criteria carry their reasons and provenance
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

  // Unified numbering view across reported vs modelled coordinates
  const numbering = useMemo(
    () =>
      variantNumberingView({
        variant: variant || result?.metadata?.variant || "",
        uniprotId: uniprotId || result?.metadata?.uniprotId || null,
        numberingRemap:
          (result as any)?.numberingRemap ?? (result?.metadata as any)?.numberingRemap ?? null,
      }),
    [variant, uniprotId, result]
  );

  const evidenceSources = useMemo(
    () => buildEvidenceInventory(result, storeFoldingEnergetics, storeFoldingDdG),
    [result, storeFoldingEnergetics, storeFoldingDdG]
  );
  const evidenceSummary = useMemo(() => summarizeEvidence(evidenceSources), [evidenceSources]);

  if (!hasResult && !isNarrativeLoading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8" style={{ color: "var(--cs-text-muted)" }}>
      <FileText className="w-8 h-8 opacity-30" />
      <p className="text-sm">No analysis loaded. Run a variant query to generate a clinical report.</p>
    </div>
  );

  return (
    <div className="report-page p-6 flex flex-col gap-5 w-full shrink-0" style={{ color: "var(--cs-text-primary)" }}>

      {/* Screen title */}
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
      </header>

      {/* Laboratory Document Masthead */}
      <div
        className="report-masthead rounded-xl border p-4 sm:p-5 flex flex-col gap-3.5"
        style={{
          background: "var(--cs-surface)",
          borderColor: "var(--cs-border-subtle)",
          boxShadow: "var(--cs-shadow-card, none)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: "var(--cs-accent-clay)" }}>
              Clinical Genomics & Biophysical Assessment
            </span>
            <h2 className="text-base sm:text-lg font-bold m-0 tracking-tight" style={{ color: "var(--cs-text-primary)" }}>
              Structure-Function Variant Diagnostic Summary
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-[10.5px] font-mono px-2 py-0.5 rounded border"
              style={{
                background: "var(--cs-surface-2)",
                borderColor: "var(--cs-border)",
                color: "var(--cs-text-muted)",
              }}
            >
              MSE Protocol v2.5
            </span>
            <span className="text-[11px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
              {new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="block text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
              Gene Symbol
            </span>
            <span className="font-bold text-sm font-sans" style={{ color: "var(--cs-text-primary)" }}>
              {gene || result?.metadata?.gene || "—"}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
              Reported Variant
            </span>
            <span className="font-mono font-semibold text-xs text-cs-text-primary">
              {numbering.reported ? `${numbering.reported}${numbering.reportedBasisId ? ` (${numbering.reportedBasisId})` : ""}` : numbering.display}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
              Modelled Canonical
            </span>
            <span className="font-mono font-medium text-xs text-cs-text-primary">
              {numbering.modelled}{uniprotId ? ` (${uniprotId})` : ""}
            </span>
          </div>

          <div>
            <span className="block text-[10px] font-mono uppercase tracking-wider text-cs-text-muted">
              Transcript / RefSeq
            </span>
            <span className="font-mono text-xs text-cs-text-primary">
              {numbering.reportedTranscriptId || numbering.reportedRefSeqId || (result?.metadata as any)?.transcriptId || "MANE Select"}
            </span>
          </div>
        </div>

        {numbering.basisNote && (
          <div
            className="text-[11px] font-mono px-2.5 py-1.5 rounded border leading-relaxed"
            style={{
              background: "var(--cs-surface-2)",
              borderColor: "var(--cs-border-subtle)",
              color: "var(--cs-text-secondary)",
            }}
          >
            <span className="font-semibold" style={{ color: "var(--cs-accent-clay)" }}>Numbering Basis: </span>
            {numbering.basisNote}
          </div>
        )}
      </div>

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

      {/* Sticky Table of Contents (TOC) Toolbar */}
      <nav
        aria-label="Report Table of Contents"
        className="report-screen-only sticky top-0 z-10 flex items-center justify-between gap-3 px-3 py-2 rounded-xl border backdrop-blur-md shadow-sm"
        style={{
          background: "color-mix(in srgb, var(--cs-surface) 92%, transparent)",
          borderColor: "var(--cs-border-subtle)",
        }}
      >
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 py-0.5">
          <span className="shrink-0 text-[10.5px] font-mono uppercase tracking-wider font-semibold text-cs-text-muted flex items-center gap-1 mr-1">
            <Compass className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
            Jump to:
          </span>
          {reportSections.summary && (
            <button
              type="button"
              onClick={() => handleNavigateSection("summary")}
              className="report-press shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle/60"
            >
              Summary
            </button>
          )}
          {reportSections.acmg && (
            <button
              type="button"
              onClick={() => handleNavigateSection("acmg")}
              className="report-press shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle/60"
            >
              <span>ACMG</span>
              <span className="px-1.5 py-0.2 rounded-full text-[9.5px] font-mono font-semibold bg-cs-surface border border-cs-border-subtle text-cs-accent-clay">
                {acmgCriteria.length}
              </span>
            </button>
          )}
          {reportSections.energetics && (
            <button
              type="button"
              onClick={() => handleNavigateSection("energetics")}
              className="report-press shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle/60"
            >
              Energetics
            </button>
          )}
          {reportSections.structure && (
            <button
              type="button"
              onClick={() => handleNavigateSection("structure")}
              className="report-press shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle/60"
            >
              Structure
            </button>
          )}
          {reportSections.literature && (
            <button
              type="button"
              onClick={() => handleNavigateSection("literature")}
              className="report-press shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle/60"
            >
              Literature
            </button>
          )}
          <button
            type="button"
            onClick={() => handleNavigateSection("provenance")}
            className="report-press shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary border border-cs-border-subtle/60"
          >
            <span>Provenance</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9.5px] font-mono font-semibold bg-cs-surface border border-cs-border-subtle text-cs-text-secondary">
              {evidenceSummary.present}/{evidenceSummary.total}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-cs-border-subtle">
          <button
            type="button"
            onClick={expandAll}
            className="report-press flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-md border border-cs-border-subtle bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            title="Expand all report sections"
          >
            <Maximize2 className="w-3 h-3 text-cs-accent-clay" strokeWidth={1.75} />
            <span>Expand all</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="report-press flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-md border border-cs-border-subtle bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            title="Collapse all report sections"
          >
            <Minimize2 className="w-3 h-3 text-cs-accent-clay" strokeWidth={1.75} />
            <span>Collapse all</span>
          </button>
        </div>
      </nav>

      {/* Summary + narrative */}
      {reportSections.summary && (
        <ReportSection
          id="report-summary"
          title="Executive Summary & Clinical Narrative"
          isOpen={sectionOpenState.summary}
          onToggle={() => toggleSection("summary")}
        >
          {plausibility ? (
            <div
              className="p-3.5 rounded-xl border mb-4 flex items-start gap-2.5 text-[13px] leading-relaxed"
              style={{
                background: "color-mix(in srgb, var(--cs-accent-clay) 5%, var(--cs-surface-2))",
                borderColor: "color-mix(in srgb, var(--cs-accent-clay) 20%, var(--cs-border-subtle))",
              }}
            >
              <FileText className="w-4 h-4 mt-0.5 shrink-0 text-cs-accent-clay" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] font-mono uppercase tracking-wider font-bold text-cs-accent-clay mb-0.5">
                  Clinical Plausibility & Prior Assessment
                </span>
                <p className="m-0 text-[12.5px] leading-relaxed text-cs-text-primary text-justify">
                  {plausibility}
                </p>
              </div>
            </div>
          ) : null}

          {isNarrativeLoading ? (
            <div
              className="rounded-xl border p-5 space-y-3 animate-pulse"
              style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
              aria-busy="true"
              aria-label="Synthesizing clinical narrative"
            >
              <div className="flex items-center gap-2.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-cs-accent-clay" />
                <span className="text-[11px] font-mono font-semibold text-cs-accent-clay">
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
            <div className="report-prose-wrapper w-full">
              <div className="report-prose">
                <Markdown
                  components={{
                    h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 pb-1 border-b border-cs-border-subtle">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2 pb-1 border-b border-cs-border-subtle">{children}</h2>,
                    h3: ({ children }) => (
                      <h3 className="text-sm font-semibold mt-4 mb-2 flex items-center gap-2 pb-1 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => <p className="mb-4 leading-relaxed text-justify">{children}</p>,
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
              No narrative has been generated for this variant yet. Use the Report Generator inspector on the right to synthesize.
            </p>
          )}
        </ReportSection>
      )}

      {/* ACMG evidence */}
      {reportSections.acmg && (
        <ReportSection
          id="report-acmg"
          title="ACMG / AMP Pathogenicity Evidence"
          isOpen={sectionOpenState.acmg}
          onToggle={() => toggleSection("acmg")}
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
        <ReportSection
          id="report-energetics"
          title="Biophysical Free-Energy Calculations"
          isOpen={sectionOpenState.energetics}
          onToggle={() => toggleSection("energetics")}
        >
          <EnergeticsSummary
            energetics={storeFoldingEnergetics}
            foldingDdG={storeFoldingDdG}
            result={result}
            formatDeltaG={formatDeltaG}
          />
        </ReportSection>
      )}

      {/* Structure */}
      {reportSections.structure && (
        <ReportSection
          id="report-structure"
          title="3D Macromolecular Coordinates"
          isOpen={sectionOpenState.structure}
          onToggle={() => toggleSection("structure")}
        >
          <StructuralContext
            metadata={result?.metadata}
            foldingStatus={storeFoldingStatus ?? (result as any)?.foldingStatus ?? null}
          />
        </ReportSection>
      )}

      {/* Bibliography */}
      {reportSections.literature && (
        <ReportSection
          id="report-literature"
          title="Scientific Literature Bibliography"
          isOpen={sectionOpenState.literature}
          onToggle={() => toggleSection("literature")}
        >
          <ReportBibliography gene={gene || result?.metadata?.gene || ""} variant={variant || result?.metadata?.variant || ""} />
        </ReportSection>
      )}

      {/* Provenance — always visible; it is the trust anchor of the document */}
      <ReportSection
        id="report-provenance"
        title="Evidence Provenance & Completeness"
        isOpen={sectionOpenState.provenance}
        onToggle={() => toggleSection("provenance")}
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
          onNavigateSection={handleNavigateSection}
        />
        {result?.providerDetail ? (
          <p
            className="text-[10px] font-mono mt-3 mb-0 pt-2.5 leading-relaxed break-words"
            style={{ color: "var(--cs-text-muted)", borderTop: "1px solid var(--cs-border-subtle)" }}
          >
            Last model error: {result.providerDetail}
          </p>
        ) : null}
      </ReportSection>
    </div>
  );
}

export default React.memo(ClinicalReportBar);
