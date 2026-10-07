/**
 * reportInput.ts — one assembly of a run into `buildReportDocument`'s input.
 *
 * The Report screen, its rail and the store's copy-as-text all need the same document. Each used to
 * assemble its own verdict, criteria list and narrative label and they drifted (two Copy buttons
 * emitted different documents for one run). They now call this, so a change to what a document
 * contains is made once.
 */
import type { DeepEvidenceContext } from "./deepModelEvidence.ts";
import type { AnalysisResult } from "./contracts.ts";
import { deriveNarrativeAuthorship } from "./narrativeAuthorship.ts";
import { isFallbackNarrative } from "./narrativeFallback.ts";
import { insightsEvidenceFor } from "./insightsSnapshot.ts";
import {
  type BlockKey,
  type ReportCitation,
  type ReportDocumentInput,
  type ReportEdit,
} from "./reportDocument.ts";

export interface ReportDraft {
  sections: Record<BlockKey, boolean>;
  edits: Partial<Record<BlockKey, ReportEdit>>;
  meta: { title: string; preparedBy: string; caseRef: string };
  citations: ReportCitation[];
}

export function reportNarrativeFrom(result: AnalysisResult | null): ReportDocumentInput["narrative"] {
  const text = result?.analysis ?? "";
  const authorship = deriveNarrativeAuthorship({
    analysis: text,
    isDegraded: isFallbackNarrative(text, result?.isFallback, result?.fallbackReason),
    declaredSource: (result?.insights as { source?: string } | undefined)?.source,
  });
  return {
    text: authorship === "none" ? "" : text,
    authorship,
    model: (result?.insights as { model?: string } | undefined)?.model ?? null,
  };
}

export function reportInputFromRun(args: {
  result: AnalysisResult | null;
  gene: string;
  variant: string;
  uniprotId: string;
  foldingEnergetics?: Record<string, any> | null;
  foldingDdG?: number | null;
  foldingStatus?: string | null;
  narrativeContext?: DeepEvidenceContext;
  isLoading?: boolean;
  draft: ReportDraft;
  generatedAt?: string | null;
}): ReportDocumentInput {
  const { result, draft } = args;
  return {
    result,
    insights: insightsEvidenceFor({
      result,
      foldingEnergetics: args.foldingEnergetics,
      foldingDdG: args.foldingDdG,
      isLoading: args.isLoading,
    }),
    gene: args.gene,
    variant: args.variant,
    uniprotId: args.uniprotId,
    foldingEnergetics: args.foldingEnergetics ?? null,
    foldingDdG: args.foldingDdG ?? null,
    foldingStatus: args.foldingStatus ?? null,
    narrativeContext: args.narrativeContext,
    isLoading: args.isLoading,
    narrative: reportNarrativeFrom(result),
    citations: draft.citations,
    sections: draft.sections,
    edits: draft.edits,
    meta: draft.meta,
    generatedAt: args.generatedAt ?? null,
  };
}
