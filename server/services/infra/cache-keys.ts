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
export const CACHE_SCHEMA_VERSION = "v5";
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

export function buildPredictorsKey(gene: string, variant: string, uniprotId?: string): string {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const uId = uniprotId ? `_${uniprotId.trim().toUpperCase()}` : "";
  return `predictors_${normGene}_${cleanVar}${uId}_schema:${CACHE_SCHEMA_VERSION}`;
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

/** Cache key for a UniProt entry's isoform sequences (immutable reference data). */
export function buildUniprotIsoformKey(uniprotId: string): string {
  return `uniprot_isoforms_${uniprotId.trim().toUpperCase()}_schema:${CACHE_SCHEMA_VERSION}`;
}
