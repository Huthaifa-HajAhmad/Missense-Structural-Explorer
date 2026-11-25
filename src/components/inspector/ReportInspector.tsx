import React, { useEffect, useState } from "react";
import type { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { BLOCK_ORDER, exportedBlocks, reportGroupOf, type BlockKey } from "../../shared/reportDocument";
import { reportDraftKeys } from "../../stores/reportDraftStorage";
import { useReportDocument } from "../report/useReportDocument";
import { fileStem } from "../report/reportExport";
import { useReportExports } from "../report/rail/useReportExports";
import { ReportExportBar } from "../report/rail/ReportExportBar";
import { ReportReviewStatus } from "../report/rail/ReportReviewStatus";
import { ReportContents } from "../report/rail/ReportContents";
import { ReportDocumentFields } from "../report/rail/ReportDocumentFields";
import { ReportSummaryStatus } from "../report/rail/ReportSummaryStatus";
import { ReportMoreActions } from "../report/rail/ReportMoreActions";

interface ReportInspectorProps {
  analysisResult: AnalysisResult | null;
  gene: string;
  variant: string;
  onRetryNarrative?: () => void | Promise<void>;
  isNarrativeLoading?: boolean;
  onNavigateToView?: (view: "console") => void;
}

/** Marks the block nearest the top of the report as the one being read, for the contents list. */
function useActiveSection(deps: readonly unknown[]): [string, (key: string) => void] {
  const [active, setActive] = useState("identity");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(e => e.isIntersecting);
      if (entry) setActive(entry.target.id.replace("report-", ""));
    }, { rootMargin: "-5% 0px -65% 0px" });
    BLOCK_ORDER.forEach(key => { const el = document.getElementById(`report-${key}`); if (el) observer.observe(el); });
    return () => observer.disconnect();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- re-observe whenever the mounted blocks change.
  }, deps);
  return [active, setActive];
}

/**
 * Report builder rail: how to get the document out, whether it is ready, which sections are in, the
 * document's fields, the written summary, then the rarer actions.
 *
 * Renders the same document object the Report screen does (`useReportDocument` shares one build), so a
 * tick here and the card beside it cannot disagree, and every export prints exactly what the screen shows.
 */
export const ReportInspector: React.FC<ReportInspectorProps> = ({ analysisResult, gene, variant, onRetryNarrative, isNarrativeLoading, onNavigateToView }) => {
  const { doc, stamped } = useReportDocument(analysisResult);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const storeNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const sections = useVariantAnalysisStore(s => s.reportSections);
  const edits = useVariantAnalysisStore(s => s.reportEdits);
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const citations = useVariantAnalysisStore(s => s.reportCitations);
  const reportView = useVariantAnalysisStore(s => s.reportView);
  const setReportView = useVariantAnalysisStore(s => s.setReportView);
  const stem = fileStem(gene, variant);
  const exports = useReportExports(stamped, stem, doc.footer.documentId);
  const [activeSection, setActiveSection] = useActiveSection([analysisResult, sections, doc.footer.documentId, reportView]);

  if (!analysisResult) {
    return (
      <div className="rpt-rail" data-testid="report-rail">
        <p className="rpt-p">Run a variant to build a report.</p>
      </div>
    );
  }

  /** A block filed under another part of the document is hidden; bring its part on screen, then scroll. */
  const jump = (key: BlockKey) => {
    const go = () => {
      const el = document.getElementById(`report-${key}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
      setActiveSection(key);
    };
    if (reportView !== "document" && reportGroupOf(key) !== reportView) {
      setReportView(reportGroupOf(key));
      requestAnimationFrame(go);
    } else go();
  };

  const identity = reportDraftKeys(gene, uniprotId, variant, analysisResult).key ?? "";
  const draft = { sections, edits, meta, citations };
  const summary = doc.blocks.find(b => b.key === "summary");

  return (
    <div className="rpt-rail" data-testid="report-rail">
      <ReportExportBar sections={exportedBlocks(doc).length} busy={exports.busy} status={exports.status} onExport={format => void exports.run(format)} />
      <ReportReviewStatus blocks={doc.blocks} onJump={jump} />
      <ReportContents doc={doc} activeSection={activeSection} onJump={jump} />
      <ReportDocumentFields placeholderTitle={doc.title} stem={stem} identity={identity} draft={draft} />
      <ReportSummaryStatus
        result={analysisResult}
        outdated={summary?.review === "summary-outdated"}
        busy={isNarrativeLoading ?? storeNarrativeLoading}
        onWrite={onRetryNarrative}
      />
      <ReportMoreActions
        result={analysisResult}
        gene={gene}
        variant={variant}
        stem={stem}
        identity={identity}
        draft={draft}
        onDiagnostics={onNavigateToView ? () => onNavigateToView("console") : undefined}
      />
    </div>
  );
};

export default React.memo(ReportInspector);
