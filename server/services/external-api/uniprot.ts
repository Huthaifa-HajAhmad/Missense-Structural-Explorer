import { LRUCache } from "lru-cache";
import { uniprotCache, uniprotFeaturesCache, getCachedOrFetch, defaultCacheRegistry } from "../infra/cache.ts";
import { normalizeGeneSymbol, fetchWithRetry } from "../infra/http-client.ts";
import {
  buildUniprotFeaturesKey,
  buildUniprotSequenceKey,
  buildUniprotIdKey,
  buildUniprotEntryNameKey,
  buildUniprotEntryReferenceKey,
  buildRefSeqProteinKey,
  buildUniprotIsoformKey,
  buildManeIsoformKey,
  buildDisplayedIsoformKey,
} from "../infra/cache-keys.ts";
// Imported from the module that OWNS the accession grammar (not the `utils.ts` barrel, which would
// make this service part of that barrel's import cycle): the entry-name conversion below must hand
// back exactly what `validateUniProt` accepts, and a second copy of the pattern here would drift.
import { UNIPROT_PATTERN } from "../../utils/validation.ts";
import { parseSubunitAssembly, statesMultimer } from "../../../src/shared/multimerAssembly.ts";

export interface UniprotCacheOptions {
  l1Cache?: LRUCache<string, any>;
  bypassSqlite?: boolean;
  /**
   * Cancels the underlying request when the caller stops waiting.
   *
   * The numbering VERIFICATION is bounded by a short budget and is only advisory, so abandoning it
   * must actually stop the work: an orphaned fetch kept retrying for up to its own ~65s envelope,
   * holding a per-host semaphore slot (5 of them starved real UniProt traffic) and booking breaker
   * failures that ejected a healthy provider for the whole cooldown.
   */
  signal?: AbortSignal;
  /**
   * True when the timeout is the CALLER's cap rather than this caller's tolerance for the provider,
   * so a timeout must not be booked against the provider's health.
   */
  cappedByCaller?: boolean;
}

export async function resolveGeneToUniprot(gene: string, options?: UniprotCacheOptions): Promise<string | null> {
  const normGene = normalizeGeneSymbol(gene).toUpperCase();

  const geneToUniprotStatic: Record<string, string> = {
    PAH: "P00439",
    FGFR3: "P22607",
    GBA1: "P04062",
    NAE1: "Q13564",
  };
  
  const cache = options?.l1Cache ?? uniprotCache;

  if (geneToUniprotStatic[normGene]) {
    const staticId = geneToUniprotStatic[normGene];
    cache.set(normGene, staticId);
    cache.set(buildUniprotIdKey(normGene), staticId);
    return staticId;
  }

  return getCachedOrFetch({
    key: buildUniprotIdKey(normGene),
    source: "UniProt Search API",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      try {
        const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=gene_exact:${encodeURIComponent(normGene)}+AND+organism_id:9606+AND+reviewed:true&format=json&size=1`;
        console.log(`[UniProt] Resolving gene symbol ${normGene} via search API...`);
        const res = await fetchWithRetry(searchUrl, {
          headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
          timeout: 15000
        });
        if (!res.ok) {
          console.warn(`[UniProt] Gene lookup failed with status: ${res.status}`);
          return null;
        }
        const data = await res.json() as any;
        if (data.results && data.results.length > 0) {
          const uniprotId = data.results[0].primaryAccession;
          return uniprotId;
        }
      } catch (err) {
        console.error(`[UniProt] Gene lookup error:`, err);
      }
      return null;
    }
  });
}

/**
 * UniProt ENTRY NAME (mnemonic) grammar — `INT11_HUMAN`, `A0A087WXT8_HUMAN`.
 *
 * The underscore is decisive: no UniProt ACCESSION contains one, so this can never misread
 * `Q5TA45` (or an isoform id such as `P04637-2`) as a name.
 */
export const UNIPROT_ENTRY_NAME_PATTERN = /^[A-Z0-9]{1,12}_[A-Z0-9]{1,10}$/;

/** True for a UniProt entry NAME — the identifier form that is NOT an accession. */
export function isUniprotEntryName(value: unknown): boolean {
  return typeof value === "string" && UNIPROT_ENTRY_NAME_PATTERN.test(value.trim().toUpperCase());
}

/**
 * Cached as a wrapper so a definitive "UniProt has no such entry name" is distinguishable from a
 * lookup that never happened — LRUCache's value type excludes null.
 */
export const uniprotEntryNameCache = new LRUCache<string, { accession: string | null }>({ max: 500 });
defaultCacheRegistry.registerCache("uniprotEntryNameCache", uniprotEntryNameCache, {
  ttlDesc: "30d (immutable)",
});

/**
 * Converts a UniProt ENTRY NAME to its ACCESSION (`INT11_HUMAN` -> `Q5TA45`).
 *
 * WHY THIS EXISTS
 * ---------------
 * Ensembl's GRCh37 archive answers VEP's `swissprot` field with the entry NAME, while the GRCh38
 * host answers with the accession — verified live for the SAME locus
 * (`Chr1(GRCh37):g.1256452C>A` -> `swissprot: ["INT11_HUMAN"]`, GRCh38 -> `["Q5TA45.162"]`).
 * The coordinate pipeline forwards `swissprot[0]` as `uniprotId`, so on GRCh37 every missense
 * coordinate whose consequence carried that field was refused with
 * `422 Invalid UniProt accession ID format: "INT11_HUMAN"` — a metadata field killing an otherwise
 * perfectly resolved variant.
 *
 * The query is UniProt's exact `id:` field (the entry name), deliberately NOT a gene lookup: the
 * GRCh37 annotation predates the gene rename and reports `CPSF3L`, the retired symbol, while the
 * entry name itself is unambiguous. The returned accession is re-checked against the accession
 * grammar, so a surprising payload degrades to "no accession" instead of entering the pipeline.
 *
 * Never throws for an unusable name (returns null); provider failures throw so the caller decides
 * whether to degrade or retry, exactly like the other lookups in this module.
 */
export async function resolveUniprotEntryNameToAccession(
  entryName: string,
  options?: UniprotCacheOptions
): Promise<string | null> {
  const key = entryName.trim().toUpperCase();
  if (!isUniprotEntryName(key)) return null;

  const result = await getCachedOrFetch<{ accession: string | null }>({
    key: buildUniprotEntryNameKey(key),
    source: "UniProt Search API (entry name)",
    l1Cache: options?.l1Cache ?? uniprotEntryNameCache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      const url =
        `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`id:${key}`)}` +
        `&fields=accession,id&format=json&size=2`;
      /**
       * ONE attempt under a short cap, because this lookup is METADATA around an answer that is
       * already established: a retry envelope here would spend the request's remaining budget (and
       * the caller's patience) on an optional field. `cappedByCaller` keeps our strict cap from
       * ejecting UniProt for the sequence/isoform fetches that ARE required for the analysis.
       */
      const response = await fetchWithRetry(
        url,
        {
          headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
          timeout: 4000,
          cappedByCaller: true,
          ...(options?.signal ? { signal: options.signal } : {}),
        },
        1,
        0
      );

      // The provider answered about the REQUEST: this entry name is not one it knows.
      if (response.status === 400 || response.status === 404) return { accession: null };
      if (!response.ok) {
        throw new Error(`UniProt entry-name lookup failed with status ${response.status}`);
      }

      const data = (await response.json()) as any;
      // Match the entry name EXACTLY: `id:` is precise, but a differently-shaped payload must not
      // let a neighbouring hit's accession be attached to this name.
      const hit = (data?.results ?? []).find(
        (entry: any) => String(entry?.uniProtkbId ?? "").toUpperCase() === key
      );
      const accession = String(hit?.primaryAccession ?? "").trim().toUpperCase();
      return { accession: UNIPROT_PATTERN.test(accession) ? accession : null };
    },
  });

  return result.accession;
}

/**
 * One Ensembl transcript's place in UniProt's isoform model.
 *
 * `isoformId` is the id whose residue numbering that transcript's protein follows — the datum
 * VEP supplies as `uniprot_isoform` on current releases and that the GRCh37 archive omits.
 */
export interface UniprotIsoformRef {
  /** Versionless Ensembl transcript id, e.g. `ENST00000540437`. */
  transcriptId: string;
  /** Versionless Ensembl protein id, e.g. `ENSP00000445001`. */
  proteinId?: string;
  /** `Q5TA45` (canonical) or an isoform id such as `Q5TA45-5`. */
  isoformId: string;
}

/** Reference data UniProt states about an entry that a provider's payload can be missing. */
export interface UniprotEntryReferenceData {
  /** HGNC-approved symbol UniProt reports (`INTS11`), when it reports one. */
  geneSymbol?: string;
  /** Every symbol UniProt lists for this entry — primary AND synonyms (`INTS11`, `CPSF3L`, …). */
  geneSymbols: string[];
  /** Ensembl transcript -> isoform assignment, from the entry's Ensembl cross-references. */
  isoforms: UniprotIsoformRef[];
}

export const uniprotEntryReferenceCache = new LRUCache<string, UniprotEntryReferenceData>({ max: 500 });
defaultCacheRegistry.registerCache("uniprotEntryReferenceCache", uniprotEntryReferenceCache, {
  ttlDesc: "30d (immutable)",
});

/** `ENST00000540437.5` -> `ENST00000540437`; empty when the value carries no identifier. */
function versionlessId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().split(".")[0]?.trim().toUpperCase();
  return id || undefined;
}

/**
 * UniProt's gene symbols and per-transcript isoform assignment for an accession.
 *
 * WHY THIS EXISTS
 * ---------------
 * Ensembl's GRCh37 archive answers VEP with an annotation release that predates two fields the
 * pipeline depends on:
 *
 *   - `swissprot` carries the entry NAME (`INT11_HUMAN`) instead of the accession (`Q5TA45.162`);
 *   - `uniprot_isoform` is absent entirely, and the gene symbol is the RETIRED one (`CPSF3L`).
 *
 * Consequences, both measured live on `Chr1(GRCh37):g.1256452C>A`:
 *   - the accession-format mismatch refused a resolvable coordinate with a 422 (see
 *     `resolveUniprotEntryNameToAccession`);
 *   - with the numbering unannotated, the route kept the GRCh37 archive's own canonical transcript
 *     (`ENST00000540437`, numbered on isoform `Q5TA45-5` → `p.Arg23Leu`) while the analysis models
 *     canonical `Q5TA45` (position 23 is `S`), so the pipeline refused the variant with a
 *     wild-type mismatch — or would have modelled the WRONG residue had the letters coincided.
 *
 * UniProt states both facts authoritatively, so they are read here rather than guessed:
 * `genes[].geneName` is the current symbol and `synonyms` name the retired ones; the Ensembl
 * cross-references carry `isoformId` per transcript.
 *
 * Never invents a value: an unknown accession (4xx) yields empty reference data, and a provider
 * failure throws so the caller can keep the answer and disclose the missing basis.
 */
export async function fetchUniprotEntryReferenceData(
  canonicalAccession: string,
  options?: UniprotCacheOptions
): Promise<UniprotEntryReferenceData> {
  const key = canonicalAccession.trim().toUpperCase();
  if (!key) return { geneSymbols: [], isoforms: [] };

  return getCachedOrFetch<UniprotEntryReferenceData>({
    key: buildUniprotEntryReferenceKey(key),
    source: "UniProt entry (gene symbols, Ensembl isoform xrefs)",
    l1Cache: options?.l1Cache ?? uniprotEntryReferenceCache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    /**
     * A partial or empty payload is not a fact about the protein — the same lesson as the isoform
     * FASTA endpoint, which answers 200 with a zero-byte body for accessions it cannot serve.
     */
    shouldCache: (data) => data.geneSymbols.length > 0 || data.isoforms.length > 0,
    fetcher: async () => {
      const response = await fetchWithRetry(
        `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(key)}.json` +
          `?fields=xref_ensembl,gene_primary,gene_synonym`,
        {
          headers: { Accept: "application/json" },
          // Advisory enrichment around an answer that is already established: one attempt under our
          // own cap, so it cannot eject UniProt for the sequence fetches that ARE required.
          timeout: 8000,
          cappedByCaller: true,
          ...(options?.signal ? { signal: options.signal } : {}),
        },
        1,
        0
      );

      // The provider answered about the REQUEST: UniProt has no entry for this accession.
      if (response.status === 400 || response.status === 404) {
        return { geneSymbols: [], isoforms: [] };
      }
      if (!response.ok) {
        throw new Error(`UniProt entry lookup failed with status ${response.status}`);
      }

      const data = (await response.json()) as any;

      const genes: any[] = Array.isArray(data?.genes) ? data.genes : [];
      const primary = typeof genes[0]?.geneName?.value === "string" ? genes[0].geneName.value.trim() : "";
      const symbols: string[] = [];
      for (const value of [
        primary,
        ...genes.flatMap((gene) => (gene?.synonyms ?? []).map((s: any) => s?.value)),
      ]) {
        const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
        if (symbol && !symbols.includes(symbol)) symbols.push(symbol);
      }

      const xrefs: any[] = Array.isArray(data?.uniProtKBCrossReferences)
        ? data.uniProtKBCrossReferences
        : [];
      const isoforms: UniprotIsoformRef[] = [];
      for (const xref of xrefs) {
        if (xref?.database !== "Ensembl") continue;
        const isoformId = typeof xref?.isoformId === "string" ? xref.isoformId.trim().toUpperCase() : "";
        if (!isoformId) continue;
        // Only this entry's own isoforms: a neighbouring entry's id must never be attached.
        if (isoformId !== key && !isoformId.startsWith(`${key}-`)) continue;
        const transcriptId = versionlessId(xref?.id);
        if (!transcriptId) continue;
        const proteinId = versionlessId(
          (xref?.properties ?? []).find((p: any) => p?.key === "ProteinId")?.value
        );
        isoforms.push({ transcriptId, ...(proteinId ? { proteinId } : {}), isoformId });
      }

      return { ...(primary ? { geneSymbol: primary } : {}), geneSymbols: symbols, isoforms };
    },
  });
}

export const uniprotSeqCache = new LRUCache<string, string>({ max: 500 });
defaultCacheRegistry.registerCache("uniprotSeqCache", uniprotSeqCache, { ttlDesc: "30d" });

/** One annotated isoform of a UniProt entry, with the sequence its residue numbers refer to. */
export interface UniprotIsoform {
  /** Isoform accession: `Q9Y305` (canonical) or `Q9Y305-4`. */
  id: string;
  sequence: string;
  /** Entry mnemonic from the FASTA header (`ACOT9_HUMAN`) — its first field is the gene symbol. */
  entryName?: string;
}

export const uniprotIsoformsCache = new LRUCache<string, UniprotIsoform[]>({ max: 300 });
defaultCacheRegistry.registerCache("uniprotIsoformsCache", uniprotIsoformsCache, {
  ttlDesc: "30d (immutable)",
});

/**
 * Every isoform sequence of a UniProt entry, canonical first.
 *
 * WHY: a protein notation's residue numbers belong to whichever protein the reporting pipeline
 * used, and MANE Select routinely follows a NON-canonical isoform (ACOT9: MANE `NP_001032248.1`
 * = `Q9Y305-4`, whose numbering differs from canonical `Q9Y305` by a 9-residue insertion).
 * Mapping a position onto the canonical sequence requires both sequences, so both are fetched
 * here and cached — they are immutable reference data.
 */
export async function fetchUniprotIsoforms(
  accession: string,
  options?: UniprotCacheOptions
): Promise<UniprotIsoform[]> {
  const key = accession.toUpperCase();
  const cache = options?.l1Cache ?? uniprotIsoformsCache;

  return getCachedOrFetch({
    key: buildUniprotIsoformKey(key),
    source: "UniProt FASTA (isoforms)",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    // An EMPTY record set is not a fact about the protein: this endpoint answers HTTP 200 with a
    // zero-byte body for accessions it cannot serve (verified live for `Q00000`, `Q9Y305-9`).
    // Caching that as "this entry has no sequences" bricked the accession for 30 days in L1+L2.
    shouldCache: (isoforms) => isoforms.length > 0,
    isUsable: (isoforms) => Array.isArray(isoforms) && isoforms.length > 0,
    fetcher: async () => {
      // MUST use the `stream` resolver: the single-entry `/uniprotkb/{acc}.fasta` endpoint
      // silently IGNORES `includeIsoform=true` and returns only the canonical record, which made
      // every isoform-numbered notation look like an unknown isoform. Verified live — this
      // endpoint returns all records (`Q9Y305`, `-2`, `-3`, `-4`).
      const url =
        `https://rest.uniprot.org/uniprotkb/stream?query=accession:${encodeURIComponent(key)}` +
        `&format=fasta&includeIsoform=true`;
      const response = await fetchWithRetry(url, {
        timeout: 20000,
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.cappedByCaller ? { cappedByCaller: true } : {}),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch UniProt isoforms for ${key} (status ${response.status})`);
      }
      const text = await response.text();
      const isoforms: UniprotIsoform[] = [];
      let current: UniprotIsoform | null = null;
      for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith(">")) {
          // `sp|Q9Y305-4|ACOT9_HUMAN ...` -> Q9Y305-4 / ACOT9_HUMAN
          const parts = line.slice(1).split("|");
          const id = parts[1]?.trim();
          current = id ? { id, sequence: "", entryName: parts[2]?.trim().split(" ")[0] } : null;
          if (current) isoforms.push(current);
          continue;
        }
        if (current) current.sequence += line;
      }
      const usable = isoforms.filter((iso) => iso.sequence.length > 0);
      if (usable.length === 0) {
        throw new Error(
          `UniProt returned no sequence records for ${key}; treating as a provider failure rather than an empty entry`
        );
      }
      return usable;
    },
  });
}

/** Where a RefSeq protein accession sits in UniProt's isoform model. */
export interface RefSeqProteinMapping {
  /** Parent (canonical) UniProt accession, e.g. `Q9Y305`. */
  accession: string;
  proteinId: string;
  /** Isoform whose sequence that protein is: `Q9Y305-1` for canonical, else e.g. `Q9Y305-4`. */
  isoformId?: string;
  /** RefSeq transcript this protein is the product of (`NM_…`). */
  transcriptId?: string;
  /** HGNC symbol when UniProt reports one. */
  geneSymbol?: string;
}

/**
 * Cached as a wrapper because LRUCache's value type excludes null: a definitive "UniProt has no
 * entry for this accession" is still worth caching, so it is stored as `{ mapping: null }`.
 */
export const refSeqProteinCache = new LRUCache<string, { mapping: RefSeqProteinMapping | null }>({
  max: 500,
});
defaultCacheRegistry.registerCache("refSeqProteinCache", refSeqProteinCache, {
  ttlDesc: "30d (immutable)",
});

/**
 * Result of a RefSeq-protein lookup.
 *
 * A DEFINITIVE negative ("UniProt reviewed-human has no such entry") and a PROVIDER FAILURE must
 * not be the same value: the first is a fact about the user's accession and may be cached; the
 * second is a fact about our connection and must never be. Collapsing them (returning `null` for
 * both) once cached a single transient 4xx as "this accession does not exist" for 30 days, in L1
 * and in SQLite, with a message that blamed the user's input.
 */
export type RefSeqLookupResult =
  | { kind: "found"; mapping: RefSeqProteinMapping }
  | { kind: "absent" };

/**
 * Maps a RefSeq protein accession (`NP_001032248.1`) to its UniProt entry AND isoform.
 *
 * The query is filtered to `reviewed:true` + human on purpose. Without that filter the FIRST
 * ranked hit for an accession is frequently an unreviewed TrEMBL record (measured: 9 of 12
 * sampled accessions, e.g. `NP_005219.2` → `F2YGG7` instead of reviewed `P00533`), and the caller
 * — which must pick a sequence to number against — would model an unreviewed protein while
 * reporting `numberingVerified: true`.
 *
 * Throws on provider failure; 4xx request errors and definitive negatives are reported as
 * `absent`. Callers convert a throw into an upstream-unavailable answer.
 */
export async function resolveRefSeqProtein(
  proteinAccession: string,
  options?: UniprotCacheOptions
): Promise<RefSeqLookupResult> {
  const key = proteinAccession.trim().toUpperCase();
  const cache = options?.l1Cache ?? refSeqProteinCache;
  if (!/^NP_\d+(\.\d+)?$/.test(key)) return { kind: "absent" };

  return getCachedOrFetch<RefSeqLookupResult>({
    key: buildRefSeqProteinKey(key),
    source: "UniProt Search API (RefSeq xref)",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    // Only a definitive negative is worth remembering; failures throw and are never cached.
    shouldCache: (result) => result.kind === "absent",
    fetcher: async () => {
      const url =
        `https://rest.uniprot.org/uniprotkb/search?query=` +
        `xref:refseq-${encodeURIComponent(key)}+AND+reviewed:true+AND+organism_id:9606` +
        `&fields=xref_refseq,gene_primary&format=json&size=1`;
      const response = await fetchWithRetry(url, {
        headers: { "User-Agent": "Missense-Structural-Explorer/1.0" },
        timeout: 15000,
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.cappedByCaller ? { cappedByCaller: true } : {}),
      });

      if (response.status === 400 || response.status === 404) {
        // The provider answered about the REQUEST: this accession is not one it knows.
        return { kind: "absent" };
      }
      if (!response.ok) {
        throw new Error(`UniProt RefSeq lookup failed with status ${response.status}`);
      }

      const data = (await response.json()) as any;
      const entry = data?.results?.[0];
      if (!entry?.primaryAccession) return { kind: "absent" };

      const xrefs: any[] = entry.uniProtKBCrossReferences ?? [];
      const versionless = key.split(".")[0];
      const match =
        xrefs.find((x) => x?.database === "RefSeq" && x?.id?.toUpperCase() === key) ??
        xrefs.find(
          (x) => x?.database === "RefSeq" && x?.id?.toUpperCase()?.split(".")[0] === versionless
        );

      const transcriptId = match?.properties?.find(
        (p: any) => p?.key === "NucleotideSequenceId"
      )?.value;

      return {
        kind: "found",
        mapping: {
          accession: String(entry.primaryAccession).toUpperCase(),
          proteinId: match?.id ?? key,
          isoformId: match?.isoformId ? String(match.isoformId).toUpperCase() : undefined,
          transcriptId: transcriptId ? String(transcriptId) : undefined,
          geneSymbol: entry?.genes?.[0]?.geneName?.value,
        },
      };
    },
  });
}

/**
 * The MANE Select protein of an entry, and the UniProt isoform it corresponds to.
 *
 * Needed to scope an AMBIGUITY check to the numberings a notation could plausibly be reported on.
 * A bare protein notation is, in practice, either canonical-numbered or MANE-numbered — labs report
 * the MANE protein — so comparing only those two keeps the refusal set to the real hazard. Measured
 * for ACOT9: 3.4% of positions are ambiguous between canonical and MANE, versus 14.8% once all four
 * isoforms are admitted, and the extra 11.4% comes from isoforms no report would be numbered on.
 */
export async function fetchManeIsoformId(
  uniprotId: string,
  options?: UniprotCacheOptions
): Promise<{ proteinId: string; isoformId?: string } | null> {
  const key = uniprotId.trim().toUpperCase();
  const result = await getCachedOrFetch<{
    mane: { proteinId: string; isoformId?: string } | null;
    /** True only when the response was an entry response for THIS accession. */
    entryConfirmed?: boolean;
  }>({
    key: buildManeIsoformKey(key),
    source: "UniProt entry (MANE-Select xref)",
    l1Cache: options?.l1Cache ?? uniprotIsoformsCache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    // Cache the absence ONLY when the payload positively asserts it (an entry response for THIS
    // accession that carries cross-references but no MANE-Select one). A truncated or partial 200
    // cached as "this gene has no MANE protein" produced false ambiguity refusals for a month.
    shouldCache: (value) => Boolean(value?.mane) || value?.entryConfirmed === true,
    fetcher: async () => {
      // NO `fields` parameter: `fields=xref_mane_select` is not a valid field name and the API
      // answers 400, which silently degraded this lookup to "MANE unknown" and left the ambiguity
      // check comparing every isoform. Verified live — the full entry response is the reliable form,
      // and it is cached for 30 days.
      const response = await fetchWithRetry(
        `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(key)}.json`,
        { headers: { Accept: "application/json" }, timeout: 15000, ...(options?.signal ? { signal: options.signal } : {}), ...(options?.cappedByCaller ? { cappedByCaller: true } : {}) }
      );
      if (!response.ok) {
        throw new Error(`UniProt entry lookup failed with status ${response.status}`);
      }
      const data = (await response.json()) as any;
      const xrefs: any[] = data?.uniProtKBCrossReferences ?? [];
      const entryConfirmed =
        String(data?.primaryAccession ?? "").toUpperCase() === key && xrefs.length > 0;
      const maneXref = xrefs.find((x) => x?.database === "MANE-Select");
      const proteinId = maneXref?.properties?.find((p: any) => p?.key === "RefSeqProteinId")?.value;
      if (!proteinId && !maneXref?.isoformId) {
        return { mane: null, entryConfirmed };
      }

      // The MANE-Select xref states the isoform itself (`isoformId: Q9Y305-4`); the RefSeq
      // cross-reference is the fallback for entries that omit it.
      let isoformId = maneXref?.isoformId ? String(maneXref.isoformId).toUpperCase() : undefined;
      if (!isoformId && proteinId) {
        const refSeq = xrefs.find(
          (x) =>
            x?.database === "RefSeq" &&
            String(x?.id ?? "").toUpperCase() === String(proteinId).toUpperCase()
        );
        isoformId = refSeq?.isoformId ? String(refSeq.isoformId).toUpperCase() : undefined;
      }

      return {
        mane: {
          proteinId: proteinId ? String(proteinId).toUpperCase() : key,
          isoformId,
        },
      };
    },
  });
  return result.mane;
}

/**
 * The isoform UniProt DISPLAYS as the entry's canonical sequence (from the ALTERNATIVE PRODUCTS
 * comment: the isoform with `isoformSequenceStatus: "Displayed"`).
 *
 * Needed for entries whose displayed canonical is isoform N≠1 (e.g. `P02458-2` for COL2A1):
 * UniProt's RefSeq xref then names that id, while the FASTA record is labelled with the bare
 * accession — so the id looks unknown unless the two are reconciled. Only consulted when a
 * declared isoform id had no matching record, so the common path pays nothing.
 */
export async function fetchDisplayedIsoformId(
  uniprotId: string,
  options?: UniprotCacheOptions
): Promise<string | undefined> {
  const key = uniprotId.trim().toUpperCase();
  const result = await getCachedOrFetch<{ isoformId: string | null }>({
    key: buildDisplayedIsoformKey(key),
    source: "UniProt entry (alternative products)",
    l1Cache: options?.l1Cache ?? uniprotIsoformsCache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      const response = await fetchWithRetry(
        `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(key)}.json?fields=cc_alternative_products`,
        { headers: { Accept: "application/json" }, timeout: 15000, ...(options?.signal ? { signal: options.signal } : {}), ...(options?.cappedByCaller ? { cappedByCaller: true } : {}) }
      );
      if (!response.ok) {
        throw new Error(`UniProt entry lookup failed with status ${response.status}`);
      }
      const data = (await response.json()) as any;
      const comment = (data?.comments ?? []).find(
        (c: any) => c?.commentType === "ALTERNATIVE PRODUCTS"
      );
      const displayed = (comment?.isoforms ?? []).find(
        (iso: any) => iso?.isoformSequenceStatus === "Displayed"
      );
      return {
        isoformId: displayed?.isoformIds?.[0]
          ? String(displayed.isoformIds[0]).toUpperCase()
          : null,
      };
    },
  });
  return result.isoformId ?? undefined;
}

export async function fetchUniprotSequence(uniprotId: string, options?: UniprotCacheOptions): Promise<string> {
  const key = uniprotId.toUpperCase();
  const cache = options?.l1Cache ?? uniprotSeqCache;

  return getCachedOrFetch({
    key: buildUniprotSequenceKey(key),
    source: "UniProt FASTA",
    l1Cache: cache,
    ttlSeconds: 30 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      const url = `https://rest.uniprot.org/uniprotkb/${key}.fasta`;
      const response = await fetchWithRetry(url, { timeout: 15000 });
      if (!response.ok) {
        throw new Error(`Failed to fetch UniProt sequence for ${key} (status ${response.status})`);
      }
      const text = await response.text();
      const lines = text.split("\n");
      const sequenceLines = lines.filter(line => !line.startsWith(">") && line.trim() !== "");
      const seq = sequenceLines.join("").replace(/\s/g, "");
      return seq;
    }
  });
}

export interface UniprotFeature {
  type: string;            // e.g. "Active site", "Binding site", "Region", "Domain"
  description: string;
  /** Residue positions (1-indexed, inclusive) */
  start: number;
  end: number;
  interproId?: string;
}

export interface UniprotFeaturesResult {
  features: UniprotFeature[];
  /** Gene name as reported by UniProt */
  geneName: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
  sequenceLength?: number;
  /** UniProt's curated binary interactions (IntAct), the only source a heteromer partner's accession is
   *  taken from: a gene symbol named in the SUBUNIT sentence is resolved against this list or not at all. */
  interactionPartners?: UniprotInteractionPartner[];
}

export interface UniprotInteractionPartner {
  accession: string;
  gene: string | null;
  experiments: number | null;
}

/** Feature types we care about for clinical/functional/domain annotation */
const RELEVANT_FEATURE_TYPES = new Set([
  "Active site",
  "Binding site",
  "Metal binding",
  "Site",
  "Domain",
  "Region",
  "Motif",
  "Repeat",
  "Zinc finger",
  "DNA binding",
  "Transmembrane",
  "Compositional bias",
  "Coiled coil",
  "Disulfide bond",
  "Modified residue",
  "Mutagenesis",
]);

export async function fetchUniprotFeatures(
  uniprotId: string,
  options?: UniprotCacheOptions
): Promise<UniprotFeaturesResult | null> {
  const key = uniprotId.toUpperCase();
  const cache = options?.l1Cache ?? uniprotFeaturesCache;

  return getCachedOrFetch({
    key: buildUniprotFeaturesKey(key),
    source: "UniProt Features API",
    l1Cache: cache,
    ttlSeconds: 14 * 24 * 60 * 60,
    bypassSqlite: options?.bypassSqlite,
    fetcher: async () => {
      try {
        const resp = await fetchWithRetry(
          `https://rest.uniprot.org/uniprotkb/${key}.json`,
          {
            headers: { "Accept": "application/json" },
            timeout: 12000,
          },
          2,
          1200
        );

        if (!resp.ok) {
          console.warn(`[UniProt Features] API ${resp.status} for ${key}`);
          return null;
        }

        const json = await resp.json();
        const rawFeatures: any[] = json?.features ?? [];

        // Extract gene name
        const geneName: string =
          json?.genes?.[0]?.geneName?.value ?? json?.entryType ?? key;

        // Build InterPro cross-reference map for domain annotation enrichment
        const interproMap = new Map<string, string>();
        function normalizeDomainText(str: string): string {
          let s = (str || "").toLowerCase().trim();
          s = s.replace(/[_\-]+/g, " ");
          s = s.replace(/\bprot\b/g, "protein");
          s = s.replace(/\bdom\b/g, "domain");
          s = s.replace(/\bsf\b/g, "superfamily");
          s = s.replace(/\bpk\b/g, "protein kinase");
          s = s.replace(/\bc[- ]?term(inal)?\b/g, "c terminal");
          s = s.replace(/\bn[- ]?term(inal)?\b/g, "n terminal");
          s = s.replace(/\s+c$/g, " c terminal");
          s = s.replace(/\s+n$/g, " n terminal");
          return s.replace(/\s+/g, " ").trim();
        }

        const rawXrefs = json?.uniProtKBCrossReferences ?? [];
        for (const xref of rawXrefs) {
          if (xref?.database === "InterPro" && xref?.id) {
            const entryName = xref.properties?.find((p: any) => p.key === "EntryName")?.value || "";
            if (entryName) {
              interproMap.set(entryName.toLowerCase().trim(), xref.id);
              const normEntry = normalizeDomainText(entryName);
              if (normEntry) {
                interproMap.set(normEntry, xref.id);
              }
            }
          }
        }

        const features: UniprotFeature[] = rawFeatures
          .filter((f: any) => RELEVANT_FEATURE_TYPES.has(f.type))
          .map((f: any) => {
            const ligandInfo = f.ligand?.name ? `Ligand: ${f.ligand.name}` : (f.ligandPart?.name ? `Ligand: ${f.ligandPart.name}` : "");
            const desc = f.description && ligandInfo && !f.description.includes(f.ligand?.name)
              ? `${f.description} (${ligandInfo})`
              : f.description || ligandInfo || "";
            const posVal = f.location?.position?.value;
            const start = f.location?.start?.value ?? posVal ?? 0;
            const end = f.location?.end?.value ?? posVal ?? start;

            let interproId: string | undefined;
            if (f.type === "Domain") {
              const descLower = (f.description || "").toLowerCase().trim();
              const descNorm = normalizeDomainText(f.description || "");
              if (descLower.length >= 2) {
                // Pass 1: Exact or direct suffix match against raw or normalized map
                for (const [iprName, id] of interproMap.entries()) {
                  if (
                    descLower === iprName ||
                    descNorm === iprName ||
                    `${descLower} domain` === iprName ||
                    `${descNorm} domain` === iprName ||
                    descLower === `${iprName} domain` ||
                    descNorm === `${iprName} domain`
                  ) {
                    interproId = id;
                    break;
                  }
                }
                // Pass 2: Normalized prefix / substring match (minimum 4 chars, not generic "domain")
                if (!interproId && descNorm.length >= 4 && descNorm !== "domain") {
                  for (const [iprName, id] of interproMap.entries()) {
                    if (iprName.length >= 4 && iprName !== "domain") {
                      if (
                        iprName.startsWith(descNorm) ||
                        descNorm.startsWith(iprName) ||
                        iprName.includes(descNorm) ||
                        descNorm.includes(iprName)
                      ) {
                        interproId = id;
                        break;
                      }
                    }
                  }
                }
              }
            }

            return {
              type:        f.type,
              description: desc,
              start,
              end,
              interproId
            };
          })
          .filter((f) => f.start > 0 && f.end > 0);

        // Extract subunit comment and check isMultimer
        // UniProt REST puts a SUBUNIT comment's text at `comment.texts[]`, not `comment.note.texts[]`
        // (the shape of SUBCELLULAR LOCATION notes). Reading `note` returned null for every protein,
        // which the Multimer tab rendered as "a single-chain monomer". `note` is kept as a fallback only.
        const subunitBlocks: any[] = (json?.comments ?? []).filter((c: any) => c?.commentType === "SUBUNIT");
        const subunitTexts: string[] = subunitBlocks
          .flatMap((c: any) => [...(c?.texts ?? []), ...(c?.note?.texts ?? [])])
          .map((t: any) => (typeof t?.value === "string" ? t.value.trim() : ""))
          .filter(Boolean);
        const subunitComment = subunitTexts.length ? subunitTexts.join(" ") : null;
        const isMultimer = statesMultimer(parseSubunitAssembly(subunitComment));

        const interactionPartners: UniprotInteractionPartner[] = [];
        for (const c of (json?.comments ?? []) as any[]) {
          if (c?.commentType !== "INTERACTION") continue;
          for (const it of c?.interactions ?? []) {
            const two = it?.interactantTwo;
            const acc = typeof two?.uniProtKBAccession === "string" ? two.uniProtKBAccession : null;
            if (!acc || acc === key || interactionPartners.some(p => p.accession === acc)) continue;
            interactionPartners.push({
              accession: acc,
              gene: typeof two?.geneName === "string" ? two.geneName : null,
              experiments: Number.isFinite(it?.numberOfExperiments) ? it.numberOfExperiments : null,
            });
          }
        }

        const sequenceLength = typeof json?.sequence?.length === "number" ? json.sequence.length : undefined;

        const result: UniprotFeaturesResult = { features, geneName, subunitComment, isMultimer, sequenceLength, interactionPartners };
        return result;
      } catch (err: any) {
        console.error(`[UniProt Features] Error fetching ${key}:`, err.message);
        return null;
      }
    }
  });
}
