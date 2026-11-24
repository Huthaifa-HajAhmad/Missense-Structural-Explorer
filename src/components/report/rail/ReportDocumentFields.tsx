import React from "react";
import { UserRound } from "lucide-react";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import type { ReportDraft } from "../../../shared/reportInput";
import { downloadDraft } from "./draftFile";

const SAVE_STATUS = {
  saved: "Saved in this browser",
  saving: "Saving draft",
  "session-only": "Session only. Save a draft file to keep your work.",
} as const;

/** The document's own fields, where the draft is kept, and the choice when two drafts exist. */
export function ReportDocumentFields({ placeholderTitle, stem, identity, draft }: {
  placeholderTitle: string;
  stem: string;
  identity: string;
  draft: ReportDraft;
}) {
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const setMeta = useVariantAnalysisStore(s => s.setReportMeta);
  const draftStatus = useVariantAnalysisStore(s => s.reportDraftStatus);
  const recovery = useVariantAnalysisStore(s => s.reportDraftRecovery);
  const setRecovery = useVariantAnalysisStore(s => s.setReportDraftRecovery);
  const loadDraft = useVariantAnalysisStore(s => s.loadReportDraft);

  return (
    <section className="rpt-rail-section" aria-labelledby="rpt-rail-doc">
      <h3 className="rpt-rail-title" id="rpt-rail-doc"><UserRound size={14} aria-hidden="true" />Document</h3>
      <p className="rpt-rail-help">These fields go into every export. Do not enter patient identifiers.</p>
      <div className="rpt-field"><label htmlFor="rpt-title">Title</label><input id="rpt-title" value={meta.title} placeholder={placeholderTitle} onChange={e => setMeta({ title: e.target.value })} /></div>
      <div className="rpt-field"><label htmlFor="rpt-by">Prepared by</label><input id="rpt-by" value={meta.preparedBy} placeholder="Name, affiliation" onChange={e => setMeta({ preparedBy: e.target.value })} /></div>
      <div className="rpt-field"><label htmlFor="rpt-case">Case reference</label><input id="rpt-case" value={meta.caseRef} placeholder="Optional" onChange={e => setMeta({ caseRef: e.target.value })} /></div>
      <p role="status" className="rpt-save-status">{SAVE_STATUS[draftStatus]}</p>
      {recovery?.identity === identity ? (
        <div className="rpt-draft-recovery" role="status">
          <p>A saved draft already exists for this reference. Your current draft stays on screen; the saved draft has not been overwritten.</p>
          <div className="rpt-draft-actions">
            <button type="button" className="rpt-btn" onClick={() => downloadDraft(stem, identity, draft)}>Download current draft</button>
            <button type="button" className="rpt-btn" onClick={() => downloadDraft(stem, identity, recovery.saved, "saved_draft")}>Download saved draft</button>
            <button type="button" className="rpt-btn" onClick={() => setRecovery(null)}>Keep current draft</button>
            <button type="button" className="rpt-btn" onClick={() => { loadDraft(recovery.saved); setRecovery(null); }}>Use saved draft</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
