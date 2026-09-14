import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../../infra/http-client.ts";

export interface TranscriptMapping {
  refseqId: string | null;
  ensemblId: string | null;
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
    if (isUniprot) {
      dbXrefs = data.uniProtKBCrossReferences || [];
    } else if (data.results && data.results.length > 0) {
      dbXrefs = data.results[0].uniProtKBCrossReferences || [];
    }

    // 1. MANE Select Priority: check UniProt dedicated MANE-Select database xref
    const maneXref = dbXrefs.find((x: any) => x.database === "MANE-Select");
    if (maneXref) {
      const ensemblId = typeof maneXref.id === "string" ? maneXref.id : null;
      const refseqProp = maneXref.properties?.find((p: any) => p.key === "RefSeqNucleotideId");
      const refseqId = refseqProp && typeof refseqProp.value === "string" ? refseqProp.value : null;
      const result: TranscriptMapping = { refseqId, ensemblId, isManeSelect: true };
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

    const ensemblXrefs = dbXrefs.filter((x: any) => x.database === "Ensembl");
    const ensemblId = ensemblXrefs.find((x: any) => typeof x.id === "string" && x.id.startsWith("ENST"))?.id 
                   || ensemblXrefs[0]?.id || null;

    const result: TranscriptMapping = { refseqId, ensemblId, isManeSelect: false };
    transcriptMappingCache.set(proteinOrGene, result);
    return result;
  } catch (err: any) {
    console.warn(`[VEP Transcript Resolver] Warning resolving transcripts for ${proteinOrGene}: ${err.message}`);
    const fallback: TranscriptMapping = { refseqId: null, ensemblId: null };
    transcriptMappingCache.set(proteinOrGene, fallback);
    return fallback;
  }
}
