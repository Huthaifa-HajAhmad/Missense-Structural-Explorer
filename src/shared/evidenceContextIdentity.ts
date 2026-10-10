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

/**
 * The Evidence workspace's scope: the ANALYSED ALLELE, not residue exploration or payload object
 * identity. Built here — beside the other identity scheme, not inline in a component — so every
 * consumer of Evidence state derives the same key and a field change is reviewed in one place.
 *
 * Fields beyond {@link evidenceContextIdentity}: the queried residue and the gnomAD allele identity
 * (id + assembly), which pin the exact analysed allele the workspace retains state for.
 */
export function evidenceWorkspaceIdentity(result: {
  metadata?: { gene?: string; variant?: string; uniprotId?: string; residueIndex?: number | null } | null;
  transcriptId?: string | null; predictorData?: {
    transcriptId?: string | null; gnomadVariantId?: string | null; gnomadVariantAssembly?: string | null;
  } | null;
} | null): string {
  const m = result?.metadata;
  return JSON.stringify([m?.gene, m?.variant, m?.uniprotId, m?.residueIndex,
    result?.transcriptId ?? result?.predictorData?.transcriptId,
    result?.predictorData?.gnomadVariantId, result?.predictorData?.gnomadVariantAssembly]);
}
