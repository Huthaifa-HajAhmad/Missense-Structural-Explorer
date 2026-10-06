import React from 'react';
import { Download } from 'lucide-react';
import type { AnalysisResult } from '../../types';
import type { useEvidenceContext } from '../../hooks/useEvidenceContext';

/** One receipt format on both companion tabs; unrequested sources remain explicit. */
export function EvidenceContextExport({ context, result }: { context: ReturnType<typeof useEvidenceContext>; result: AnalysisResult }) {
  const exportContext = () => {
    const selectedDisease = context.diseaseLoad?.data?.frames.find(f => f.key === context.selection.diseaseKey);
    const blob = new Blob([JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), contextOnly: true,
      gene: context.gene, query: context.key, queryMetadata: result.metadata,
      annotationIdentity: { transcriptId: result.transcriptId ?? null, uniprotIsoform: result.uniprotIsoform ?? null,
        assembly: result.assembly ?? null, resolvedAssembly: result.resolvedAssembly ?? null, liftedGenomicCoordinates: result.liftedGenomicCoordinates ?? null },
      loads: { validity: context.diseaseLoad?.status ?? 'not-requested', adult: context.expressionLoad?.status ?? 'not-requested', development: context.developmentalLoad?.status ?? 'not-requested' },
      unresolvedDiseaseKey: context.selection.diseaseKey && !selectedDisease ? context.selection.diseaseKey : null,
      selection: context.selection, disease: selectedDisease ?? null, validity: context.diseaseLoad?.data ?? null,
      validitySource: context.diseaseLoad?.data?.provenance ?? null, expression: context.expressionLoad?.data ?? null,
      mechanismContext: context.diseaseLoad?.data?.mechanismContext ?? null,
      development: context.developmentalLoad?.data ?? null }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `${context.gene}-evidence-context.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <button type="button" className="ctx-button" onClick={exportContext}><Download size={14} aria-hidden="true" />Export context</button>;
}
