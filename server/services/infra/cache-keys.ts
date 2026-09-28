/**
 * cache-keys.ts — Centralized cache key factory and schema version registry.
 * 
 * Provides deterministic, version-tagged cache keys for all cache tiers:
 * Memory LRU, SQLite external_cache, and Biophysical job tables.
 */

import { normalizeGeneSymbol, normalizeVariantTo3Letter } from "./http-client.ts";

/**
 * Bumped to v5 when genome-build-awareness was added to the coordinate-bearing keys.
 *
 * The bump must accompany the key change rather than follow it: keys that gained a build
 * component would otherwise leave every entry written under v4 live for its full TTL
 * (14-30 days), and those entries carry no build — so a GRCh38 request could still be served a
 * GRCh37-derived payload while the code looked correct.
 */
/**
 * Payload-shape generation for every persisted cache key.
 *
 * v7 adds the numbering profile's `contested` coverage list and renames its per-entry basis field.
 * Bumped with every shape OR finding change: a profile built by the previous build can call a
 * genuinely ambiguous position "canonical" while having exactly the same shape, so a shape-based guard
 * alone would have kept serving it. Rows of an older generation are purged at startup.
 *
 * v8: the burial word in a cached payload was computed with the retired 5%/25% RSA cutoffs, so a
 * record can carry `burialStatus: "surface"` beside `rsa: 0.30` — a pair the current 15%/35%
 * definition bands as boundary. Same shape, different finding, which is exactly what this version
 * exists to discard; otherwise the panel flags its own stored result as contradictory for up to
 * 30 days.
 */
export const CACHE_SCHEMA_VERSION = "v8";
export const DATA_SOURCES_VERSION = {
  dbnsfp: "4.4a",
  gnomad: "v4.1.0",
  clinvar: "2024-latest",
  foldx: "v2"
};

/**
 * Cache key for a gnomAD allele-frequency lookup.
 *
 * `assembly` participates because the id is a bare `chrom-pos-ref-alt`: gnomAD r4 answers by
 * numeric position, so an hg19 id whose alleles happen to coincide resolves to the GRCh38 locus
 * and returns the wrong population frequency. These frequencies drive PM2 / BA1 / BS1 / PS4 —
 * the highest-impact wrong number this pipeline can produce.
 */
export function buildGnomadFreqKey(variantId: string, assembly?: string | null): string {
  const clean = variantId.trim().replace(/^chr/i, "");
  return `gnomad_freq_${clean}_${assembly ?? "unknown"}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildClinvarKey(gene: string, variant: string, notation?: string): string {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const notStr = notation ? `_${notation.trim()}` : "";
  return `clinvar_${normGene}_${cleanVar}${notStr}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildGenosKey(gene: string, variant: string, gnomadVarId?: string): string {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const gId = gnomadVarId ? `_${gnomadVarId.trim()}` : "";
  return `genos_${normGene}_${cleanVar}${gId}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildPdbKey(pdbId: string, chainId = "A", unpStart = 0, structStart = 0, pos = 0): string {
  const pId = pdbId.trim().toLowerCase();
  const cId = chainId.trim().toUpperCase();
  return `pdb_rcsb_${pId}_chain_${cId}_unp_${unpStart}_struct_${structStart}_pos_${pos}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildBiophysicalKey(
  uniprotId: string,
  variant: string,
  keyHash: string,
  model: string
): string {
  const uId = uniprotId.trim().toUpperCase();
  const vStr = normalizeVariantTo3Letter(variant);
  return `biophysical_${uId}_${vStr}_key:${keyHash}_model:${model}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildGnomadConstraintKey(gene: string): string {
  const normGene = normalizeGeneSymbol(gene);
  return `gnomad_constraint_${normGene}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildUniprotFeaturesKey(uniprotId: string): string {
  const clean = uniprotId.trim().toUpperCase();
  return `uniprot_features_${clean}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildUniprotSequenceKey(uniprotId: string): string {
  const clean = uniprotId.trim().toUpperCase();
  return `uniprot_seq_${clean}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildUniprotIdKey(gene: string): string {
  const normGene = normalizeGeneSymbol(gene);
  return `uniprot_id_${normGene}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Key for a resolved predictor payload.
 *
 * The coordinate participates (normalized, with its build) whenever the caller supplied one:
 * a coordinate-first result is computed at a specific locus, and two different loci must never
 * share a cache entry. The same protein substitution can legitimately sit at two coordinates
 * (`p.Lys272Asn` from C>A and from C>G — same codon position, different nucleotide, different
 * CADD/SpliceAI/gnomAD answer), so keying on gene+variant+uniprot alone lets one request's
 * coordinate-derived result be served to another's (review H2). "nocoord" pins the ladder-only
 * shape so a later coordinate-first result cannot be shadowed by it either.
 */
export function buildPredictorsKey(
  gene: string,
  variant: string,
  uniprotId?: string,
  coord?: { chrom: string; pos: number; ref: string; alt: string; assembly?: string | null } | null
): string {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const uId = uniprotId ? `_${uniprotId.trim().toUpperCase()}` : "";
  const coordPart = coord
    ? `_coord_${coord.chrom.toUpperCase()}:${coord.pos}:${coord.ref.toUpperCase()}>${coord.alt.toUpperCase()}_${coord.assembly ?? "unknown"}`
    : "_nocoord";
  return `predictors_${normGene}_${cleanVar}${uId}${coordPart}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for a conservation payload.
 *
 * The build participates because several of the sources folded in here are single-build
 * (GPN-Star, local dbNSFP, Genos, dbnsfp.org, PopEVE, gnomAD r4), so a payload assembled from one
 * build's coordinates is not a valid answer for another's. The coordinate id alone was not
 * sufficient: it is also empty on the progressive path, leaving the key build-blind in practice.
 */
export function buildConservationKey(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null,
  assembly?: string | null
): string {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  return `conservation_${normGene}_${cleanVar}_${pdbId || ""}_${chainId || ""}_${pos ?? ""}_${gnomadVariantId || ""}_${assembly ?? "unknown"}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildStringKey(gene: string): string {
  const normGene = normalizeGeneSymbol(gene);
  return `string_ppi_${normGene}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for an AlphaGenome lookup.
 *
 * AlphaGenome is GRCh38-only and answers by numeric position, so the build participates for the
 * same reason as the gnomAD key: a coordinate from another build would fetch a different locus.
 */
export function buildAlphaGenomeKey(chrom: string, pos: number, ref: string, alt: string, assembly?: string | null): string {
  const normChrom = chrom.toLowerCase().startsWith("chr") ? chrom.toLowerCase() : `chr${chrom.toLowerCase()}`;
  return `alphagenome_${normChrom}:${pos}:${ref.toUpperCase()}>${alt.toUpperCase()}_${assembly ?? "unknown"}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Key for a coordinate lift between two builds.
 *
 * The build PAIR participates (a GRCh37→GRCh38 lift is not an answer for GRCh38→GRCh37).
 * The ALLELES participate too: the cached value is a full LiftedCoordinate carrying ref/alt,
 * and two SNVs at one position (KRAS c.35G>A then c.35G>T) share a chrom:pos — keying without
 * the alleles served the second variant the FIRST one's alt, re-stamped GRCh38, which then
 * passed every build gate downstream (review H3 — the largest silent-wrongness in the
 * surface). Position mappings are identical per locus; the duplicate entry costs one row.
 */
export function buildCoordinateLiftKey(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  from: string,
  to: string
): string {
  const normChrom = chrom.trim().replace(/^chr/i, "").toUpperCase();
  return `lift_${normChrom}:${pos}:${ref.toUpperCase()}>${alt.toUpperCase()}_${from}>${to}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for genomic/cDNA coordinate -> protein resolution.
 *
 * The mapping from a coordinate to a protein substitution is IMMUTABLE (it is a property
 * of the reference sequence and transcript annotation, not of time), so this key
 * deliberately carries no time component and is safe to persist long-term. Including the
 * assembly prevents a GRCh37 and GRCh38 spelling of the same coordinate from colliding.
 */
export function buildCoordinateTranslationKey(assembly: string, normalizedNotation: string): string {
  return `coord_translation_${assembly.toUpperCase()}_${normalizedNotation.trim().toLowerCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for a RefSeq protein accession -> UniProt entry + isoform mapping.
 *
 * Schema-suffixed like every other key here: the payload shape changed once already (the
 * mapping gained an isoform basis), and a key without the suffix would serve the old shape for
 * the full 30-day TTL after the next change.
 */
export function buildRefSeqProteinKey(proteinAccession: string): string {
  return `refseq_protein_${proteinAccession.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for a UniProt entry's isoform sequences (immutable reference data).
 *
 * Every key here carries `CACHE_SCHEMA_VERSION`: a payload-shape change must not be served from the
 * previous shape's entry, and two keys added without the suffix in the same session proved how easily
 * that rule is missed.
 */
export function buildUniprotIsoformKey(uniprotId: string): string {
  return `uniprot_isoforms_${uniprotId.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for a UniProt ENTRY NAME (mnemonic) -> accession lookup.
 *
 * Ensembl's GRCh37 archive reports VEP's `swissprot` as an entry name (`INT11_HUMAN`) where the
 * GRCh38 host reports the accession (`Q5TA45.162`), so the coordinate pipeline has to convert it
 * before the value can be validated or used to fetch a structure. Keyed by the NAME, not by the
 * coordinate: one entry name is shared by every transcript and every coordinate of that gene.
 */
export function buildUniprotEntryNameKey(entryName: string): string {
  return `uniprot_entry_name_${entryName.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/** Cache key for the MANE-Select cross-reference lookup of an entry. */
export function buildManeIsoformKey(uniprotId: string): string {
  return `uniprot_mane_isoform_${uniprotId.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for a UniProt entry's reference data: its gene symbols and the Ensembl
 * transcript -> isoform assignment.
 *
 * Used to repair payloads from Ensembl's GRCh37 archive, whose VEP response predates both
 * `uniprot_isoform` and the current HGNC symbol (it reports `CPSF3L` for INTS11 and
 * `INT11_HUMAN` for `Q5TA45`). Immutable reference data keyed by the canonical accession.
 */
export function buildUniprotEntryReferenceKey(uniprotId: string): string {
  return `uniprot_entry_reference_${uniprotId.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/** Cache key for the displayed-isoform lookup of an entry. */
export function buildDisplayedIsoformKey(uniprotId: string): string {
  return `uniprot_displayed_isoform_${uniprotId.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}

/**
 * Cache key for a gene's numbering profile (which positions a bare notation cannot disambiguate).
 *
 * Schema-suffixed like every other key: a profile whose shape changes must not be served from the
 * previous shape's entry for a month, because an absent `ambiguous` list reads as "nothing is
 * ambiguous" — a silent wrong-residue answer rather than a stale-display problem.
 */
export function buildNumberingProfileKey(uniprotId: string): string {
  return `numbering_profile_${uniprotId.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}
