import { ResearchGuideButton } from "./knowledge/ResearchGuideButton";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnalysisState } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import type { ReportView } from "../stores/slices/uiSlice";
import type { EvidenceTabId } from "../shared/insightsEvidence";
import { REPORT_GROUPS, reportGroupOf } from "../shared/reportDocument";
import { WorkspaceTabs } from "./ui/WorkspaceTabs";
import { ReportBlockCard, LeftOutCard, ReportFooterCard, type OpenTab } from "./report/ReportBlocks";
import { useReportDocument } from "./report/useReportDocument";

/**
 * The Report screen: one editable document, built from the same consolidated case the Insights tab reads.
 *
 * Nothing here derives a classification or a sentence. `useReportDocument` returns the document
 * (`buildReportDocument`), and this file only lays its blocks out and forwards the author's changes to
 * the store: include or leave out a block, edit its prose, revert it. The rail beside it owns the export
 * buttons and the document fields, and renders the same document.
 *
 * Laid out like Landscape: a heading, tabs that give each part of the document its own space, then
 * one panel per block. The tabs only choose what is on screen; every export still prints the whole
 * selected document.
 */
interface ClinicalReportBarProps {
  analysisState: AnalysisState;
  /** Opens a top-level view a block reads from. */
  onNavigateToView?: (view: "insights" | "literature") => void;
  /** Opens one tab of the Evidence view. */
  onOpenEvidenceTab?: (tab: EvidenceTabId) => void;
}

// The parts come from the document model, so the rail's contents groups carry the same names.
const VIEW_TABS: readonly { id: ReportView; label: string }[] = [
  { id: "document", label: "Full document" },
  ...REPORT_GROUPS.map(g => ({ id: g.id, label: g.label })),
];

const VIEW_NOTE: Record<ReportView, string> = {
  document: "Every section in reading order.",
  interpretation: "Identity, the rule-engine classification, where the evidence agrees and what is still missing.",
  evidence: "One reading per evidence tab, each with the criterion the engine did or did not count.",
  writing: "Review the written summary and add your own notes. Editing text never changes the recorded classification.",
  sources: "Papers selected for this report, with limitations and method provenance. Inclusion is not an assessment of a paper's conclusions.",
};

/** The page title, then the author's byline when there is one. Research use is stated once, in the footer. */
function ReportHeading({ title, byline }: { title: string; byline?: string }) {
  return (
    <header className="rpt-heading">
      <h1 className="rpt-heading__title screen-title">{title}</h1>
      {byline ? <p className="rpt-heading__sub">{byline}</p> : null}
      <ResearchGuideButton topic="report" label="Reading and reviewing this report" />
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
        <ReportHeading title="No report yet" />
        <section className="rpt-card">
          <div className="rpt-empty"><p>Run a variant to build a report. Nothing is drafted until an analysis is loaded.</p></div>
        </section>
      </div>
    );
  }

  const inView = (key: (typeof doc.blocks)[number]["key"]) => view === "document" || reportGroupOf(key) === view;
  // Every included block stays mounted (hidden when outside the chosen tab), so the browser's own print
  // still prints the whole document and the rail's observer sees every block.
  const included = doc.blocks.filter(b => b.included);
  const left = doc.blocks.filter(b => !b.included && !(b.empty && !b.edited) && inView(b.key));
  const byline = [doc.meta.preparedBy ? `Prepared by ${doc.meta.preparedBy}` : "", doc.meta.caseRef].filter(Boolean).join(" · ");
  const groupLabel = REPORT_GROUPS.find(g => g.id === view)?.label;

  return (
    <div
      key={`${doc.subject}-${result.metadata?.pipelineRunId ?? ""}`}
      ref={scroller}
      className="rpt-screen report-page"
      data-testid="report-screen"
    >
      <ReportHeading title={doc.title} byline={byline} />

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
