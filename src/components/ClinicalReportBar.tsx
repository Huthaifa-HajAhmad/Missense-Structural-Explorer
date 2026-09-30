import React, { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import { AnalysisState } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import type { EvidenceTabId } from "../shared/insightsEvidence";
import { ReportChipView, ReportBlockCard, LeftOutCard, ReportFooterCard, type OpenTab } from "./report/ReportBlocks";
import { useReportDocument } from "./report/useReportDocument";

/**
 * The Report screen: one editable document, built from the same consolidated case the Insights tab reads.
 *
 * Nothing here derives a classification or a sentence. `useReportDocument` returns the document
 * (`buildReportDocument`), and this file only lays its blocks out and forwards the author's changes to
 * the store: include or leave out a block, edit its prose, revert it. The rail beside it owns the export
 * buttons and the document fields, and renders the same document.
 */
interface ClinicalReportBarProps {
  analysisState: AnalysisState;
  isDark?: boolean;
  fullPage?: boolean;
  onRetryNarrative?: () => void;
  isNarrativeLoading?: boolean;
  /** Opens a top-level view ("insights", "literature"). */
  onNavigateToView?: (view: any) => void;
  /** Opens one tab of the Evidence view. */
  onOpenEvidenceTab?: (tab: EvidenceTabId) => void;
}

function ClinicalReportBar({ analysisState, onNavigateToView, onOpenEvidenceTab }: ClinicalReportBarProps) {
  const result = analysisState.result;
  const { doc } = useReportDocument(result);
  const toggle = useVariantAnalysisStore(s => s.toggleReportSection);
  const setEdit = useVariantAnalysisStore(s => s.setReportEdit);
  const clearEdit = useVariantAnalysisStore(s => s.clearReportEdit);
  const [editing, setEditing] = useState<string | null>(null);

  const openTab: OpenTab = useCallback(
    tab => {
      if (tab === "insights" || tab === "literature") onNavigateToView?.(tab);
      else onOpenEvidenceTab?.(tab);
    },
    [onNavigateToView, onOpenEvidenceTab]
  );

  if (!result) {
    return (
      <div className="rpt-screen report-page" data-testid="report-empty">
        <section className="rpt-card">
          <header className="rpt-card__head">
            <h2 className="eyebrow rpt-label"><FileText className="w-3.5 h-3.5" aria-hidden="true" /> Variant evidence report</h2>
          </header>
          <div className="rpt-empty"><p>Run a variant to build a report. Nothing is drafted until an analysis is loaded.</p></div>
        </section>
      </div>
    );
  }

  const included = doc.blocks.filter(b => b.included);
  const left = doc.blocks.filter(b => !b.included && !(b.empty && !b.edited));

  return (
    <div className="rpt-screen report-page" data-testid="report-screen">
      <section className="rpt-card report-masthead" aria-label="Report">
        <header className="rpt-card__head">
          <h2 className="eyebrow rpt-label"><FileText className="w-3.5 h-3.5" aria-hidden="true" /> Variant evidence report</h2>
          <ReportChipView chip={{ label: "Research use", tone: "muted" }} />
          <span className="rpt-card__spacer" />
          <ReportChipView chip={{ label: "Draft, not yet exported", tone: "muted" }} />
        </header>
        <div className="rpt-doc-head" style={{ padding: "14px 16px" }}>
          <h1 className="rpt-strong" style={{ fontSize: "var(--cs-font-size-screen-title)" }}>{doc.title}</h1>
          <p className="rpt-dim">{doc.subject}{doc.meta.preparedBy ? ` · Prepared by ${doc.meta.preparedBy}` : ""}{doc.meta.caseRef ? ` · ${doc.meta.caseRef}` : ""}</p>
        </div>
      </section>

      {included.map(block => (
        <ReportBlockCard
          key={block.key}
          block={block}
          editing={editing === block.key}
          onToggle={() => toggle(block.key)}
          onStartEdit={() => setEditing(block.key)}
          onStopEdit={() => setEditing(null)}
          onEdit={text => (text.trim() === block.drafted.trim() ? clearEdit(block.key) : setEdit(block.key, text, block.drafted))}
          onRevert={() => { clearEdit(block.key); setEditing(null); }}
          onKeepMine={() => setEdit(block.key, block.text, block.drafted)}
          onOpenTab={openTab}
        />
      ))}

      <LeftOutCard blocks={left} onInclude={key => toggle(key)} />
      <ReportFooterCard doc={doc} />
    </div>
  );
}

export default React.memo(ClinicalReportBar);
