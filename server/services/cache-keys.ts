/**
 * cache-keys.ts — Centralized cache key factory and schema version registry.
 * 
 * Provides deterministic, version-tagged cache keys for all cache tiers:
 * Memory LRU, SQLite external_cache, and Biophysical job tables.
 */

import { normalizeGeneSymbol, normalizeVariantTo3Letter } from "./http-client.ts";

export const CACHE_SCHEMA_VERSION = "v4";
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

export function buildConservationKey(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null
): string {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  return `conservation_${normGene}_${cleanVar}_${pdbId || ""}_${chainId || ""}_${pos ?? ""}_${gnomadVariantId || ""}_schema:${CACHE_SCHEMA_VERSION}`;
}
