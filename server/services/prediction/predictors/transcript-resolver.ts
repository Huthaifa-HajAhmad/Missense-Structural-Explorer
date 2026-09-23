import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../../infra/http-client.ts";

export interface TranscriptMapping {
  refseqId: string | null;
  ensemblId: string | null;
  /**
   * The Ensembl transcript of the UniProt CANONICAL isoform — the sequence this platform models.
   *
   * `ensemblId` is the MANE-Select transcript when one exists, and MANE Select routinely follows a
   * NON-canonical isoform (ACOT9: MANE `ENST00000379303`/Q9Y305-4 vs canonical
   * `ENST00000336430`/Q9Y305-1). Returning only the MANE pair is what made every protein-HGVS
   * predictor query for such genes fail a residue check against a numbering the platform never
   * uses, silently dropping the whole pipeline to the MyVariant fallback (unmapping defect F-2).
   */
  canonicalEnsemblId?: string | null;
  isManeSelect?: boolean;
}

export const transcriptMappingCache = new LRUCache<string, TranscriptMapping>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 7
});

// Official UniProtKB accession format: [OPQ][0-9][A-Z0-9]{3}[0-9] | [A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}
export const UNIPROT_ACCESSION_REGEX = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

export async function getTranscriptsForProtein(proteinOrGene: string): Promise<TranscriptMapping> {
  const cleanInput = proteinOrGene.trim();
  const cached = transcriptMappingCache.get(cleanInput);
  if (cached) return cached;

  try {
    const isUniprot = UNIPROT_ACCESSION_REGEX.test(cleanInput);
    const url = isUniprot 
      ? `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(cleanInput)}.json`
      : `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${encodeURIComponent(cleanInput)}+AND+organism_id:9606&format=json`;

    const res = await fetchWithRetry(url, { timeout: 10000 });
    if (!res.ok) {
      const fallback: TranscriptMapping = { refseqId: null, ensemblId: null };
      transcriptMappingCache.set(proteinOrGene, fallback);
      return fallback;
    }
    const data = await res.json() as any;
    let dbXrefs: any[] = [];
    let primaryAccession: string | null = null;
    if (isUniprot) {
      dbXrefs = data.uniProtKBCrossReferences || [];
      primaryAccession = typeof data.primaryAccession === "string" ? data.primaryAccession : null;
    } else if (data.results && data.results.length > 0) {
      dbXrefs = data.results[0].uniProtKBCrossReferences || [];
      primaryAccession = typeof data.results[0].primaryAccession === "string" ? data.results[0].primaryAccession : null;
    }

    // The Ensembl xref whose ISOFORM is the canonical isoform is the transcript the platform
    // models. Live UniProt names that isoform `Q9Y305-1` — the accession with an explicit "-1"
    // suffix — never the bare accession (external review M-6, verified against the live API),
    // so both spellings are matched. The first ENST xref remains the documented fallback:
    // UniProt lists the canonical isoform's transcript first for reviewed entries, but that
    // ordering is a convention, not a contract — hence the primary rule above.
    // (The pre-existing fallback to a non-ENST Ensembl xref was deliberately dropped: an ENSP
    // or ENSG id is not a transcript and was never usable downstream.)
    const ensemblXrefs = dbXrefs.filter((x: any) => x.database === "Ensembl");
    const isCanonicalIsoform = (iso: unknown) =>
      iso === primaryAccession || iso === `${primaryAccession}-1`;
    const canonicalXref =
      (primaryAccession
        ? ensemblXrefs.find((x: any) => isCanonicalIsoform(x.isoformId) && typeof x.id === "string" && x.id.startsWith("ENST"))
        : undefined) ??
      ensemblXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("ENST"));
    const canonicalEnsemblId: string | null = canonicalXref?.id ?? null;

    // 1. MANE Select Priority: check UniProt dedicated MANE-Select database xref
    const maneXref = dbXrefs.find((x: any) => x.database === "MANE-Select");
    if (maneXref) {
      const ensemblId = typeof maneXref.id === "string" ? maneXref.id : null;
      const refseqProp = maneXref.properties?.find((p: any) => p.key === "RefSeqNucleotideId");
      const refseqId = refseqProp && typeof refseqProp.value === "string" ? refseqProp.value : null;
      const result: TranscriptMapping = { refseqId, ensemblId, canonicalEnsemblId, isManeSelect: true };
      transcriptMappingCache.set(proteinOrGene, result);
      return result;
    }

    // 2. Fallback to RefSeq and Ensembl xrefs if no dedicated MANE-Select entry
    const refseqXrefs = dbXrefs.filter((x: any) => x.database === "RefSeq");
    let refseqId: string | null = null;
    const refseqEntry = refseqXrefs.find((x: any) => {
      const nucProp = x.properties?.find((p: any) => p.key === "NucleotideSequenceId");
      return nucProp && typeof nucProp.value === "string" && nucProp.value.startsWith("NM_");
    });
    if (refseqEntry) {
      const nucProp = refseqEntry.properties.find((p: any) => p.key === "NucleotideSequenceId");
      refseqId = nucProp.value;
    } else {
      refseqId = refseqXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("NM_"))?.id 
              || refseqXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("NP_"))?.id 
              || refseqXrefs[0]?.id || null;
    }

    const result: TranscriptMapping = { refseqId, ensemblId: canonicalEnsemblId, canonicalEnsemblId, isManeSelect: false };
    transcriptMappingCache.set(proteinOrGene, result);
    return result;
  } catch (err: any) {
    console.warn(`[VEP Transcript Resolver] Warning resolving transcripts for ${proteinOrGene}: ${err.message}`);
    const fallback: TranscriptMapping = { refseqId: null, ensemblId: null };
    transcriptMappingCache.set(proteinOrGene, fallback);
    return fallback;
  }
}
