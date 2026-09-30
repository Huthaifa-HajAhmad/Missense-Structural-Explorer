/**
 * reportExport.ts — getting a rendered report out of the browser.
 *
 * Everything here runs in the page: no upload, no server call. The PDF path prints the same html file
 * the download produces, in a hidden frame, so the printed page and the file cannot differ.
 */
import type { ReportDocument } from "../../shared/reportDocument";
import { renderReportHtml } from "../../shared/reportRender";

export function fileStem(gene: string, variant: string): string {
  const clean = (s: string, fallback: string) => (s || fallback).replace(/[<>:"/\\|?*\s]+/g, "_");
  return `${clean(gene, "variant")}_${clean(variant, "report")}`;
}

export function downloadBlob(filename: string, mime: string, content: string | Blob): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens the browser's print dialog on the report; the user chooses "Save as PDF". */
export function printReport(doc: ReportDocument): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = renderReportHtml(doc);
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      setTimeout(() => frame.remove(), 60_000);
    }
  };
  document.body.appendChild(frame);
}
