/**
 * Variant locus, the last axis of the Gene–disease tab: does ClinVar list the selected disease among
 * the conditions recorded for THIS variant?
 *
 * INVARIANTS
 *  - Identifier match only (MONDO, OMIM, Orphanet). Never a label or substring match.
 *  - The analysed record is ClinVar's variant-level (VCV) germline aggregate, so its classification
 *    is NOT attributed to the selected disease. Disease-specific RCV/SCV assertions are not read here.
 *  - "No condition IDs" (older saved analyses) is a different state from "no match".
 *  - "not provided" / "not specified" are ClinVar's words for "no condition was named". They are not
 *    diseases: they never match, and a variant with only those has its own state.
 *  - A variant ClinVar holds no record of is its own state (`not-listed`), not "no conditions".
 *  - A condition with no identifier we can cross-walk (MedGen, HPO, MeSH) is neither a match nor a
 *    different condition: it is `unmatchable`, and the card says it cannot be compared.
 *  - A condition's own record (RCV) carries its own classification. That one IS attributed to the
 *    condition; the variant-level aggregate still is not.
 *  - `fullRecord` says whether every condition was read. When it is false the list is only the conditions
 *    behind the aggregate, so "other" and "not provided" must not be read as "no other condition exists".
 *  - Context only: no ACMG criterion is added or changed.
 */
import type { ClinVarData } from './contracts';
import type { DiseaseFrame } from './diseaseFrame';
import { clinvarPresence } from './clinvarPresence';

export type VariantLocusState = 'listed' | 'other-conditions' | 'not-provided' | 'no-condition-ids' | 'no-conditions' | 'not-listed' | 'no-clinvar';
type ConditionRecord = NonNullable<NonNullable<ClinVarData['conditions']>[number]['record']>;
export interface VariantLocusEvidence {
  state: VariantLocusState; matched: string[];
  /** Conditions with an identifier we can compare, none of which is the selected disease. */
  other: string[];
  /** Conditions with no identifier we can compare (MedGen, HPO, MeSH only): not evidence of a different disease. */
  unmatchable: string[];
  /** One entry per ClinVar record of a matched condition (a record listing several matched names joins them). */
  matchedRecords: { label: string; record: ConditionRecord }[];
  classification: string | null; reviewStatus: string | null; uid: string | null;
  fullRecord: boolean;
}

/** ClinVar's placeholders for "no condition was named". */
const UNNAMED = new Set(['not provided', 'not specified']);

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
  const none = { matched: [], matchedRecords: [], other: [], unmatchable: [] };
  if (!clinvar) return { ...none, state: 'no-clinvar', classification: null, reviewStatus: null, uid: null, fullRecord: false };
  const base = { classification: clinvar.classification, reviewStatus: clinvar.reviewStatus || null, uid: clinvar.uid, fullRecord: clinvar.conditionsRead === 'full-record' };
  // The server's "Not found in ClinVar" answer is a record of absence, not a record with no conditions.
  if (clinvarPresence(clinvar) === 'recorded-negative') return { ...base, ...none, state: 'not-listed' };
  const wanted = new Set([frame.diseaseId, ...frame.xrefs].map(fromCurie).filter((v): v is string => !!v));
  const conditions = (clinvar.conditions ?? []).filter(c => c.label);
  if (!conditions.length) return { ...base, ...none, state: clinvar.trait ? 'no-condition-ids' : 'no-conditions' };
  const named = conditions.filter(c => !UNNAMED.has(c.label.trim().toLowerCase()));
  if (!named.length) return { ...base, ...none, state: 'not-provided' };
  const keyed = named.map(c => ({ ...c, keys: c.xrefs.map(x => canonicalXref(x.source, x.id)).filter((v): v is string => !!v) }));
  const unique = (labels: string[]) => [...new Set(labels)];
  const hits = keyed.filter(c => c.keys.some(k => wanted.has(k)));
  const matched = unique(hits.map(c => c.label));
  // One block per ClinVar record: a record covering several matched names is one block, not one per name.
  const byRecord = new Map<string, { labels: string[]; record: ConditionRecord }>();
  for (const c of hits) if (c.record) {
    const entry = byRecord.get(c.record.accession) ?? { labels: [], record: c.record };
    entry.labels.push(c.label);
    byRecord.set(c.record.accession, entry);
  }
  const matchedRecords = [...byRecord.values()].map(({ labels, record }) => ({ label: unique(labels).join('; '), record }));
  const unmatchable = unique(keyed.filter(c => !c.keys.length).map(c => c.label)).filter(l => !matched.includes(l));
  const other = unique(keyed.filter(c => c.keys.length && !hits.includes(c)).map(c => c.label)).filter(l => !matched.includes(l));
  const state: VariantLocusState = matched.length ? 'listed' : other.length ? 'other-conditions' : 'no-condition-ids';
  return { ...base, state, matched, matchedRecords, other, unmatchable };
}
