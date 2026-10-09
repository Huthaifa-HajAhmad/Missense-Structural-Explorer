import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { AnalysisState } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import type { ReportView } from "../stores/slices/uiSlice";
import type { EvidenceTabId } from "../shared/insightsEvidence";
import { REPORT_GROUPS, reportGroupOf } from "../shared/reportDocument";
import { WorkspaceTabs } from "./ui/WorkspaceTabs";
import { ReportChipView, ReportBlockCard, LeftOutCard, ReportFooterCard, type OpenTab } from "./report/ReportBlocks";
import { useReportDocument } from "./report/useReportDocument";

/**
 * The Report screen: one editable document, built from the same consolidated case the Insights tab reads.
 *
 * Nothing here derives a classification or a sentence. `useReportDocument` returns the document
 * (`buildReportDocument`), and this file only lays its blocks out and forwards the author's changes to
 * the store: include or leave out a block, edit its prose, revert it. The rail beside it owns the export
 * buttons and the document fields, and renders the same document.
 *
 * Laid out like Landscape: a heading, pills that give each part of the document its own space, then
 * one panel per block. The pills only choose what is on screen; every export still prints the whole
 * selected document.
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

const VIEW_TABS: readonly { id: ReportView; label: string }[] = [
  { id: "document", label: "Full document" },
  { id: "interpretation", label: "Interpretation" },
  { id: "evidence", label: "Evidence readings" },
  { id: "writing", label: "Writing & sources" },
];

const VIEW_NOTE: Record<ReportView, string> = {
  document: "Every section in reading order. Tick a section to keep it in the export.",
  interpretation: "Identity, the rule-engine classification, where the evidence agrees and what is still missing.",
  evidence: "One reading per evidence tab, each with the criterion the engine did or did not count.",
  writing: "Pinned literature, the written summary, your notes and the method.",
};

function ReportHeading({ title, subtitle, draft = true }: { title: string; subtitle: string; draft?: boolean }) {
  return (
    <header className="rpt-heading">
      <div className="rpt-heading__icon" aria-hidden="true"><FileText className="w-4 h-4" /></div>
      <div className="rpt-heading__text">
        <p className="rpt-heading__kicker">Variant evidence report</p>
        <h1 className="rpt-heading__title">{title}</h1>
        <p className="rpt-heading__sub">{subtitle}</p>
      </div>
      {draft ? (
        <span className="rpt-heading__chips">
          <ReportChipView chip={{ label: "Research use", tone: "muted" }} />
          <ReportChipView chip={{ label: "Draft", tone: "muted" }} />
        </span>
      ) : null}
    </header>
  );
}

function ClinicalReportBar({ analysisState, onNavigateToView, onOpenEvidenceTab }: ClinicalReportBarProps) {
  const result = analysisState.result;
  const { doc } = useReportDocument(result);
  const toggle = useVariantAnalysisStore(s => s.toggleReportSection);
  const setEdit = useVariantAnalysisStore(s => s.setReportEdit);
  const clearEdit = useVariantAnalysisStore(s => s.clearReportEdit);
  const view = useVariantAnalysisStore(s => s.reportView);
  const setView = useVariantAnalysisStore(s => s.setReportView);
  const [editing, setEditing] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => setEditing(null), [doc.subject, result?.metadata?.pipelineRunId]);

  const openTab: OpenTab = useCallback(
    tab => {
      if (tab === "insights" || tab === "literature") onNavigateToView?.(tab);
      else onOpenEvidenceTab?.(tab);
    },
    [onNavigateToView, onOpenEvidenceTab]
  );

  const chooseView = (next: ReportView) => {
    setView(next);
    if (scroller.current) scroller.current.scrollTop = 0;
  };

  if (!result) {
    return (
      <div className="rpt-screen report-page" data-testid="report-empty">
        <ReportHeading title="No report yet" subtitle="Automated evidence with author commentary" draft={false} />
        <section className="rpt-card">
          <div className="rpt-empty"><p>Run a variant to build a report. Nothing is drafted until an analysis is loaded.</p></div>
        </section>
      </div>
    );
  }

  const inView = (key: (typeof doc.blocks)[number]["key"]) => view === "document" || reportGroupOf(key) === view;
  // Every included block stays mounted (hidden when outside the pill), so the browser's own print
  // still prints the whole document and the rail's observer sees every block.
  const included = doc.blocks.filter(b => b.included);
  const left = doc.blocks.filter(b => !b.included && !(b.empty && !b.edited) && inView(b.key));
  const byline = [
    doc.meta.preparedBy || doc.meta.caseRef ? "" : "Automated evidence with author commentary",
    doc.meta.preparedBy ? `Prepared by ${doc.meta.preparedBy}` : "",
    doc.meta.caseRef,
  ].filter(Boolean).join(" · ");
  const groupLabel = REPORT_GROUPS.find(g => g.id === view)?.label;

  return (
    <div
      key={`${doc.subject}-${result.metadata?.pipelineRunId ?? ""}`}
      ref={scroller}
      className="rpt-screen report-page"
      data-testid="report-screen"
    >
      <ReportHeading title={doc.title} subtitle={byline} />

      <WorkspaceTabs id="report" label="Report views" tabs={VIEW_TABS} value={view} onChange={chooseView} />
      {VIEW_TABS.filter(t => t.id !== view).map(t => (
        <div key={t.id} role="tabpanel" id={`report-panel-${t.id}`} aria-labelledby={`report-tab-${t.id}`} hidden />
      ))}

      <div role="tabpanel" id={`report-panel-${view}`} aria-labelledby={`report-tab-${view}`} className="rpt-stack">
        <p className="rpt-view-note">
          {VIEW_NOTE[view]}
          {groupLabel ? <> Exports still include every ticked section, not only {groupLabel.toLowerCase()}.</> : null}
        </p>

        {included.map(block => (
          <div key={block.key} className="rpt-part" hidden={!inView(block.key)}>
          <ReportBlockCard
            block={block}
            editing={editing === block.key}
            onToggle={() => toggle(block.key)}
            onStartEdit={() => setEditing(block.key)}
            onStopEdit={() => setEditing(null)}
            onEdit={(text, base = block.drafted, evidenceId = block.evidenceId) => (text === block.drafted && evidenceId === block.evidenceId ? clearEdit(block.key) : setEdit(block.key, text, base, evidenceId))}
            onRevert={() => { clearEdit(block.key); setEditing(null); }}
            onKeepMine={() => setEdit(block.key, block.text, block.drafted, block.evidenceId)}
            onOpenTab={openTab}
          />
          </div>
        ))}
        {!included.some(b => inView(b.key)) && left.length === 0 ? (
          <section className="rpt-card"><div className="rpt-empty"><p>No section in this part has anything to report for this variant.</p></div></section>
        ) : null}

        <LeftOutCard blocks={left} onInclude={key => toggle(key)} />
        <ReportFooterCard doc={doc} />
      </div>
    </div>
  );
}

export default React.memo(ClinicalReportBar);
