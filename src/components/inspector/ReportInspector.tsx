import React, { useMemo, useState } from "react";
import { Download, FileText, GitBranch, BookOpen, KeyRound, RefreshCw, Sparkles, Terminal, UserRound } from "lucide-react";
import { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useSettings } from "../../context/SettingsContext";
import { isFallbackNarrative } from "../../services/pipeline/variantCache";
import { generateProvenanceManifest } from "../../shared/provenance";
import { formatEvidenceCode } from "../../shared/thresholds";
import { REPORT_PRESETS, BLOCK_ORDER, type ReportPresetId } from "../../shared/reportDocument";
import { renderReportHtml, renderReportJson, renderReportText } from "../../shared/reportRender";
import { deriveAiStatus } from "../report/reportStatus";
import { useReportDocument } from "../report/useReportDocument";
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
    <li className="rail-step" data-state={state}>
      <span className="rail-step__n" aria-hidden="true">{n}</span>
      <div className="rail-step__body">
        <span className="rail-step__label">{label}</span>
        <div className="rail-step__value">{children}</div>
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
  const [copied, setCopied] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);

  const isKeyActive = hasConfiguredGeminiKey || serverGeminiReady;
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
        hasNarrative: Boolean(narrative),
        isNarrativeLoading: isNarrativeBusy,
      }),
    [isDegraded, analysisResult, isKeyActive, narrative, isNarrativeBusy]
  );

  if (!analysisResult) {
    return (
      <div className="pop-rail rpt-rail" data-testid="report-rail">
        <p className="rpt-p">Run a variant to build a report.</p>
      </div>
    );
  }

  const stem = fileStem(gene, variant);
  const includedCount = doc.blocks.filter(b => b.included).length;
  const editedCount = doc.blocks.filter(b => b.edited).length;
  const staleCount = doc.blocks.filter(b => b.stale).length;
  const engineCodes = doc.blocks.find(b => b.key === "classification")?.counted ?? [];

  const activePreset = (Object.keys(REPORT_PRESETS) as ReportPresetId[]).find(id =>
    BLOCK_ORDER.every(k => doc.blocks.find(b => b.key === k)?.included === REPORT_PRESETS[id].blocks.includes(k))
  );

  const metaFor = (b: (typeof doc.blocks)[number]) => {
    if (b.stillCounted.length) return `${b.stillCounted.join(", ")} still counted`;
    if (b.edited) return "edited";
    if (b.key === "literature") return `${citations.length} pinned`;
    if (b.counted.length) return b.counted.map(formatEvidenceCode).join(", ");
    if (b.empty) return "empty";
    if (b.status === "pending") return "running";
    if (b.status === "absent") return "no reading";
    return "";
  };

  const exportHtml = () => downloadBlob(`${stem}_evidence_report.html`, "text/html", renderReportHtml(stamped()));
  const exportDocJson = () =>
    downloadBlob(`${stem}_report_document.json`, "application/json", JSON.stringify(renderReportJson(stamped()), null, 2));
  const exportPdf = () => printReport(stamped());
  const exportPptx = async () => {
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

  return (
    <div className="pop-rail rpt-rail" data-testid="report-rail">
      <section className="rail-section" aria-labelledby="rpt-rail-sections">
        <h3 className="eyebrow" id="rpt-rail-sections"><FileText className="w-3.5 h-3.5" aria-hidden="true" />Sections</h3>
        <div className="rpt-seg" role="group" aria-label="Preset">
          {(Object.keys(REPORT_PRESETS) as ReportPresetId[]).map(id => (
            <button key={id} type="button" aria-pressed={activePreset === id} title={REPORT_PRESETS[id].hint} onClick={() => applyPreset(id)}>
              {REPORT_PRESETS[id].label}
            </button>
          ))}
        </div>
        <ul className="rpt-list">
          {doc.blocks.map(b => (
            <li key={b.key} className="rpt-list__row" data-off={b.included ? undefined : ""}>
              <button
                type="button"
                role="checkbox"
                aria-checked={b.included}
                aria-label={`${b.included ? "Leave out" : "Include"} ${b.title}`}
                className="rpt-check"
                onClick={() => toggle(b.key)}
              />
              <span>{b.title}</span>
              <span className="rpt-list__meta">{metaFor(b)}</span>
            </li>
          ))}
        </ul>
        <p className="rpt-p rpt-dim">
          {includedCount} of {doc.blocks.length} blocks included. Presets only choose which boxes are ticked; every block can be changed.
        </p>
      </section>

      <section className="rail-section" aria-labelledby="rpt-rail-export">
        <h3 className="eyebrow" id="rpt-rail-export"><Download className="w-3.5 h-3.5" aria-hidden="true" />Export</h3>
        <ExportRow name="Web page (.html)" note="One file, opens anywhere, keeps the figures" action="Download" onClick={exportHtml} primary />
        <ExportRow name="PDF" note="Opens the print dialog; choose Save as PDF" action="Open" onClick={exportPdf} />
        <ExportRow name="Word (.docx)" note="Editable headings, tables and page numbers" action={docxBusy ? "Building" : "Download"} onClick={exportDocx} disabled={docxBusy} />
        <ExportRow name="PowerPoint (.pptx)" note="Editable summary deck, full text in the notes" action={pptxBusy ? "Building" : "Download"} onClick={exportPptx} disabled={pptxBusy} />
        <ExportRow name="Copy as text" note="Plain text for a record or an email" action={copied ? "Copied" : "Copy"} onClick={copyText} />
        <ExportRow name="Document (.json)" note="This report as data, with your edits marked" action="Download" onClick={exportDocJson} />
        <ExportRow name="Evidence bundle (.json)" note="Full data and provenance, for reproducing" action="Download" onClick={exportBundle} />
        <p className="rpt-p rpt-dim">Left-out blocks are hidden from every format.</p>
      </section>

      <section className="rail-section" aria-labelledby="rpt-rail-doc">
        <h3 className="eyebrow" id="rpt-rail-doc"><UserRound className="w-3.5 h-3.5" aria-hidden="true" />Document</h3>
        <div className="rpt-field">
          <label htmlFor="rpt-title">Title</label>
          <input id="rpt-title" value={meta.title} placeholder={doc.title} onChange={e => setMeta({ title: e.target.value })} />
        </div>
        <div className="rpt-field">
          <label htmlFor="rpt-by">Prepared by</label>
          <input id="rpt-by" value={meta.preparedBy} placeholder="Name, affiliation" onChange={e => setMeta({ preparedBy: e.target.value })} />
        </div>
        <div className="rpt-field">
          <label htmlFor="rpt-case">Case reference</label>
          <input id="rpt-case" value={meta.caseRef} placeholder="Optional" onChange={e => setMeta({ caseRef: e.target.value })} />
        </div>
        <p className="rpt-p rpt-dim">Do not enter patient identifiers. These fields are kept in this browser and go into the exports.</p>
      </section>

      <section className="rail-section" aria-labelledby="rpt-rail-summary">
        <h3 className="eyebrow" id="rpt-rail-summary"><Sparkles className="w-3.5 h-3.5" aria-hidden="true" />Written summary</h3>
        <div>
          <span className="ev-tier" data-tone={aiStatus.tone === "good" ? "good" : aiStatus.tone === "warn" ? "warning" : aiStatus.tone === "bad" ? "danger" : "muted"}>{aiStatus.label}</span>
        </div>
        <p className="rpt-p">{aiStatus.detail}</p>
        <div style={{ display: "flex", gap: 8 }}>
          {isKeyActive ? (
            <button type="button" className="rpt-btn" onClick={() => onRetryNarrative?.()} disabled={isNarrativeBusy || !onRetryNarrative}>
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              {isNarrativeBusy ? "Synthesizing" : isDegraded ? "Generate summary" : "Re-synthesize"}
            </button>
          ) : (
            <button type="button" className="rpt-btn" onClick={() => openSettingsTab("connections")}>
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Configure Gemini
            </button>
          )}
          {onNavigateToView ? (
            <button type="button" className="rpt-btn" onClick={() => onNavigateToView("console")} title="Open Developer Console diagnostics">
              <Terminal className="w-3.5 h-3.5" aria-hidden="true" /> Diagnostics
            </button>
          ) : null}
        </div>
        <p className="rpt-p rpt-dim">The summary is kept in its own block and is never counted in the classification.</p>
      </section>

      <section className="rail-section" aria-labelledby="rpt-rail-trace">
        <h3 className="eyebrow" id="rpt-rail-trace"><GitBranch className="w-3.5 h-3.5" aria-hidden="true" />How the report was built</h3>
        <ol className="rail-steps" data-testid="report-trace">
          <Step n={1} label="Case read">
            The classification, criteria and each block's draft come from the Insights consolidator.{" "}
            {engineCodes.length ? `The engine counted ${engineCodes.map(formatEvidenceCode).join(", ")}.` : "The engine counted no criterion."}
          </Step>
          <Step n={2} label="Your edits" state={staleCount ? "warn" : "done"}>
            {editedCount} {editedCount === 1 ? "block" : "blocks"} edited.
            {staleCount ? ` ${staleCount} changed underneath you and need a look.` : " The evidence has not changed under any edit."}
          </Step>
          <Step n={3} label="Written summary">
            {doc.blocks.find(b => b.key === "summary")?.chips[0]?.label ?? "Not generated"}, kept in its own block.
          </Step>
          <Step n={4} label="Export">Every format renders the same included blocks, and names what was left out.</Step>
        </ol>
      </section>

      <section className="rail-section" aria-labelledby="rpt-rail-src">
        <h3 className="eyebrow" id="rpt-rail-src"><BookOpen className="w-3.5 h-3.5" aria-hidden="true" />Sources</h3>
        <dl className="rail-kv rail-kv--sources">
          <div className="rail-kv__row"><dt>Combining rule</dt><dd>Richards et al. 2015</dd></div>
          <div className="rail-kv__row"><dt>PP3 / BP4</dt><dd>ClinGen SVI · Pejaver et al. 2022</dd></div>
        </dl>
        <p className="rpt-p rpt-dim">Data-source versions are read from the payload and printed in the export.</p>
      </section>
    </div>
  );
};

export default React.memo(ReportInspector);
