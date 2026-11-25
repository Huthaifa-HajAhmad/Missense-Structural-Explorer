import React, { useRef } from "react";
import { Terminal } from "lucide-react";
import type { AnalysisResult } from "../../../types";
import { useSettings } from "../../../context/SettingsContext";
import { useFoldxRunState } from "../../../hooks/useFoldxRunState";
import { buildExportVerdictContext } from "../../../lib/insightsConsensus";
import { isFallbackNarrative } from "../../../services/pipeline/variantCache";
import { generateProvenanceManifest } from "../../../shared/provenance";
import type { ReportDraft } from "../../../shared/reportInput";
import { parseReportDraftFile } from "../../../stores/reportDraftStorage";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { downloadBlob } from "../reportExport";
import { downloadDraft } from "./draftFile";

interface MoreProps {
  result: AnalysisResult;
  gene: string;
  variant: string;
  stem: string;
  identity: string;
  draft: ReportDraft;
  onDiagnostics?: () => void;
}

/** The raw evidence bundle: every analysis value and its provenance, not the edited report. */
function useEvidenceBundle({ result, gene, variant, stem }: Pick<MoreProps, "result" | "gene" | "variant" | "stem">) {
  const { settings } = useSettings();
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const foldingEnergetics = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingEnergetics ?? s.foldingEnergetics);
  const foldingDdG = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingDdG ?? s.foldingDdG);
  const plddt = useVariantAnalysisStore(s => s.disruptionPredictor?.plddt);
  const { isFolding, foldingStatus } = useFoldxRunState();
  return () => {
    const verdict = buildExportVerdictContext({ result, foldingEnergetics, foldingDdG, plddt, isFolding, foldingStatus });
    const manifest = generateProvenanceManifest(gene, variant, uniprotId || result.metadata?.uniprotId || "", result, settings, foldingEnergetics as any, verdict);
    const degraded = isFallbackNarrative(result.analysis, result.isFallback, result.fallbackReason);
    const bundle = {
      schema: "mse.evidence-bundle/1",
      generatedAt: new Date().toISOString(),
      gene,
      variant,
      narrativeProvenance: {
        isAiSynthesized: !degraded && Boolean(result.analysis),
        fallbackReason: result.fallbackReason ?? null,
        attemptedModels: result.attemptedModels ?? [],
      },
      provenanceManifest: manifest,
      data: {
        ...result,
        foldingEnergetics: foldingEnergetics ?? (result as any).foldingEnergetics,
        foldingDdG: foldingDdG ?? (result as any).foldingDdG,
      },
    };
    downloadBlob(`${stem}_evidence_bundle.json`, "application/json", JSON.stringify(bundle, null, 2));
  };
}

/** Less frequent work, folded away: the raw evidence bundle, draft files and the diagnostics console. */
export function ReportMoreActions(props: MoreProps) {
  const { stem, identity, draft, onDiagnostics } = props;
  const loadDraft = useVariantAnalysisStore(s => s.loadReportDraft);
  const setRecovery = useVariantAnalysisStore(s => s.setReportDraftRecovery);
  const addNotification = useVariantAnalysisStore(s => s.addNotification);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportBundle = useEvidenceBundle(props);

  const reopen = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("The draft is too large.");
      loadDraft(parseReportDraftFile(await file.text(), identity));
      // Reopening a file is the reader's choice of draft, so a pending "which draft?" question is settled.
      setRecovery(null);
      addNotification("success", "Draft reopened for this variant.");
    } catch (err) {
      addNotification("error", err instanceof Error ? err.message : "Could not reopen this draft.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <details className="rpt-rail-section">
      <summary>Evidence bundle, draft files and diagnostics</summary>
      <div className="rpt-export">
        <span className="rpt-export__name">Full evidence bundle (.json)</span>
        <span className="rpt-export__note">All analysis data and provenance. Report exclusions and author edits do not apply.</span>
        <button type="button" className="rpt-btn" aria-label="Download Full evidence bundle (.json)" onClick={exportBundle}>Download</button>
      </div>
      <div className="rpt-draft-actions">
        <button className="rpt-btn" type="button" onClick={() => downloadDraft(stem, identity, draft)}>Save draft file</button>
        <button className="rpt-btn" type="button" onClick={() => fileInput.current?.click()}>Reopen draft</button>
        {onDiagnostics ? <button type="button" className="rpt-btn" onClick={onDiagnostics}><Terminal size={14} aria-hidden="true" />Diagnostics</button> : null}
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Reopen report draft file" hidden onChange={e => void reopen(e.target.files?.[0])} />
    </details>
  );
}
