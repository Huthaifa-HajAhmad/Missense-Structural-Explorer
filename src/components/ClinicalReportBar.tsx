import React, { useState, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import { 
  Copy, 
  Check, 
  FileText, 
  Sparkles, 
  RefreshCw, 
  KeyRound,
  Compass,
  Maximize2,
  Minimize2
} from "lucide-react";
import { AnalysisState } from "../types";
import { useSettings } from "../context/SettingsContext";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { isFallbackNarrative } from "../services/pipeline/variantCache";
import { useNarrativeResynthesis } from "../hooks/useNarrativeResynthesis";
import { variantNumberingView } from "../shared/numbering";
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
  isDark, 
  onRetryNarrative: propOnRetryNarrative,
  isNarrativeLoading: propIsNarrativeLoading,
  onNavigateToView,
}: ClinicalReportBarProps) {
  const result = analysisState.result;
  const hasResult = !!result;
  const [copied, setCopied] = useState(false);

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
    setSectionOpenState(prev => ({ ...prev, [sectionKey]: true }));
    setTimeout(() => {
      const el = document.getElementById(`report-${sectionKey}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }, []);

  const { openSettingsTab, hasConfiguredGeminiKey, serverGeminiReady } = useSettings();

  const storeIsNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const addNotification = useVariantAnalysisStore(s => s.addNotification);
  const reportSections = useVariantAnalysisStore(s => s.reportSections);

  // One re-synthesis path, shared with the Residue Shifts inspector. The report used to
  // own the only implementation, so no other surface could offer a retry at all.
  const { resynthesize, isResynthesizing } = useNarrativeResynthesis();

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

  const isNarrativeLoading = propIsNarrativeLoading ?? (storeIsNarrativeLoading || isResynthesizing);
  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;

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

  const evidenceSources = useMemo(
    () => buildEvidenceInventory(result, storeFoldingEnergetics, storeFoldingDdG),
    [result, storeFoldingEnergetics, storeFoldingDdG]
  );
  const evidenceSummary = useMemo(() => summarizeEvidence(evidenceSources), [evidenceSources]);

  // EHR-Ready structured clinical assessment export
  const handleCopy = async () => {
    if (!result && !hasResult) return;
    const dateStr = new Date().toISOString().split("T")[0];
    const lines = [
      "=======================================================",
      "CLINICAL GENOMICS & BIOPHYSICAL ASSESSMENT REPORT",
      "=======================================================",
      `Gene:               ${gene || result?.metadata?.gene || "Unknown"}`,
      `Reported Variant:   ${numbering.reported || numbering.display}`,
      `Modelled Variant:   ${numbering.modelled}`,
      `Canonical UniProt:  ${uniprotId || result?.metadata?.uniprotId || "N/A"}`,
      numbering.reportedTranscriptId ? `Transcript:         ${numbering.reportedTranscriptId}` : null,
      numbering.basisNote ? `Numbering Note:     ${numbering.basisNote}` : null,
      `Assessment Date:    ${dateStr}`,
      `Headline Verdict:   ${headlineVerdict || "No classification available"}`,
      plausibility ? `Plausibility:       ${plausibility}` : null,
      "-------------------------------------------------------",
      "ACMG / AMP EVIDENCE CRITERIA",
      "-------------------------------------------------------",
      acmgCriteria.length > 0
        ? acmgCriteria.map((c) => `[${c.code}] ${c.reason || "Applied"}${c.source ? ` (Source: ${c.source})` : ""}`).join("\n")
        : "No ACMG/AMP criteria recorded.",
      "-------------------------------------------------------",
      "BIOPHYSICAL STABILITY & FREE-ENERGY ESTIMATES",
      "-------------------------------------------------------",
      `FoldX ΔΔG:          ${formatDeltaG(storeFoldingEnergetics?.foldx ?? storeFoldingEnergetics?.foldxMean ?? storeFoldingDdG ?? (result as any)?.foldingDdG)}`,
      (storeFoldingEnergetics?.consensusVerdict || (result as any)?.consensusVerdict)
        ? `Consensus Verdict:  ${storeFoldingEnergetics?.consensusVerdict ?? (result as any)?.consensusVerdict}${
            typeof (storeFoldingEnergetics?.consensusProbability ?? (result as any)?.consensusProbability) === "number"
              ? ` (P = ${(((storeFoldingEnergetics?.consensusProbability ?? (result as any)?.consensusProbability) as number) * 100).toFixed(0)}%)`
              : ""
          }${
            typeof (storeFoldingEnergetics?.consensusConfMin ?? (result as any)?.consensusConfMin) === "number" &&
            typeof (storeFoldingEnergetics?.consensusConfMax ?? (result as any)?.consensusConfMax) === "number"
              ? `, 95% CI: [${formatDeltaG(storeFoldingEnergetics?.consensusConfMin ?? (result as any)?.consensusConfMin)}, ${formatDeltaG(storeFoldingEnergetics?.consensusConfMax ?? (result as any)?.consensusConfMax)}]`
              : ""
          }`
        : null,
      (storeFoldingEnergetics?.dynamut2 ?? (result as any)?.dynamut2) != null
        ? `DynaMut2 ΔΔG:       ${formatDeltaG(storeFoldingEnergetics?.dynamut2 ?? (result as any)?.dynamut2)}`
        : null,
      (storeFoldingEnergetics?.ddmut ?? (result as any)?.ddmut) != null
        ? `DDMut ΔΔG:          ${formatDeltaG(storeFoldingEnergetics?.ddmut ?? (result as any)?.ddmut)}`
        : null,
      (storeFoldingEnergetics?.thermompnn ?? (result as any)?.thermompnn) != null
        ? `ThermoMPNN ΔΔG:     ${formatDeltaG(storeFoldingEnergetics?.thermompnn ?? (result as any)?.thermompnn)}`
        : null,
      (storeFoldingEnergetics?.rasp ?? (result as any)?.rasp) != null
        ? `RaSP ΔΔG:           ${formatDeltaG(storeFoldingEnergetics?.rasp ?? (result as any)?.rasp)}`
        : null,
      (storeFoldingEnergetics?.stabilityoracle ?? (result as any)?.stabilityoracle) != null
        ? `StabilityOracle ΔΔG: ${formatDeltaG(storeFoldingEnergetics?.stabilityoracle ?? (result as any)?.stabilityoracle)}`
        : null,
      "-------------------------------------------------------",
      "CLINICAL NARRATIVE & SYNTHESIS",
      "-------------------------------------------------------",
      narrative || "No narrative generated. Rule-based databases and structural metrics recorded above.",
      "=======================================================",
      `Evidence Completeness: ${evidenceSummary.present} of ${evidenceSummary.total} sources retrieved.`,
      "Generated by Missense Structural Explorer (Validated Biomolecular Protocol)"
    ].filter(Boolean).join("\n");

    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addNotification("success", "Structured EHR assessment copied to clipboard.");
    } catch {
      addNotification("error", "Unable to access clipboard.");
    }
  };

  const handleSynthesizeNarrative = useCallback(async () => {
    if (propOnRetryNarrative) {
      propOnRetryNarrative();
      return;
    }
    await resynthesize();
  }, [propOnRetryNarrative, resynthesize]);

  if (!hasResult && !isNarrativeLoading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-8" style={{ color: "var(--cs-text-muted)" }}>
      <FileText className="w-8 h-8 opacity-30" />
      <p className="text-sm">No analysis loaded. Run a variant query to generate a clinical report.</p>
    </div>
  );

  return (
    <div className="report-page p-6 flex flex-col gap-5 w-full shrink-0" style={{ color: "var(--cs-text-primary)" }}>

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

        <div className="flex items-center gap-2 shrink-0 report-screen-only">
          {hasResult && !isNarrativeLoading && (
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
              className="report-press flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer shadow-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
              style={{
                background: "var(--cs-accent-clay)",
                color: "#FFFFFF",
              }}
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

      {/* Sticky Table of Contents (TOC) Toolbar */}
      <nav
        aria-label="Report Table of Contents"
        className="report-screen-only sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl border backdrop-blur-md shadow-sm"
        style={{
          background: "color-mix(in srgb, var(--cs-surface) 88%, transparent)",
          borderColor: "var(--cs-border-subtle)",
        }}
      >
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10.5px] font-mono uppercase tracking-wider font-semibold px-2 py-0.5 text-cs-text-muted flex items-center gap-1">
            <Compass className="w-3 h-3 text-cs-accent-clay" strokeWidth={1.75} />
            Jump to:
          </span>
          {reportSections.summary && (
            <button
              type="button"
              onClick={() => handleNavigateSection("summary")}
              className="report-press text-[11px] font-medium px-2 py-1 rounded-md transition-colors hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            >
              Summary
            </button>
          )}
          {reportSections.acmg && (
            <button
              type="button"
              onClick={() => handleNavigateSection("acmg")}
              className="report-press text-[11px] font-medium px-2 py-1 rounded-md transition-colors hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            >
              ACMG ({acmgCriteria.length})
            </button>
          )}
          {reportSections.energetics && (
            <button
              type="button"
              onClick={() => handleNavigateSection("energetics")}
              className="report-press text-[11px] font-medium px-2 py-1 rounded-md transition-colors hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            >
              Energetics
            </button>
          )}
          {reportSections.structure && (
            <button
              type="button"
              onClick={() => handleNavigateSection("structure")}
              className="report-press text-[11px] font-medium px-2 py-1 rounded-md transition-colors hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            >
              Structure
            </button>
          )}
          {reportSections.literature && (
            <button
              type="button"
              onClick={() => handleNavigateSection("literature")}
              className="report-press text-[11px] font-medium px-2 py-1 rounded-md transition-colors hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            >
              Literature
            </button>
          )}
          <button
            type="button"
            onClick={() => handleNavigateSection("provenance")}
            className="report-press text-[11px] font-medium px-2 py-1 rounded-md transition-colors hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
          >
            Provenance ({evidenceSummary.present}/{evidenceSummary.total})
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={expandAll}
            className="report-press flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-md border border-cs-border-subtle bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            title="Expand all report sections"
          >
            <Maximize2 className="w-3 h-3 text-cs-accent-clay" strokeWidth={1.75} />
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="report-press flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-md border border-cs-border-subtle bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-secondary hover:text-cs-text-primary"
            title="Collapse all report sections"
          >
            <Minimize2 className="w-3 h-3 text-cs-accent-clay" strokeWidth={1.75} />
            Collapse all
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

export default React.memo(ClinicalReportBar);
