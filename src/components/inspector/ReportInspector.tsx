import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, KeyRound, RefreshCw, Sparkles, Terminal, UserRound } from "lucide-react";
import { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useSettings } from "../../context/SettingsContext";
import { isFallbackNarrative } from "../../services/pipeline/variantCache";
import { generateProvenanceManifest } from "../../shared/provenance";
import { formatEvidenceCode } from "../../shared/thresholds";
import { REPORT_PRESETS, BLOCK_ORDER, exportedBlocks, REPORT_SOURCES, type ReportPresetId } from "../../shared/reportDocument";
import { renderReportHtml, renderReportJson, renderReportText } from "../../shared/reportRender";
import { deriveAiStatus } from "../report/reportStatus";
import { narrativeFreshness, readNarrativeEvidenceStamp } from "../../shared/narrativeEvidence";
import { useNarrativeEvidenceContext } from "../../hooks/useNarrativeEvidenceContext";
import { useReportDocument } from "../report/useReportDocument";
import { parseReportDraftFile, reportDraftKey } from "../../stores/reportDraftStorage";
import { downloadBlob, fileStem, printReport } from "../report/reportExport";

interface ReportInspectorProps {
  analysisResult: AnalysisResult | null;
  gene: string;
  variant: string;
  onRetryNarrative?: () => void | Promise<void>;
  isNarrativeLoading?: boolean;
  onNavigateToView?: (view: any) => void;
}

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="rpt-step" data-state={state}>
      <span className="rpt-step__n" aria-hidden="true">{n}</span>
      <div className="rpt-step__body">
        <span className="rpt-step__label">{label}</span>
        <div className="rpt-step__value">{children}</div>
      </div>
    </li>
  );
}

function ExportRow({ name, note, action, onClick, primary, disabled }: {
  name: string; note: string; action: string; onClick: () => void; primary?: boolean; disabled?: boolean;
}) {
  return (
    <div className="rpt-export">
      <span className="rpt-export__name">{name}</span>
      <span className="rpt-export__note">{note}</span>
      <button type="button" className="rpt-btn" data-variant={primary ? "primary" : undefined} onClick={onClick} disabled={disabled} aria-label={`${action} ${name}`}>
        {action}
      </button>
    </div>
  );
}

/**
 * Report builder rail: which blocks are in, how to get the document out, and how it was assembled.
 *
 * Renders the same document object the Report screen does (`useReportDocument`), so a tick here and the
 * card beside it cannot disagree, and every export button prints exactly what the screen shows.
 */
export const ReportInspector: React.FC<ReportInspectorProps> = ({
  analysisResult,
  gene,
  variant,
  onRetryNarrative,
  isNarrativeLoading: propIsNarrativeLoading,
  onNavigateToView,
}) => {
  const { doc, stamped } = useReportDocument(analysisResult);
  const toggle = useVariantAnalysisStore(s => s.toggleReportSection);
  const applyPreset = useVariantAnalysisStore(s => s.applyReportPreset);
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const setMeta = useVariantAnalysisStore(s => s.setReportMeta);
  const citations = useVariantAnalysisStore(s => s.reportCitations);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const foldingEnergetics = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingEnergetics ?? s.foldingEnergetics);
  const foldingDdG = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingDdG ?? s.foldingDdG);
  const storeIsNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading);
  const addNotification = useVariantAnalysisStore(s => s.addNotification);
  const { openSettingsTab, hasConfiguredGeminiKey, serverGeminiReady, settings } = useSettings();
  const draftStatus = useVariantAnalysisStore(s => s.reportDraftStatus);
  const sections = useVariantAnalysisStore(s => s.reportSections);
  const edits = useVariantAnalysisStore(s => s.reportEdits);
  const loadDraft = useVariantAnalysisStore(s => s.loadReportDraft);
  const draftFile = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState("identity");
  const [format, setFormat] = useState("html");
  const [exportRequest, setExportRequest] = useState<string | null>(null);
  useEffect(() => {
    setExportRequest(null);
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(e => e.isIntersecting);
      if (entry) setActiveSection(entry.target.id.replace("report-", ""));
    }, { rootMargin: "-5% 0px -65% 0px" });
    BLOCK_ORDER.forEach(key => { const el = document.getElementById(`report-${key}`); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [analysisResult, sections, doc.footer.documentId]);
  const [copied, setCopied] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);

  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;
  const narrativeContext = useNarrativeEvidenceContext(settings?.saprotEngine);
  const isNarrativeBusy = propIsNarrativeLoading ?? storeIsNarrativeLoading;
  const narrative = analysisResult?.analysis ?? "";
  const isDegraded = isFallbackNarrative(analysisResult?.analysis, analysisResult?.isFallback, analysisResult?.fallbackReason);

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
        hasNarrative: Boolean(narrative && (!analysisResult?.metadata?.pipelineRunId || readNarrativeEvidenceStamp(analysisResult))),
        isNarrativeLoading: isNarrativeBusy,
        narrativeMode: settings?.narrativeMode,
        narrativeOutdated: narrativeFreshness(analysisResult, narrativeContext) === "outdated",
      }),
    [isDegraded, analysisResult, isKeyActive, narrative, isNarrativeBusy, settings?.narrativeMode, narrativeContext]
  );

  if (!analysisResult) {
    return (
      <div className="rpt-rail" data-testid="report-rail">
        <p className="rpt-p">Run a variant to build a report.</p>
      </div>
    );
  }

  const stem = fileStem(gene, variant);
  const includedCount = exportedBlocks(doc).length;
  const populatedCount = doc.blocks.filter(b => !b.empty).length;
  const editedCount = doc.blocks.filter(b => b.edited).length;
  const staleCount = doc.blocks.filter(b => b.stale).length;
  const engineCodes = doc.blocks.find(b => b.key === "classification")?.counted ?? [];

  const activePreset = (Object.keys(REPORT_PRESETS) as ReportPresetId[]).find(id =>
    BLOCK_ORDER.every(k => doc.blocks.find(b => b.key === k)?.included === REPORT_PRESETS[id].blocks.includes(k))
  );

  const metaFor = (b: (typeof doc.blocks)[number]) => {
    if (b.stillCounted.length) return `${b.stillCounted.join(", ")} still counted`;
    if (b.stale) return "needs review";
    if (b.edited) return "edited";
    if (b.key === "literature") return `${citations.length} pinned`;
    if (b.counted.length) return b.counted.map(formatEvidenceCode).join(", ");
    if (b.empty) return "empty";
    if (b.status === "pending") return "running";
    if (b.status === "absent") return "no reading";
    return "";
  };

  const recordExport = (name: string) => setExportRequest(`Export requested: ${name} at ${new Date().toLocaleTimeString()}`);
  const exportHtml = () => { recordExport("HTML"); downloadBlob(`${stem}_evidence_report.html`, "text/html", renderReportHtml(stamped())); };
  const exportDocJson = () => { recordExport("JSON");
    downloadBlob(`${stem}_report_document.json`, "application/json", JSON.stringify(renderReportJson(stamped()), null, 2)); };
  const exportPdf = () => { recordExport("Print / PDF"); printReport(stamped()); };
  const exportPptx = async () => {
    recordExport("PowerPoint");
    setPptxBusy(true);
    try {
      // Loaded on first use, so the PowerPoint library is not part of the app's initial bundle.
      const { buildReportPptx } = await import("../report/exportPptx");
      const blob = await buildReportPptx(stamped());
      downloadBlob(`${stem}_evidence_summary.pptx`, blob.type, blob);
    } catch (err) {
      console.error("[Report] PowerPoint export failed:", err);
      addNotification("error", "Could not build the PowerPoint file.");
    } finally {
      setPptxBusy(false);
    }
  };
  const exportDocx = async () => {
    recordExport("Word");
    setDocxBusy(true);
    try {
      // Loaded on first use, so the Word library is not part of the app's initial bundle.
      const { buildReportDocx } = await import("../report/exportDocx");
      const blob = await buildReportDocx(stamped());
      downloadBlob(`${stem}_evidence_report.docx`, blob.type, blob);
    } catch (err) {
      console.error("[Report] Word export failed:", err);
      addNotification("error", "Could not build the Word file.");
    } finally {
      setDocxBusy(false);
    }
  };
  const copyText = async () => {
    recordExport("Text copy");
    try {
      await navigator.clipboard.writeText(renderReportText(stamped()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addNotification("success", "Report text copied to the clipboard.");
    } catch {
      addNotification("error", "Unable to access the clipboard.");
    }
  };
  const exportBundle = () => {
    const manifest = generateProvenanceManifest(
      gene,
      variant,
      uniprotId || analysisResult.metadata?.uniprotId || "",
      analysisResult,
      { acmgWeighting: settings.acmgWeighting },
      foldingEnergetics as any
    );
    const bundle = {
      schema: "mse.evidence-bundle/1",
      generatedAt: new Date().toISOString(),
      gene,
      variant,
      narrativeProvenance: {
        isAiSynthesized: !isDegraded && Boolean(narrative),
        fallbackReason: analysisResult.fallbackReason ?? null,
        attemptedModels: analysisResult.attemptedModels ?? [],
      },
      provenanceManifest: manifest,
      data: {
        ...analysisResult,
        foldingEnergetics: foldingEnergetics ?? (analysisResult as any).foldingEnergetics,
        foldingDdG: foldingDdG ?? (analysisResult as any).foldingDdG,
      },
    };
    downloadBlob(`${stem}_evidence_bundle.json`, "application/json", JSON.stringify(bundle, null, 2));
  };

  const jump = (key: string) => {
    const el = document.getElementById(`report-${key}`);
    el?.scrollIntoView({ block: "start" }); el?.focus({ preventScroll: true }); setActiveSection(key);
  };
  const requestExport = async () => {
    setExportRequest(`Export requested: ${format.toUpperCase()} at ${new Date().toLocaleTimeString()}`);
    const actions: Record<string, () => void | Promise<void>> = { html: exportHtml, pdf: exportPdf, docx: exportDocx, pptx: exportPptx, text: copyText, json: exportDocJson };
    try { await actions[format]?.(); } catch { addNotification("error", "Could not prepare this export."); }
  };
  const draftIdentity = reportDraftKey(gene, uniprotId, variant, JSON.stringify([analysisResult.predictorData?.gnomadVariantAssembly ?? null, analysisResult.predictorData?.gnomadVariantId ?? null, (analysisResult.metadata as any)?.transcriptId ?? null])) ?? "";
  const saveDraft = () => downloadBlob(`${stem}_draft.json`, "application/json", JSON.stringify({ schema: "mse.report-draft/1", identity: draftIdentity, draft: { sections, edits, meta, citations } }, null, 2));
  const reopenDraft = async (file?: File) => {
    if (!file) return;
    try { if (file.size > 2_000_000) throw new Error("The draft is too large."); loadDraft(parseReportDraftFile(await file.text(), draftIdentity)); addNotification("success", "Draft reopened for this variant."); }
    catch (err) { addNotification("error", err instanceof Error ? err.message : "Could not reopen this draft."); }
    finally { if (draftFile.current) draftFile.current.value = ""; }
  };
  const groups = [
    { name: "Case and interpretation", keys: ["identity", "classification", "contrast", "needed"] },
    { name: "Evidence readings", keys: ["computational", "population", "splicing", "function", "structure", "stability", "assembly", "language-models"] },
    { name: "Writing and sources", keys: ["literature", "summary", "notes", "method"] },
  ];
  const reviewBlocks = doc.blocks.filter(b => b.included && (b.stale || b.key === "summary" && !b.empty && b.warnings.length > 0 || b.verdict?.recordMismatch));

  return (
    <div className="rpt-rail" data-testid="report-rail">
      <div className="rpt-export-primary">
        <label htmlFor="rpt-format" className="eyebrow">Export report <span>{includedCount} sections</span></label>
        <div><select id="rpt-format" value={format} onChange={e => setFormat(e.target.value)}>
          <option value="html">Web page (.html)</option><option value="pdf">PDF / print</option><option value="docx">Word (.docx)</option><option value="pptx">PowerPoint summary</option><option value="text">Copy as text</option><option value="json">Document (.json)</option>
        </select><button type="button" className="rpt-btn" data-variant="primary" disabled={docxBusy || pptxBusy} onClick={() => void requestExport()}><Download size={14} />{docxBusy || pptxBusy ? "Building" : format === "text" ? "Copy" : format === "pdf" ? "Print" : "Download"}</button></div>
        {exportRequest ? <p role="status" className="rpt-dim">{exportRequest}</p> : null}
      </div>
      <section className="rpt-rail-section" aria-labelledby="rpt-rail-doc">
        <h3 className="eyebrow" id="rpt-rail-doc"><UserRound size={14} />Document</h3>
        <div className="rpt-field"><label htmlFor="rpt-title">Title</label><input id="rpt-title" value={meta.title} placeholder={doc.title} onChange={e => setMeta({ title: e.target.value })} /></div>
        <div className="rpt-field"><label htmlFor="rpt-by">Prepared by</label><input id="rpt-by" value={meta.preparedBy} placeholder="Name, affiliation" onChange={e => setMeta({ preparedBy: e.target.value })} /></div>
        <div className="rpt-field"><label htmlFor="rpt-case">Case reference</label><input id="rpt-case" value={meta.caseRef} placeholder="Optional" onChange={e => setMeta({ caseRef: e.target.value })} /></div>
        <p role="status" className="rpt-save-status">{draftStatus === "saved" ? "Saved in this browser" : draftStatus === "saving" ? "Saving draft" : "Session only - download a draft to keep your work"}</p>
        <p className="rpt-p rpt-dim">Do not enter patient identifiers. Document fields go into report exports; draft files preserve your edits.</p>
      </section>
      <section className="rpt-rail-section" aria-labelledby="rpt-rail-review">
        <h3 className="eyebrow" id="rpt-rail-review">Review status</h3>
        <p className="rpt-p">{staleCount ? `${staleCount} edited sections need review.` : "No stale author edits detected."}</p>
        {reviewBlocks.map(b => <button key={b.key} type="button" className="rpt-review-link" onClick={() => jump(b.key)}>{b.title}<span>{b.stale ? "Evidence changed" : b.verdict?.recordMismatch ? "Recorded tier differs" : "Unverified synthesis"}</span></button>)}
      </section>
      <section className="rpt-rail-section" aria-labelledby="rpt-rail-sections">
        <h3 className="eyebrow" id="rpt-rail-sections"><FileText size={14} />Contents{!activePreset ? <span className="rpt-custom">Custom</span> : null}</h3>
        <div className="rpt-seg" role="group" aria-label="Preset">
          {(Object.keys(REPORT_PRESETS) as ReportPresetId[]).map(id => <button key={id} type="button" aria-pressed={activePreset === id} title={REPORT_PRESETS[id].hint} onClick={() => applyPreset(id)}>{REPORT_PRESETS[id].label}</button>)}
        </div>
        {groups.map(group => <details key={group.name} className="rpt-contents-group" open><summary>{group.name}</summary><ul className="rpt-list">
          {doc.blocks.filter(b => group.keys.includes(b.key)).map(b => <li key={b.key} className="rpt-list__row" data-off={b.included ? undefined : ""} data-active={activeSection === b.key ? "" : undefined}>
            <label className="rpt-contents-label"><input type="checkbox" checked={b.included} aria-label={`${b.included ? "Leave out" : "Include"} ${b.title}`} onChange={() => toggle(b.key)} /><span>{b.title}</span></label>
            <span className="rpt-list__meta">{metaFor(b)}</span>
            <button type="button" className="rpt-jump" aria-label={`Go to ${b.title}`} onClick={() => jump(b.key)} disabled={!b.included && b.empty}>&#8599;</button>
          </li>)}
        </ul></details>)}
        <p className="rpt-p rpt-dim">{includedCount} of {populatedCount} populated sections in the export. Empty sections are skipped. Presets choose contents, not page count.</p>
      </section>
      <section className="rpt-rail-section" aria-labelledby="rpt-rail-summary">
        <h3 className="eyebrow" id="rpt-rail-summary"><Sparkles size={14} />Written summary</h3>
        <span className="ev-tier" data-tone={aiStatus.tone === "good" ? "good" : aiStatus.tone === "warn" ? "warning" : aiStatus.tone === "bad" ? "danger" : "muted"}>{aiStatus.label}</span>
        <p className="rpt-p">{aiStatus.detail}</p>
        <div className="rpt-draft-actions">
          {settings?.narrativeMode === "off" ? <button type="button" className="rpt-btn" onClick={() => openSettingsTab("analysis")}>Enable AI synthesis</button> : isKeyActive ?
            <button type="button" className="rpt-btn" onClick={() => void onRetryNarrative?.()} disabled={isNarrativeBusy || !onRetryNarrative}><RefreshCw size={14} />{isNarrativeBusy ? "Synthesizing" : !narrative || isDegraded ? "Generate summary" : "Re-synthesize"}</button> :
            <button type="button" className="rpt-btn" onClick={() => openSettingsTab("connections")}><KeyRound size={14} />Configure Gemini</button>}
        </div>
        <p className="rpt-p rpt-dim">The written summary is unverified and never determines the classification.</p>
      </section>
      <details className="rpt-rail-section"><summary>Other report formats</summary>
        <ExportRow name="Web page (.html)" note="Self-contained document with all selected facts and warnings" action="Download" onClick={exportHtml} />
        <ExportRow name="PDF" note="Choose Save as PDF in the print dialog" action="Open" onClick={exportPdf} />
        <ExportRow name="Word (.docx)" note="Editable headings, tables and page numbers" action={docxBusy ? "Building" : "Download"} onClick={() => void exportDocx()} disabled={docxBusy} />
        <ExportRow name="PowerPoint (.pptx)" note="Summary deck; complete selected content in speaker notes" action={pptxBusy ? "Building" : "Download"} onClick={() => void exportPptx()} disabled={pptxBusy} />
        <ExportRow name="Copy as text" note="Includes authorship and review warnings" action={copied ? "Copied" : "Copy"} onClick={() => void copyText()} />
        <ExportRow name="Document (.json)" note="Structured verdict, edits, facts and review annotations" action="Download" onClick={exportDocJson} />
      </details>
      <details className="rpt-rail-section"><summary>How the report was built</summary>
        <ol className="rpt-steps" data-testid="report-trace">
          <Step n={1} label="Evidence loaded">{engineCodes.length ? `Engine counted ${engineCodes.map(formatEvidenceCode).join(", ")}.` : "No criterion was counted."}</Step>
          <Step n={2} label="Author edits" state={staleCount ? "warn" : "done"}>{editedCount} edited sections; {staleCount} need review.</Step>
          <Step n={3} label="Written summary" state={reviewBlocks.some(b => b.key === "summary") ? "warn" : "done"}>{aiStatus.label}</Step>
          <Step n={4} label="Export" state={exportRequest ? "done" : "idle"}>{exportRequest ?? "No export requested through this inspector."}</Step>
        </ol>
      </details>
      <details className="rpt-rail-section"><summary>Sources and provenance</summary>
        <p className="rpt-p rpt-dim">Configured datasets and returned dataset identifiers are labeled separately. Unknown releases are not inferred.</p>
        <div className="rpt-source-links">{REPORT_SOURCES.map(r => <a key={r.url} href={r.url} target="_blank" rel="noreferrer">{r.label}</a>)}</div>
        <button className="rpt-btn" type="button" onClick={() => jump("method")}>View run and method</button>
      </details>
      <details className="rpt-rail-section"><summary>Advanced export and drafts</summary>
        <ExportRow name="Full evidence bundle (.json)" note="All analysis data and provenance. Report exclusions and author edits do not apply." action="Download" onClick={exportBundle} />
        <div className="rpt-draft-actions"><button className="rpt-btn" type="button" onClick={saveDraft}>Save draft file</button><button className="rpt-btn" type="button" onClick={() => draftFile.current?.click()}>Reopen draft</button></div>
        <input ref={draftFile} type="file" accept=".json,application/json" aria-label="Reopen report draft file" hidden onChange={e => void reopenDraft(e.target.files?.[0])} />
        {onNavigateToView ? <button type="button" className="rpt-btn" onClick={() => onNavigateToView("console")}><Terminal size={14} />Diagnostics</button> : null}
      </details>
    </div>
  );
};

export default React.memo(ReportInspector);
