import React, { useState, useEffect } from "react";
import { ChevronUp, ChevronDown, Copy, Check, FileText } from "lucide-react";
import { AnalysisState } from "../types";

interface ClinicalReportBarProps {
  analysisState: AnalysisState;
  isDark: boolean;
  fullPage?: boolean;  // When true: always-expanded, no toggle bar, fills container
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

function ClinicalReportBar({ analysisState, isDark, fullPage = false }: ClinicalReportBarProps) {
  const result = analysisState.result;
  const hasResult = !!result;
  const [isOpen, setIsOpen] = useState(fullPage ? true : false);
  const [copied, setCopied] = useState(false);

  // Auto-open when a new result arrives (only relevant in bar mode)
  useEffect(() => {
    if (!fullPage && hasResult) setIsOpen(true);
  }, [hasResult, fullPage]);

  const classification = result?.clinvar?.classification ?? result?.ruleBasedInsights?.acmgVerdict ?? "";
  const narrative     = result?.analysis ?? "";
  const acmgCriteria  = (result?.insights?.acmgCriteria ?? result?.ruleBasedInsights?.acmgCriteria ?? []).map(c => c.code);

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

  if (!hasResult) return (
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
        <div>
          <h1 className="screen-title">Clinical Report</h1>
          <p className="screen-tab-description">
            A plain-language narrative summary of all evidence layers, structured for sharing with clinical colleagues.
          </p>
        </div>

        {/* Classification verdict */}
        {classification && (
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1 rounded-full ${styles.badge}`}>
              <span className={`w-2 h-2 rounded-full animate-pulse ${styles.dot}`} />
              {classification}
            </span>
          </div>
        )}

        {/* ACMG criteria chips */}
        {acmgCriteria.length > 0 && (
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-widest font-mono mb-2"
              style={{ color: "var(--cs-text-muted)" }}
            >
              ACMG Evidence Criteria
            </p>
            <div className="flex flex-wrap gap-1.5">
              {acmgCriteria.map((code: string) => (
                <span
                  key={code}
                  className="text-[11px] font-mono font-semibold px-2 py-1 rounded border"
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
          </div>
        )}

        {/* Narrative — editorial serif prose */}
        {narrative && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p
                className="text-[10px] font-bold uppercase tracking-widest font-mono"
                style={{ color: "var(--cs-text-muted)" }}
              >
                Clinical Narrative
              </p>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                style={{
                  color: copied ? "var(--cs-good)" : "var(--cs-text-muted)",
                  background: "var(--cs-surface-2)",
                  border: "1px solid var(--cs-border)",
                }}
              >
                {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy Report</>}
              </button>
            </div>

            {/* 72ch reading column with Lora serif */}
            <div className="report-prose-wrapper">
              <div className="report-prose">
                {narrative.split("\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
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
          {/* Copy button — only visible when open */}
          {isOpen && narrative && (
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

      {/* Narrative text */}
      {isOpen && narrative && (
        <div className="report-bar-content">
          <p
            className="text-[11.5px] leading-relaxed"
            style={{ color: "var(--cs-text-secondary)", fontFamily: "'Inter', sans-serif" }}
          >
            {narrative}
          </p>
        </div>
      )}
    </div>
  );
}

export default React.memo(ClinicalReportBar);
