/**
 * Variant locus, the last axis of the Gene–disease tab: does ClinVar list the selected disease among
 * the conditions recorded for THIS variant?
 *
 * INVARIANTS
 *  - Identifier match only (MONDO, OMIM, Orphanet). Never a label or substring match.
 *  - The analysed record is ClinVar's variant-level (VCV) germline aggregate, so its classification
 *    is NOT attributed to the selected disease. Disease-specific RCV/SCV assertions are not read here.
 *  - "No condition IDs" (older saved analyses) is a different state from "no match".
 *  - Context only: no ACMG criterion is added or changed.
 */
import type { ClinVarData } from './contracts';
import type { DiseaseFrame } from './diseaseFrame';

export type VariantLocusState = 'listed' | 'other-conditions' | 'no-condition-ids' | 'no-conditions' | 'no-clinvar';
export interface VariantLocusEvidence {
  state: VariantLocusState; matched: string[]; other: string[];
  classification: string | null; reviewStatus: string | null; uid: string | null;
}

/** `source:id` in one lower-case spelling; the numeric databases drop any prefix a feed adds. */
export function canonicalXref(source: string, id: string): string | null {
  const s = source.trim().toLowerCase().replace(/^orpha(net)?$/, 'orphanet');
  const v = id.trim();
  if (!s || !v) return null;
  if (s === 'mondo') { const d = /^(?:mondo:)?(\d+)$/i.exec(v)?.[1]; return d ? `mondo:${d.padStart(7, '0')}` : null; }
  if (s === 'omim' || s === 'orphanet') { const digits = /(\d+)$/.exec(v)?.[1]; return digits ? `${s}:${digits}` : null; }
  return null;
}
const fromCurie = (curie: string) => { const i = curie.indexOf(':'); return i < 0 ? null : canonicalXref(curie.slice(0, i), curie.slice(i + 1)); };

export function buildVariantLocusEvidence(clinvar: ClinVarData | null | undefined, frame: Pick<DiseaseFrame, 'diseaseId' | 'xrefs'>): VariantLocusEvidence {
  if (!clinvar) return { state: 'no-clinvar', matched: [], other: [], classification: null, reviewStatus: null, uid: null };
  const base = { classification: clinvar.classification, reviewStatus: clinvar.reviewStatus || null, uid: clinvar.uid };
  const wanted = new Set([frame.diseaseId, ...frame.xrefs].map(fromCurie).filter((v): v is string => !!v));
  const conditions = (clinvar.conditions ?? []).filter(c => c.label);
  if (!conditions.length) return { ...base, state: clinvar.trait ? 'no-condition-ids' : 'no-conditions', matched: [], other: [] };
  const keyed = conditions.map(c => ({ label: c.label, keys: c.xrefs.map(x => canonicalXref(x.source, x.id)).filter((v): v is string => !!v) }));
  // Identifiers we cannot cross-walk (MedGen, HPO, MeSH) are neither a match nor evidence of a different disease.
  if (!keyed.some(c => c.keys.length)) return { ...base, state: 'no-condition-ids', matched: [], other: [...new Set(keyed.map(c => c.label))] };
  const matched = [...new Set(keyed.filter(c => c.keys.some(k => wanted.has(k))).map(c => c.label))];
  const other = [...new Set(keyed.filter(c => !c.keys.some(k => wanted.has(k)) && !matched.includes(c.label)).map(c => c.label))];
  return { ...base, state: matched.length ? 'listed' : 'other-conditions', matched, other };
}
