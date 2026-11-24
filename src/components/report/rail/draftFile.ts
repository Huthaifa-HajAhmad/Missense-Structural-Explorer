import type { ReportDraft } from "../../../shared/reportInput";
import { downloadBlob } from "../reportExport";

/**
 * Downloads a draft as a portable file. The identity ties it to one variant and transcript, so
 * `parseReportDraftFile` refuses to reopen it on another.
 */
export function downloadDraft(stem: string, identity: string, draft: ReportDraft, name = "draft"): void {
  downloadBlob(`${stem}_${name}.json`, "application/json", JSON.stringify({ schema: "mse.report-draft/1", identity, draft }, null, 2));
}
