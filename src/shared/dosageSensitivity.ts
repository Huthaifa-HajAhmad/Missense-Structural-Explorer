/**
 * ClinGen dosage sensitivity, the third evidence axis of the Gene–disease tab.
 *
 * INVARIANTS
 *  - Gene-level, whole-copy evidence (haploinsufficiency / triplosensitivity). It says nothing about
 *    a missense change and never feeds the ACMG engine; the tab says so beside the figure.
 *  - Scores are source codes, never averaged or ranked into a headline. 30 and 40 are special
 *    ClinGen codes, not "30 > 3": they are labelled, never compared numerically.
 *  - Absence is a state: "not yet evaluated", "not reported" and "no record" are three different
 *    outcomes and none of them is score 0 ("no evidence").
 *  - A curated disease is compared to the selected disease by exact MONDO ID only. A different or
 *    missing ID is reported as such, never name-matched.
 *
 * The ClinGen API ignores its `search` parameter and returns the whole table, so the server filters
 * by exact HGNC ID / symbol (see server/services/evidence-context/clingenDosage.ts).
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame';

export const DOSAGE_SOURCE_URL = 'https://search.clinicalgenome.org/api/dosage';
export const DOSAGE_CODES = [0, 1, 2, 3, 30, 40] as const;
export type DosageCode = (typeof DOSAGE_CODES)[number];

export const dosageScoreSchema = z.object({
  state: z.enum(['scored', 'not-evaluated', 'not-reported']),
  code: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(30), z.literal(40)]).nullable(),
  disease: z.string().nullable(), diseaseId: z.string().nullable(), history: z.string().nullable(),
});
export type DosageScore = z.infer<typeof dosageScoreSchema>;
export const dosageRecordSchema = z.object({
  symbol: z.string(), geneId: z.string(), location: z.string().nullable(),
  haploinsufficiency: dosageScoreSchema, triplosensitivity: dosageScoreSchema,
  evaluatedAt: z.string().nullable(), reportUrl: z.string().url(),
});
export type DosageRecord = z.infer<typeof dosageRecordSchema>;
export const dosageResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']), record: dosageRecordSchema.nullable(),
  provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
}).superRefine((response, ctx) => {
  // A malformed success is a validation failure, never a confirmed absence of curation.
  if ((response.status === 'ready') !== (response.record !== null)) {
    ctx.addIssue({ code: 'custom', path: ['record'], message: 'Only a ready dosage response may carry a record, and it must carry one.' });
  }
  if (response.record && (response.record.symbol !== response.gene || !/^HGNC:\d+$/.test(response.record.geneId))) {
    ctx.addIssue({ code: 'custom', path: ['record'], message: 'The dosage record must identify the queried gene with an HGNC identifier.' });
  }
});
export type DosageResponse = z.infer<typeof dosageResponseSchema>;

/** Source value → state + code. Unknown codes (e.g. -5) are "not reported", never coerced to a score. */
export function parseDosageScore(value: unknown): Pick<DosageScore, 'state' | 'code'> {
  if (typeof value === 'string' && /^not (?:yet )?evaluated/i.test(value.trim())) return { state: 'not-evaluated', code: null };
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(/^\s*(\d+)\b/.exec(value)?.[1] ?? NaN) : NaN;
  return (DOSAGE_CODES as readonly number[]).includes(n) ? { state: 'scored', code: n as DosageCode } : { state: 'not-reported', code: null };
}

export const DOSAGE_CODE_LABELS: Record<DosageCode, string> = {
  3: 'Sufficient evidence', 2: 'Some evidence', 1: 'Little evidence', 0: 'No evidence available',
  30: 'Associated with a recessive phenotype', 40: 'Dosage sensitivity unlikely',
};
/** Accent marks evidence that copy number matters; everything else is neutral. No red/green: this is not a verdict. */
export type DosageTone = 'accent' | 'neutral';
const toneOf = (code: DosageCode | null): DosageTone => code === 3 || code === 2 ? 'accent' : 'neutral';

/** How a dosage call's curated disease relates to the selected disease, in words for readers. */
export const DOSAGE_SCOPE_NOTE: Record<DosageReading['scope'], string> = {
  'same-disease': 'Curated for the selected disease (exact MONDO ID).',
  'other-disease': 'Curated for a different disease than the one selected.',
  unscoped: 'Disease not matched to the selection: no MONDO ID on one side.',
};

/** ClinGen's meaning of each code, in plain words. 0–3 grade evidence for dosage pathogenicity;
 * 30 and 40 are special categories, not higher scores. */
const DOSAGE_DEFINITIONS: Record<DosageCode, string> = {
  0: 'ClinGen found no evidence either way. This is not a finding that copy-number change is tolerated.',
  1: 'Little evidence that losing or gaining a copy causes disease.',
  2: 'Some evidence that losing or gaining a copy causes disease.',
  3: 'Sufficient evidence that losing or gaining a copy causes disease.',
  30: 'The gene is linked to an autosomal recessive condition, so losing one copy is not expected to cause disease on its own.',
  40: 'Evidence suggests that changing this gene’s copy number does not cause disease.',
};
export interface DosageCodeEntry { code: DosageCode; label: string; kind: 'evidence' | 'special'; definition: string; marks: DosageReading['name'][] }
/** The six codes in display order, each with the readings of this gene that carry it. */
export function dosageReference(readings: readonly DosageReading[]): DosageCodeEntry[] {
  return DOSAGE_CODES.map(code => ({ code, label: DOSAGE_CODE_LABELS[code], kind: code <= 3 ? 'evidence' : 'special', definition: DOSAGE_DEFINITIONS[code],
    marks: readings.filter(r => r.state === 'scored' && r.code === code).map(r => r.name) }));
}

export interface DosageReading {
  key: 'haploinsufficiency' | 'triplosensitivity'; name: 'Haploinsufficiency' | 'Triplosensitivity'; asks: string;
  state: DosageScore['state']; code: DosageCode | null; call: string; tone: DosageTone;
  disease: string | null; diseaseId: string | null; history: string | null;
  /** Exact-MONDO comparison with the selected disease (its own ID or a MONDO cross-reference);
   * `unscoped` when either side has no MONDO ID, so an OMIM-keyed frame is never called "other". */
  scope: 'same-disease' | 'other-disease' | 'unscoped';
}
export interface DosageEvidence {
  state: 'ready' | 'not-found' | 'error' | 'loading' | 'not-requested';
  readings: DosageReading[]; evaluatedAt: string | null; reportUrl: string | null; message: string | null;
}

function reading(key: DosageReading['key'], score: DosageScore, selectedMondo: ReadonlySet<string>): DosageReading {
  const call = score.state === 'scored' ? `${score.code}: ${DOSAGE_CODE_LABELS[score.code as DosageCode]}`
    : score.state === 'not-evaluated' ? 'Not yet evaluated' : 'Not reported';
  return { key, name: key === 'haploinsufficiency' ? 'Haploinsufficiency' : 'Triplosensitivity',
    asks: key === 'haploinsufficiency' ? 'Does losing one gene copy cause disease?' : 'Does an extra gene copy cause disease?',
    state: score.state, code: score.code, call, tone: toneOf(score.code),
    disease: score.disease, diseaseId: score.diseaseId, history: score.history,
    scope: !score.diseaseId || selectedMondo.size === 0 ? 'unscoped' : selectedMondo.has(score.diseaseId.toUpperCase()) ? 'same-disease' : 'other-disease' };
}

/** The selected frame's MONDO IDs: its own ID and its cross-references. Other namespaces (OMIM, Orphanet) are not compared. */
function mondoIds(ids: string | readonly string[] | null): Set<string> {
  const list = ids === null ? [] : typeof ids === 'string' ? [ids] : ids;
  return new Set(list.map(id => id.trim().toUpperCase()).filter(id => id.startsWith('MONDO:')));
}

export function buildDosageEvidence(load: { status: 'loading' | 'ready' | 'error'; data: DosageResponse | null } | undefined, selectedDiseaseIds: string | readonly string[] | null): DosageEvidence {
  const empty = { readings: [], evaluatedAt: null, reportUrl: null };
  if (!load) return { ...empty, state: 'not-requested', message: null };
  if (load.status === 'loading') return { ...empty, state: 'loading', message: null };
  const data = load.data;
  if (load.status === 'error' || !data || data.status === 'error') return { ...empty, state: 'error', message: data?.message ?? null };
  // Retain the guard for cached/legacy payloads that did not pass the current response schema.
  if (data.status === 'not-found') return data.record
    ? { ...empty, state: 'error', message: 'The dosage response contradicts its reported lookup status.' }
    : { ...empty, state: 'not-found', message: data.message };
  if (!data.record || data.record.symbol !== data.gene || !/^HGNC:\d+$/.test(data.record.geneId)) return { ...empty, state: 'error', message: 'The dosage response did not contain a valid record for this gene.' };
  const r = data.record;
  const selectedMondo = mondoIds(selectedDiseaseIds);
  return { state: 'ready', evaluatedAt: r.evaluatedAt, reportUrl: r.reportUrl, message: null,
    readings: [reading('haploinsufficiency', r.haploinsufficiency, selectedMondo), reading('triplosensitivity', r.triplosensitivity, selectedMondo)] };
}
