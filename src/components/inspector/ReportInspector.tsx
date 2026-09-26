import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText, Download, CheckSquare, Square, ShieldCheck, Printer, AlertTriangle, Lock,
  Sparkles, RefreshCw, KeyRound, Terminal, Check, Copy,
} from "lucide-react";
import { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useSettings } from "../../context/SettingsContext";
import type { ReportSectionKey } from "../../stores/slices/uiSlice";
import { isFallbackNarrative } from "../../services/pipeline/variantCache";
import { generateProvenanceManifest } from "../../shared/provenance";
import { variantNumberingView } from "../../shared/numbering";
import { acmgCriteriaView } from "../../shared/acmgCriteriaView";
import {
  buildEvidenceInventory,
  computeReportFingerprint,
  deriveAiStatus,
  generateStructuredEhrReport,
  summarizeEvidence,
} from "../report/reportStatus";

interface ReportInspectorProps {
  analysisResult: AnalysisResult | null;
  gene: string;
  variant: string;
  onRetryNarrative?: () => void | Promise<void>;
  isNarrativeLoading?: boolean;
  onNavigateToView?: (view: any) => void;
}

/**
 * Report section toggles.
 *
 * These are ordered to match the report body top-to-bottom, and every toggle genuinely
 * includes/excludes its section — the previous version kept private local state that no other
 * component read, so "Section Filters" filtered nothing while still claiming to.
 */
const REPORT_SECTIONS: Array<{ key: ReportSectionKey; label: string; hint: string }> = [
  { key: "summary", label: "Executive Summary & Clinical Narrative", hint: "Verdict, plausibility, narrative prose" },
  { key: "acmg", label: "ACMG / AMP Pathogenicity Evidence", hint: "Criteria codes with justifications" },
  { key: "energetics", label: "Biophysical Free-Energy Calculations", hint: "FoldX / DynaMut2 / DDMut ΔΔG" },
  { key: "structure", label: "3D Macromolecular Coordinates", hint: "Model, source, residue context" },
  { key: "literature", label: "Scientific Literature Bibliography", hint: "Indexed publications for this gene" },
];

export const ReportInspector: React.FC<ReportInspectorProps> = ({
  analysisResult,
  gene,
  variant,
  onRetryNarrative,
  isNarrativeLoading: propIsNarrativeLoading,
  onNavigateToView,
}) => {
  const reportSections = useVariantAnalysisStore((s) => s.reportSections);
  const toggleReportSection = useVariantAnalysisStore((s) => s.toggleReportSection);
  const uniprotId = useVariantAnalysisStore((s) => s.uniprotId);
  const storeFoldingEnergetics = useVariantAnalysisStore(
    (s) => s.primaryBiophysics?.foldingEnergetics ?? s.foldingEnergetics
  );
  const storeFoldingDdG = useVariantAnalysisStore(
    (s) => s.primaryBiophysics?.foldingDdG ?? s.foldingDdG
  );
  const storeIsNarrativeLoading = useVariantAnalysisStore((s) => s.isNarrativeLoading);
  const addNotification = useVariantAnalysisStore((s) => s.addNotification);

  const { openSettingsTab, hasConfiguredGeminiKey, serverGeminiReady, settings } = useSettings();
  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;

  const isNarrativeBusy = propIsNarrativeLoading ?? storeIsNarrativeLoading;
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const includedCount = useMemo(
    () => REPORT_SECTIONS.filter((section) => reportSections[section.key]).length,
    [reportSections]
  );

  const evidence = useMemo(
    () => summarizeEvidence(buildEvidenceInventory(analysisResult, storeFoldingEnergetics, storeFoldingDdG)),
    [analysisResult, storeFoldingEnergetics, storeFoldingDdG]
  );

  /**
   * Whether the AI narrative in this report is a degraded, rule-based one.
   */
  const isDegraded = isFallbackNarrative(
    analysisResult?.analysis,
    analysisResult?.isFallback,
    analysisResult?.fallbackReason
  );

  const narrative = analysisResult?.analysis ?? "";

  const aiStatus = useMemo(
    () =>
      deriveAiStatus({
        isFallback: isDegraded,
        fallbackReason: analysisResult?.fallbackReason,
        fallbackMessage: analysisResult?.fallbackMessage,
        fallbackRetryable: analysisResult?.fallbackRetryable,
        providerDetail: analysisResult?.providerDetail,
        attemptedModels: analysisResult?.attemptedModels,
        isKeyActive,
        hasNarrative: Boolean(narrative),
        isNarrativeLoading: isNarrativeBusy,
      }),
    [
      isDegraded,
      analysisResult?.fallbackReason,
      analysisResult?.fallbackMessage,
      analysisResult?.fallbackRetryable,
      analysisResult?.providerDetail,
      analysisResult?.attemptedModels,
      isKeyActive,
      narrative,
      isNarrativeBusy,
    ]
  );

  const numbering = useMemo(
    () =>
      variantNumberingView({
        variant: variant || analysisResult?.metadata?.variant || "",
        uniprotId: uniprotId || analysisResult?.metadata?.uniprotId || null,
        numberingRemap:
          (analysisResult as any)?.numberingRemap ?? (analysisResult?.metadata as any)?.numberingRemap ?? null,
      }),
    [variant, uniprotId, analysisResult]
  );

  /**
   * Through the shared view — see the note on the same memo in `ClinicalReportBar`. This list also
   * feeds `handleCopyReport` below, so leaving it untagged made the report rail's "Copy Report
   * (EHR / Text)" emit a different document from the Insights view's button of the same name.
   */
  const acmgCriteria = useMemo(
    () =>
      acmgCriteriaView(
        analysisResult?.insights?.acmgCriteria,
        analysisResult?.ruleBasedInsights?.acmgCriteria
      ),
    [analysisResult]
  );

  const ruleVerdict = analysisResult?.ruleBasedInsights?.acmgVerdict;
  const headlineVerdict = ruleVerdict || analysisResult?.insights?.acmgVerdict || analysisResult?.clinvar?.classification || "";
  const plausibility = analysisResult?.insights?.plausibility || analysisResult?.ruleBasedInsights?.plausibility || "";

  const handleSynthesize = useCallback(async () => {
    if (onRetryNarrative) {
      await onRetryNarrative();
    }
  }, [onRetryNarrative]);

  const handleCopyReport = async () => {
    if (!analysisResult) return;
    const reportText = generateStructuredEhrReport({
      gene,
      variant,
      reportedVariant: numbering.reported ? `${numbering.reported}${numbering.reportedBasisId ? ` (${numbering.reportedBasisId})` : ""}` : numbering.display,
      modelledVariant: numbering.modelled,
      uniprotId,
      reportedTranscriptId: numbering.reportedTranscriptId || numbering.reportedRefSeqId || (analysisResult?.metadata as any)?.transcriptId || "MANE Select",
      basisNote: numbering.basisNote,
      headlineVerdict,
      plausibility,
      acmgCriteria,
      energetics: storeFoldingEnergetics,
      foldingDdG: storeFoldingDdG,
      result: analysisResult,
      narrative,
      evidenceSummary: evidence,
      sections: reportSections,
    });

    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addNotification("success", "Structured EHR assessment copied to clipboard.");
    } catch {
      addNotification("error", "Unable to access clipboard.");
    }
  };

  useEffect(() => {
    let active = true;
    if (!analysisResult) {
      setFingerprint(null);
      return;
    }
    computeReportFingerprint({
      gene,
      variant,
      result: analysisResult,
      energetics: storeFoldingEnergetics,
      foldingDdG: storeFoldingDdG,
      sections: reportSections,
    })
      .then((res) => {
        if (active) setFingerprint(res?.digest ?? null);
      })
      .catch(() => {
        if (active) setFingerprint(null);
      });
    return () => {
      active = false;
    };
  }, [analysisResult, gene, variant, reportSections, storeFoldingEnergetics, storeFoldingDdG]);

  const handlePrintPdf = () => {
    window.print();
  };

  /**
   * Export the report bundle as JSON with verifiable cryptographic audit hash and
   * standardized algorithmic provenance manifest.
   */
  const handleExportJson = () => {
    if (!analysisResult) return;

    const manifest = generateProvenanceManifest(
      gene,
      variant,
      uniprotId || analysisResult.metadata?.uniprotId || "",
      analysisResult,
      { acmgWeighting: settings.acmgWeighting },
      storeFoldingEnergetics
    );

    const reportData = {
      reportType: "Clinical Missense Structural Variant Assessment",
      schema: "mse.clinical-report/2.5",
      note: "Standardized MSE clinical report bundle with verified provenance manifest.",
      generatedAt: new Date().toISOString(),
      reportFingerprintSha256: fingerprint,
      gene,
      variant,
      sectionsIncluded: REPORT_SECTIONS.reduce<Record<string, boolean>>((acc, section) => {
        acc[section.key] = reportSections[section.key];
        return acc;
      }, {}),
      narrativeProvenance: {
        isAiSynthesized: !isDegraded,
        fallbackReason: analysisResult.fallbackReason ?? null,
        attemptedModels: analysisResult.attemptedModels ?? [],
      },
      evidenceCompleteness: evidence,
      provenanceManifest: manifest,
      data: {
        ...analysisResult,
        foldingEnergetics: storeFoldingEnergetics ?? (analysisResult as any).foldingEnergetics,
        foldingDdG: storeFoldingDdG ?? (analysisResult as any).foldingDdG,
      }
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeGene = (gene || "variant").replace(/[<>:"/\\|?*\s]+/g, "_");
    const safeVariant = (variant || "report").replace(/[<>:"/\\|?*\s]+/g, "_");
    a.download = `${safeGene}_${safeVariant}_clinical_summary.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 0. AI Synthesis & Status ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
            AI Synthesis & Status
          </span>
          <span
            className={`font-mono text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
              aiStatus.tone === "good"
                ? "bg-cs-good/15 text-cs-good border border-cs-good/30"
                : aiStatus.tone === "warn"
                ? "bg-cs-warn/15 text-cs-warn border border-cs-warn/30"
                : "bg-cs-surface-2 text-cs-text-muted border border-cs-border"
            }`}
          >
            {aiStatus.label}
          </span>
        </span>

        <div className="p-3 rounded-2xl border border-cs-border-subtle bg-cs-surface-2 flex flex-col gap-2.5">
          <p className="text-[11.5px] leading-relaxed text-cs-text-secondary m-0">
            {aiStatus.detail}
          </p>

          {aiStatus.diagnostics?.attemptedModels?.length ? (
            <div className="text-[10px] font-mono text-cs-text-muted truncate pt-1 border-t border-cs-border-subtle" title={aiStatus.diagnostics.attemptedModels.join(" → ")}>
              Models: <span className="text-cs-text-secondary">{aiStatus.diagnostics.attemptedModels.join(" → ")}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-0.5">
            {isKeyActive ? (
              <button
                type="button"
                onClick={handleSynthesize}
                disabled={isNarrativeBusy}
                className="report-press flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-white font-semibold text-[11px] cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                style={{ background: "var(--cs-accent-clay)" }}
              >
                {isNarrativeBusy ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Synthesizing…</>
                ) : isDegraded ? (
                  <><Sparkles className="w-3.5 h-3.5" /> Generate AI Narrative</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5" /> Re-synthesize</>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openSettingsTab("connections")}
                className="report-press flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-cs-border bg-cs-surface hover:bg-cs-bg-subtle text-cs-text-secondary font-semibold text-[11px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Configure Gemini
              </button>
            )}

            {onNavigateToView ? (
              <button
                type="button"
                onClick={() => onNavigateToView("console")}
                className="report-press flex items-center justify-center gap-1 py-2 px-2.5 rounded-lg border border-cs-border bg-cs-surface hover:bg-cs-bg-subtle text-cs-text-secondary text-[11px] font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
                title="Open Developer Console diagnostics"
              >
                <Terminal className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="sr-only">Diagnostics</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── 1. Report Section Inclusions ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
            Report Sections
          </span>
          <span className="font-mono text-cs-text-muted">{includedCount}/{REPORT_SECTIONS.length}</span>
        </span>

        {/* Outer card: rounded-2xl (16px), p-2.5 (10px), buttons: rounded-md (6px) -> 6 + 10 = 16px concentric match */}
        <div className="p-2.5 rounded-2xl border border-cs-border-subtle bg-cs-surface-2 space-y-0.5">
          {REPORT_SECTIONS.map(({ key, label, hint }) => {
            const isChecked = reportSections[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleReportSection(key)}
                aria-pressed={isChecked}
                className="report-press flex items-start gap-2 w-full text-left cursor-pointer rounded-md px-1.5 py-1.5 transition-colors hover:bg-cs-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
              >
                {isChecked ? (
                  <CheckSquare className="w-3.5 h-3.5 mt-0.5 text-cs-accent-clay shrink-0" strokeWidth={1.75} />
                ) : (
                  <Square className="w-3.5 h-3.5 mt-0.5 text-cs-text-muted shrink-0" strokeWidth={1.75} />
                )}
                <span className="min-w-0">
                  <span className={`block text-[11px] leading-snug ${isChecked ? "text-cs-text-primary font-medium" : "text-cs-text-muted"}`}>
                    {label}
                  </span>
                  <span className="block text-[10px] leading-snug text-cs-text-muted">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] leading-snug text-cs-text-muted m-0">
          Toggles apply to the report body in the main pane and are recorded in the JSON export.
        </p>
      </div>

      {/* ── 2. Export ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
          Export
        </span>

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleCopyReport}
            disabled={!analysisResult}
            className="report-press w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-cs-border bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-primary font-semibold text-[11px] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
            style={{
              color: copied ? "var(--cs-good)" : "var(--cs-text-primary)",
            }}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-cs-good" strokeWidth={2} />
                <span>Copied EHR Report</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
                <span>Copy Report (EHR / Text)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handlePrintPdf}
            className="report-press w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-cs-border bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-primary font-semibold text-[11px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
          >
            <Printer className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
            Print / Save to PDF
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            disabled={!analysisResult}
            className="report-press w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-cs-border bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-primary font-semibold text-[11px] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
          >
            <Download className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
            Download Report JSON
          </button>
        </div>
      </div>

      {/* ── 3. Lineage & integrity ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-cs-accent-clay" strokeWidth={1.75} />
          Report Lineage & Integrity
        </span>

        <div className="p-2.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-1.5 text-[10px]">
          <div className="flex justify-between items-center gap-2 text-cs-text-muted">
            <span>Narrative</span>
            {isDegraded ? (
              <span className="font-mono font-semibold flex items-center gap-1 text-cs-warn">
                <AlertTriangle className="w-3 h-3" strokeWidth={2} />
                Rule-based
              </span>
            ) : analysisResult?.analysis ? (
              <span className="font-mono font-semibold text-cs-good">AI-synthesized</span>
            ) : (
              <span className="font-mono font-semibold text-cs-text-muted">None</span>
            )}
          </div>

          {isDegraded && analysisResult?.fallbackReason ? (
            <div className="flex justify-between items-center gap-2 text-cs-text-muted">
              <span>Reason</span>
              <span className="font-mono text-cs-text-secondary">{analysisResult.fallbackReason}</span>
            </div>
          ) : null}

          <div className="flex justify-between items-center gap-2 text-cs-text-muted">
            <span>Evidence</span>
            <span className="font-mono text-cs-text-primary font-semibold tabular-nums">
              {evidence.present}/{evidence.total} sources
            </span>
          </div>

          <div className="flex justify-between items-center gap-2 text-cs-text-muted">
            <span>Compliance</span>
            <span className="font-mono text-cs-text-primary font-semibold">ACMG / AMP / ClinGen</span>
          </div>

          <div className="flex justify-between items-center gap-2 text-cs-text-muted pt-1 border-t border-cs-border-subtle">
            <span>SHA-256</span>
            <span
              className="font-mono text-cs-text-primary font-semibold truncate max-w-[135px] text-[9.5px]"
              title={fingerprint ?? "Computing cryptographic digest…"}
            >
              {fingerprint ? `${fingerprint.slice(0, 8)}…${fingerprint.slice(-6)}` : "Computing…"}
            </span>
          </div>

          <div className="flex justify-between items-center gap-2 text-cs-text-muted">
            <span>Generated</span>
            <span className="font-mono tabular-nums">{new Date().toLocaleDateString()}</span>
          </div>
        </div>

        <p className="text-[10px] leading-snug text-cs-text-muted m-0 flex items-start gap-1.5">
          <Lock className="w-3 h-3 mt-[1px] shrink-0" strokeWidth={1.75} />
          Clinical decision support only. Not a validated diagnostic report; variant curation by a
          qualified clinical geneticist is required.
        </p>
      </div>
    </div>
  );
};

export default React.memo(ReportInspector);
