/**
 * Intake rewrites for notations that NAME a variant (or a gene) instead of spelling a coordinate.
 *
 *   rs113488022            → 7-140753336-A-T      (dbSNP, via Ensembl Variation, GRCh38)
 *   VCV000013961           → 7-140753336-A-T      (ClinVar canonical SPDI, GRCh38)
 *   NAE1:c.347A>G          → ENST00000290810.8:c.347A>G (the gene's canonical = MANE Select transcript)
 *
 * Each rewrite produces an ordinary coordinate/cDNA notation, so everything downstream — the build
 * policy, the VEP → VariantValidator ladder, the missense-only gate, isoform reconciliation — runs
 * unchanged. The rewrite itself is reported (`InputResolution`) so the reader, a report and an agent
 * can all see which coordinate or transcript their identifier was read as.
 *
 * WHY NOTHING HERE PICKS FOR THE READER:
 * - An rsID is frequently multi-allelic (rs113488022 is A/C/G/T — three different substitutions at
 *   BRAF V600). Choosing one would model a variant nobody asked for, so several alleles are a
 *   refusal that lists them as ready-to-run coordinates.
 * - A `c.` position means a different genomic base on every transcript of a gene; handed to VEP as
 *   `NAE1:c.347A>G` it is projected onto ~50 transcripts at different loci. Only the MANE Select
 *   reading is what a bare clinical notation means, so the transcript is pinned BEFORE the query —
 *   to Ensembl's canonical transcript, which Ensembl defines as the MANE Select wherever one exists.
 *   The translate response's `isManeSelect` then confirms it for the transcript actually used.
 */
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { CoordinateResolutionError } from "./types.ts";
import {
  CLINVAR_VCV_PATTERN,
  RSID_PATTERN,
  normalizeGenomicNotation,
} from "../../../src/shared/variantNotation.ts";

export type InputResolutionMethod = "dbsnp-rsid" | "clinvar-vcv" | "gene-canonical-transcript";

/** How a submitted identifier was rewritten before resolution. Echoed in the translate response. */
export interface InputResolution {
  method: InputResolutionMethod;
  /** What the caller typed. */
  submitted: string;
  /** What was actually resolved. */
  resolvedNotation: string;
  /** One sentence a reader can show as-is. */
  note: string;
}

export type IdentifierIntakeOutcome =
  | { status: "unchanged"; notation: string }
  | { status: "rewritten"; notation: string; resolution: InputResolution }
  | {
      status: "refused";
      httpStatus: 404 | 422;
      code: "IDENTIFIER_NOT_FOUND" | "AMBIGUOUS_IDENTIFIER" | "NON_MISSENSE_VARIANT";
      message: string;
      /** Ready-to-run alternatives, when the identifier names several. */
      candidates?: string[];
    };

const PRIMARY_CHROMOSOMES = new Set([
  ...Array.from({ length: 22 }, (_, i) => String(i + 1)),
  "X",
  "Y",
  "MT",
]);

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };

/** Cached for a day: identifier → coordinate mappings change only with database releases. */
const coordinateCache = new LRUCache<string, string[]>({ max: 2_000, ttl: 24 * 60 * 60 * 1000 });
/** `false` records "no such protein-coding gene", so a refusal is not re-fetched on every request. */
const transcriptCache = new LRUCache<string, string | false>({ max: 2_000, ttl: 24 * 60 * 60 * 1000 });

const INTAKE_FETCH_TIMEOUT_MS = 12_000;

async function fetchJson(url: string, signal?: AbortSignal): Promise<any | null> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      { headers: { Accept: "application/json" }, timeout: INTAKE_FETCH_TIMEOUT_MS, signal },
      2
    );
  } catch (err: any) {
    throw new CoordinateResolutionError(
      "upstream_unavailable",
      `Could not reach the identifier service (${new URL(url).hostname}): ${err?.message ?? err}`
    );
  }
  // 400/404 from these services mean "no such identifier", which is an answer, not an outage.
  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) {
    throw new CoordinateResolutionError(
      "upstream_unavailable",
      `The identifier service (${new URL(url).hostname}) answered HTTP ${response.status}.`
    );
  }
  return response.json();
}

/**
 * Every single-nucleotide GRCh38 allele an rsID names, as dashed coordinates (`7-140753336-A-T`).
 * `nonSnv` is true when dbSNP knows the rsID but it is an indel/MNV (rs80357906, BRCA1 5382insC):
 * a different answer from "unknown rsID", and the reader deserves to be told which.
 */
export async function resolveRsIdToCoordinates(
  rsId: string,
  signal?: AbortSignal
): Promise<{ coordinates: string[]; nonSnv: boolean }> {
  const id = rsId.trim().toLowerCase();
  const key = `rsid:${id}`;
  const cached = coordinateCache.get(key);
  if (cached) return { coordinates: cached, nonSnv: false };

  const payload = await fetchJson(
    `https://rest.ensembl.org/variation/human/${encodeURIComponent(id)}?content-type=application/json`,
    signal
  );
  const coordinates: string[] = [];
  const mappings: any[] = Array.isArray(payload?.mappings) ? payload.mappings : [];
  for (const mapping of mappings) {
    if (mapping?.assembly_name !== "GRCh38" || mapping?.coord_system !== "chromosome") continue;
    const chrom = String(mapping.seq_region_name ?? "").toUpperCase();
    if (!PRIMARY_CHROMOSOMES.has(chrom)) continue;
    if (mapping.start !== mapping.end) continue; // not a single-base locus
    const alleles = String(mapping.allele_string ?? "").toUpperCase().split("/");
    if (alleles.length < 2 || alleles.some((a) => !/^[ACGT]$/.test(a))) continue;
    // Alleles are written on the mapping's strand; coordinates here are forward-strand.
    const forward = mapping.strand === -1 ? alleles.map((a) => COMPLEMENT[a]) : alleles;
    const [ref, ...alts] = forward;
    for (const alt of alts) coordinates.push(`${chrom}-${mapping.start}-${ref}-${alt}`);
  }
  const unique = [...new Set(coordinates)];
  if (unique.length) coordinateCache.set(key, unique);
  return { coordinates: unique, nonSnv: unique.length === 0 && mappings.length > 0 };
}

/** RefSeq chromosome accession (GRCh38 `NC_0000NN.v`) → contig name. */
function contigOfRefSeqChromosome(accession: string): string | null {
  const match = accession.match(/^NC_0000(\d{2})\.\d+$/i);
  if (match) {
    const n = Number.parseInt(match[1], 10);
    if (n >= 1 && n <= 22) return String(n);
    if (n === 23) return "X";
    if (n === 24) return "Y";
  }
  return /^NC_012920\.\d+$/i.test(accession) ? "MT" : null;
}

/**
 * The GRCh38 single-nucleotide coordinate a ClinVar Variation (VCV) record describes, from its
 * canonical SPDI. Several entries mean a haplotype/compound record; those are returned whole so the
 * caller refuses rather than picks.
 */
export async function resolveClinVarVcvToCoordinates(
  vcv: string,
  signal?: AbortSignal
): Promise<{ coordinates: string[]; nonSnv: boolean }> {
  const numericId = String(Number.parseInt(vcv.replace(/^VCV/i, "").split(".")[0], 10));
  const key = `vcv:${numericId}`;
  const cached = coordinateCache.get(key);
  if (cached) return { coordinates: cached, nonSnv: false };

  const apiKey = process.env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(process.env.NCBI_API_KEY)}` : "";
  const payload = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=${numericId}&retmode=json${apiKey}`,
    signal
  );
  const record = payload?.result?.[numericId];
  if (!record || record.error) return { coordinates: [], nonSnv: false };

  const coordinates: string[] = [];
  let nonSnv = false;
  for (const entry of Array.isArray(record.variation_set) ? record.variation_set : []) {
    // SPDI: sequence : 0-based interbase position : deleted : inserted.
    const [sequence, position, deleted, inserted] = String(entry?.canonical_spdi ?? "").split(":");
    const contig = sequence ? contigOfRefSeqChromosome(sequence) : null;
    if (!contig || !/^[ACGT]$/i.test(deleted ?? "") || !/^[ACGT]$/i.test(inserted ?? "")) {
      nonSnv = true;
      continue;
    }
    coordinates.push(`${contig}-${Number.parseInt(position, 10) + 1}-${deleted.toUpperCase()}-${inserted.toUpperCase()}`);
  }
  if (!nonSnv) coordinateCache.set(key, coordinates);
  return { coordinates, nonSnv };
}

/**
 * The canonical transcript (with version) of a protein-coding HGNC gene, e.g. `ENST00000290810.8`,
 * or `null` when the symbol is unknown or the gene is not protein-coding.
 *
 * The plain gene lookup, not `expand=1;mane=1`: the expanded payload lists every transcript (BRAF:
 * 40+) and timed out under load, while this answers in under a second.
 */
export async function resolveGeneCanonicalTranscript(gene: string, signal?: AbortSignal): Promise<string | null> {
  const symbol = gene.trim().toUpperCase();
  const cached = transcriptCache.get(symbol);
  if (cached !== undefined) return cached || null;

  const payload = await fetchJson(
    `https://rest.ensembl.org/lookup/symbol/homo_sapiens/${encodeURIComponent(symbol)}?content-type=application/json`,
    signal
  );
  const transcript =
    payload?.biotype === "protein_coding" && typeof payload?.canonical_transcript === "string"
      ? payload.canonical_transcript
      : null;
  transcriptCache.set(symbol, transcript ?? false);
  return transcript;
}

/**
 * True when the token before `:c.` is a gene symbol rather than a sequence accession. Accessions
 * (`NM_`, `ENST…`, `LRG_…`, INSDC ids) always carry a digit run or an underscore prefix that HGNC
 * symbols in this position do not.
 */
function isGeneSymbolReference(token: string): boolean {
  if (/^(?:[A-Z]{2}_|ENS[A-Z]*\d|LRG_)/i.test(token)) return false;
  if (/^[A-Z]{1,2}\d{5,}(?:\.\d+)?$/i.test(token)) return false; // INSDC, e.g. U43746.1
  return /^[A-Z][A-Z0-9-]{0,19}$/i.test(token);
}

function refuseSeveral(submitted: string, kind: string, candidates: string[]): IdentifierIntakeOutcome {
  return {
    status: "refused",
    httpStatus: 422,
    code: "AMBIGUOUS_IDENTIFIER",
    message:
      `${submitted} names ${candidates.length} different ${kind} (${candidates.join(", ")}). ` +
      "Each is a different substitution, so none is chosen for you — run the one you mean.",
    candidates,
  };
}

/**
 * Rewrites an identifier or gene-qualified cDNA notation into a resolvable one, or refuses it.
 * Anything else passes through `unchanged`, so this is safe to call on every translate request.
 */
export async function resolveIdentifierIntake(
  notation: string,
  signal?: AbortSignal
): Promise<IdentifierIntakeOutcome> {
  const submitted = notation.trim();

  if (RSID_PATTERN.test(submitted)) {
    const { coordinates, nonSnv } = await resolveRsIdToCoordinates(submitted, signal);
    if (nonSnv) {
      return {
        status: "refused",
        httpStatus: 422,
        code: "NON_MISSENSE_VARIANT",
        message: `${submitted} is not a single-nucleotide variant in dbSNP, so it cannot be a missense substitution.`,
      };
    }
    if (coordinates.length === 0) {
      return {
        status: "refused",
        httpStatus: 404,
        code: "IDENTIFIER_NOT_FOUND",
        message:
          `${submitted} was not found in dbSNP as a single-nucleotide variant on a GRCh38 chromosome. ` +
          "Enter the genomic coordinate instead (e.g. 7-140753336-A-T).",
      };
    }
    if (coordinates.length > 1) return refuseSeveral(submitted, "alternate alleles", coordinates);
    return {
      status: "rewritten",
      notation: coordinates[0],
      resolution: {
        method: "dbsnp-rsid",
        submitted,
        resolvedNotation: coordinates[0],
        note: `${submitted} resolved to ${coordinates[0]} (GRCh38, dbSNP via Ensembl Variation).`,
      },
    };
  }

  if (CLINVAR_VCV_PATTERN.test(submitted)) {
    const { coordinates, nonSnv } = await resolveClinVarVcvToCoordinates(submitted, signal);
    if (nonSnv && coordinates.length === 0) {
      return {
        status: "refused",
        httpStatus: 422,
        code: "NON_MISSENSE_VARIANT",
        message: `${submitted.toUpperCase()} is not a single-nucleotide variant, so it cannot be a missense substitution.`,
      };
    }
    if (coordinates.length === 0) {
      return {
        status: "refused",
        httpStatus: 404,
        code: "IDENTIFIER_NOT_FOUND",
        message: `${submitted.toUpperCase()} was not found in ClinVar.`,
      };
    }
    if (nonSnv) return {
      status: "refused",
      httpStatus: 422,
      code: "AMBIGUOUS_IDENTIFIER",
      message: `${submitted.toUpperCase()} includes both single-nucleotide and non-single-nucleotide variants. ` +
        "Enter the exact genomic coordinate of the substitution you intend to analyse; no variant was selected automatically.",
      candidates: coordinates,
    };
    if (coordinates.length > 1) return refuseSeveral(submitted.toUpperCase(), "variants", coordinates);
    return {
      status: "rewritten",
      notation: coordinates[0],
      resolution: {
        method: "clinvar-vcv",
        submitted,
        resolvedNotation: coordinates[0],
        note: `${submitted.toUpperCase()} resolved to ${coordinates[0]} (GRCh38, ClinVar canonical SPDI).`,
      },
    };
  }

  // `GENE:c.…` — pinned to the gene's MANE Select transcript before any provider sees it.
  const canonical = normalizeGenomicNotation(submitted);
  const colon = canonical.indexOf(":");
  // Gene symbol first: the cDNA reference grammar's token class has no hyphen, so asking it about
  // `HLA-A:c.…` or `NKX2-1:c.…` answered "no transcript" and the symbol never reached this branch.
  if (colon > 0 && /^c\./.test(canonical.slice(colon + 1))) {
    const token = canonical.slice(0, colon);
    if (isGeneSymbolReference(token)) {
      const transcript = await resolveGeneCanonicalTranscript(token, signal);
      if (!transcript) {
        return {
          status: "refused",
          httpStatus: 422,
          code: "IDENTIFIER_NOT_FOUND",
          message:
            `${token.toUpperCase()} is not a current protein-coding HGNC symbol, so ` +
            `"${canonical.slice(colon + 1)}" cannot be placed. Name the transcript instead, e.g. NM_004333.6:c.1799T>A.`,
        };
      }
      const rewritten = `${transcript}:${canonical.slice(colon + 1)}`;
      return {
        status: "rewritten",
        notation: rewritten,
        resolution: {
          method: "gene-canonical-transcript",
          submitted,
          resolvedNotation: rewritten,
          note:
            `${canonical.slice(colon + 1)} was read on ${transcript}, the ${token.toUpperCase()} canonical ` +
            "transcript (its MANE Select where one exists).",
        },
      };
    }
  }

  return { status: "unchanged", notation };
}

/**
 * The same notation on the CURRENT version of its Ensembl transcript, when the stated version is a
 * retired one — or `null` when the version is current, the id is not a versioned Ensembl
 * transcript, or Ensembl cannot be asked.
 *
 * Used only to EXPLAIN a resolution failure, never to retry silently: Ensembl serves no sequence for
 * a retired version, so nothing can show that the `c.` numbering is unchanged between versions, and
 * a matching reference base alone does not show it. The reader decides; the refusal hands them the
 * current-version notation ready to run. (RefSeq needs none of this: VariantValidator holds every
 * RefSeq version's sequence and resolves the stated one.)
 */
export async function currentEnsemblTranscriptNotation(notation: string): Promise<string | null> {
  const match = notation.trim().match(/^(ENST\d+)\.(\d+)(:[cn]\..+)$/i);
  if (!match) return null;
  const [, id, version, body] = match;
  let payload: any;
  try {
    payload = await fetchJson(
      `https://rest.ensembl.org/lookup/id/${encodeURIComponent(id.toUpperCase())}?content-type=application/json`
    );
  } catch {
    return null; // Best effort: an unreachable Ensembl leaves the original failure unexplained.
  }
  const current = payload?.version;
  if (typeof current !== "number" || String(current) === version) return null;
  return `${id.toUpperCase()}.${current}${body}`;
}

/** Test seam: forget cached identifier mappings. */
export function clearIdentifierIntakeCache(): void {
  coordinateCache.clear();
  transcriptCache.clear();
}
