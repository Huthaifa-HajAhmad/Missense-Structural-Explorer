/**
 * cache-keys.ts — Centralized cache key factory and schema version registry.
 * 
 * Provides deterministic, version-tagged cache keys for all cache tiers:
 * Memory LRU, SQLite external_cache, and Biophysical job tables.
 */

export const CACHE_SCHEMA_VERSION = "v3";
export const DATA_SOURCES_VERSION = {
  dbnsfp: "4.4a",
  gnomad: "v4.1.0",
  clinvar: "2024-latest",
  foldx: "v2"
};

export function buildGnomadFreqKey(variantId: string): string {
  const clean = variantId.trim().replace(/^chr/i, "");
  return `gnomad_freq_${clean}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildClinvarKey(gene: string, variant: string, notation?: string): string {
  const normGene = gene.trim().toUpperCase();
  const cleanVar = variant.trim();
  const notStr = notation ? `_${notation.trim()}` : "";
  return `clinvar_${normGene}_${cleanVar}${notStr}_schema:${CACHE_SCHEMA_VERSION}`;
}

export function buildGenosKey(gene: string, variant: string, gnomadVarId?: string): string {
  const normGene = gene.trim().toUpperCase();
  const cleanVar = variant.trim();
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
  const vStr = variant.trim();
  return `biophysical_${uId}_${vStr}_key:${keyHash}_model:${model}_schema:${CACHE_SCHEMA_VERSION}`;
}
