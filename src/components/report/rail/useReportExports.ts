import { useEffect, useState } from "react";
import type { ReportDocument } from "../../../shared/reportDocument";
import { renderReportHtml, renderReportJson, renderReportText } from "../../../shared/reportRender";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { downloadBlob, printReport } from "../reportExport";

export type ExportFormat = "html" | "pdf" | "docx" | "pptx" | "text" | "json";

/** Every format the report can leave the browser in, in menu order, with the words its outcome line uses. */
export const EXPORT_FORMATS: readonly { id: ExportFormat; label: string; button: string; done: string }[] = [
  { id: "html", label: "Web page (.html)", button: "Download", done: "downloaded" },
  { id: "pdf", label: "PDF / print", button: "Print", done: "sent to the print dialog" },
  { id: "docx", label: "Word (.docx)", button: "Download", done: "downloaded" },
  { id: "pptx", label: "PowerPoint summary (.pptx)", button: "Download", done: "downloaded" },
  { id: "text", label: "Plain text (copy)", button: "Copy", done: "copied to the clipboard" },
  { id: "json", label: "Document (.json)", button: "Download", done: "downloaded" },
];

/** Writes one format. The Word and PowerPoint libraries load on first use, outside the app's first bundle. */
const WRITERS: Record<ExportFormat, (doc: ReportDocument, stem: string) => void | Promise<void>> = {
  html: (doc, stem) => downloadBlob(`${stem}_evidence_report.html`, "text/html", renderReportHtml(doc)),
  pdf: doc => printReport(doc),
  docx: async (doc, stem) => {
    const { buildReportDocx } = await import("../exportDocx");
    const blob = await buildReportDocx(doc);
    downloadBlob(`${stem}_evidence_report.docx`, blob.type, blob);
  },
  pptx: async (doc, stem) => {
    const { buildReportPptx } = await import("../exportPptx");
    const blob = await buildReportPptx(doc);
    downloadBlob(`${stem}_evidence_summary.pptx`, blob.type, blob);
  },
  text: doc => navigator.clipboard.writeText(renderReportText(doc)),
  json: (doc, stem) => downloadBlob(`${stem}_report_document.json`, "application/json", JSON.stringify(renderReportJson(doc), null, 2)),
};

/**
 * Runs an export of the document as it stands now (`stamped` dates it), and keeps one outcome line:
 * what happened and when, or that it failed. One export runs at a time. The line is dropped when the
 * document's content changes (`documentId`), so it never describes a file the reader did not get.
 */
export function useReportExports(stamped: () => ReportDocument, stem: string, documentId: string) {
  const addNotification = useVariantAnalysisStore(s => s.addNotification);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => setStatus(null), [documentId]);

  const run = async (format: ExportFormat) => {
    const f = EXPORT_FORMATS.find(x => x.id === format)!;
    setBusy(true);
    try {
      await WRITERS[format](stamped(), stem);
      setStatus(`${f.label} ${f.done} at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error(`[Report] ${f.label} export failed:`, err);
      setStatus(`${f.label} could not be prepared.`);
      addNotification("error", `Could not prepare the ${f.label} export.`);
    } finally {
      setBusy(false);
    }
  };

  return { busy, status, run };
}
