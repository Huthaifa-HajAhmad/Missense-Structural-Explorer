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

/** ClinGen scores 0 as "no evidence available": nothing curated, not a finding that copy number is tolerated (that is 40). */
export const DOSAGE_ZERO_NOTE = 'Score 0 means no evidence was found, not that copy-number change is tolerated.';

export interface DosageReading {
  key: 'haploinsufficiency' | 'triplosensitivity'; name: string; asks: string;
  state: DosageScore['state']; code: DosageCode | null; call: string; tone: DosageTone;
  disease: string | null; diseaseId: string | null; history: string | null;
  /** Exact-MONDO comparison with the selected disease; `unscoped` when either side has no ID. */
  scope: 'same-disease' | 'other-disease' | 'unscoped';
}
export interface DosageEvidence {
  state: 'ready' | 'not-found' | 'error' | 'loading' | 'not-requested';
  readings: DosageReading[]; evaluatedAt: string | null; reportUrl: string | null; message: string | null;
}

function reading(key: DosageReading['key'], score: DosageScore, selectedDiseaseId: string | null): DosageReading {
  const call = score.state === 'scored' ? `${score.code}: ${DOSAGE_CODE_LABELS[score.code as DosageCode]}`
    : score.state === 'not-evaluated' ? 'Not yet evaluated' : 'Not reported';
  return { key, name: key === 'haploinsufficiency' ? 'Haploinsufficiency' : 'Triplosensitivity',
    asks: key === 'haploinsufficiency' ? 'Does losing one gene copy cause disease?' : 'Does an extra gene copy cause disease?',
    state: score.state, code: score.code, call, tone: toneOf(score.code),
    disease: score.disease, diseaseId: score.diseaseId, history: score.history,
    scope: !score.diseaseId || !selectedDiseaseId ? 'unscoped' : score.diseaseId === selectedDiseaseId ? 'same-disease' : 'other-disease' };
}

export function buildDosageEvidence(load: { status: 'loading' | 'ready' | 'error'; data: DosageResponse | null } | undefined, selectedDiseaseId: string | null): DosageEvidence {
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
  return { state: 'ready', evaluatedAt: r.evaluatedAt, reportUrl: r.reportUrl, message: null,
    readings: [reading('haploinsufficiency', r.haploinsufficiency, selectedDiseaseId), reading('triplosensitivity', r.triplosensitivity, selectedDiseaseId)] };
}
