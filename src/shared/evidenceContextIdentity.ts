/** Keep independently annotated variants apart; never migrate an older, less specific key implicitly. */
export function evidenceContextIdentity(result: { metadata?: {
  gene?: string; uniprotId?: string; variant?: string;
}; transcriptId?: string | null; uniprotIsoform?: string | null; resolvedAssembly?: string | null;
  assembly?: string | null; liftedGenomicCoordinates?: string | null;
}, fallbackGene: string, fallbackVariant: string) {
  const m = result.metadata;
  return JSON.stringify([m?.gene || fallbackGene, m?.uniprotId ?? '', m?.variant || fallbackVariant,
    result.transcriptId ?? '', result.uniprotIsoform ?? '', result.resolvedAssembly ?? result.assembly ?? '',
    result.liftedGenomicCoordinates ?? '']);
}
