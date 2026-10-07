/**
 * Context only. Assertions remain scoped to gene, disease and inheritance; no winner, score,
 * string-matched disease merge or ACMG input. Snapshot dates never stand in for assertion dates.
 */
import { z } from 'zod';
import { mechanismRecordSchema, scopeMechanismRecords } from './mechanismContext';

export const contextProvenanceSchema = z.object({
  source: z.string(), url: z.string().url(), licence: z.string(),
  release: z.string().nullable(), retrievedAt: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  timestampBasis: z.enum(['download', 'local-import']).optional(),
});
export type ContextProvenance = z.infer<typeof contextProvenanceSchema>;
export const validityAssertionSchema = z.object({
  id: z.string(), level: z.string(), submitter: z.string(), submitterId: z.string(),
  evaluatedAt: z.string().nullable(), reportUrl: z.string().nullable(),
});
export const diseaseFrameSchema = z.object({
  key: z.string(), geneId: z.string(), geneSymbol: z.string(),
  diseaseId: z.string(), label: z.string(), xrefs: z.array(z.string()),
  inheritance: z.object({ id: z.string(), label: z.string() }),
  selectionSource: z.enum(['GenCC', 'Gene2Phenotype']).optional(),
  validity: z.array(validityAssertionSchema),
  // Mechanism requires its own disease/allelic requirement and evidence basis; not dosage or constraint.
  mechanisms: z.array(z.object({ label: z.string(), basis: z.enum(['curated', 'inferred', 'predicted', 'unknown']), source: z.string() })),
  suggestedSystems: z.array(z.string()),
});
export type DiseaseFrame = z.infer<typeof diseaseFrameSchema>;
export const mechanismContextSchema = z.object({
  status: z.enum(['ready', 'not-installed', 'error']), records: z.array(mechanismRecordSchema),
  provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
});
export const geneDiseaseResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-installed', 'error']),
  frames: z.array(diseaseFrameSchema), provenance: contextProvenanceSchema.nullable(),
  message: z.string().nullable(),
  mechanismContext: mechanismContextSchema.optional(),
});
export type GeneDiseaseResponse = z.infer<typeof geneDiseaseResponseSchema>;

export function diseaseFrameKey(geneId: string, diseaseId: string, inheritanceId: string): string {
  return [geneId, diseaseId, inheritanceId].join('|');
}

/** Source-verified G2P disease choices remain separate from GenCC validity coverage. */
export function addVerifiedMechanismChoices(data: GeneDiseaseResponse): GeneDiseaseResponse {
  const frames = [...data.frames]; const keys = new Set(frames.map(f => f.key));
  if (data.mechanismContext?.status !== 'ready') return data;
  const requirements: Record<string, { id: string; label: string }> = {
    monoallelic_autosomal: { id: 'HP:0000006', label: 'Autosomal dominant' },
    biallelic_autosomal: { id: 'HP:0000007', label: 'Autosomal recessive' },
  };
  for (const r of data.mechanismContext.records) {
    const inheritance = Object.hasOwn(requirements, r.allelicRequirement) ? requirements[r.allelicRequirement] : null;
    if (r.gene !== data.gene || !r.diseaseId || !inheritance) continue;
    const key = diseaseFrameKey(r.geneId, r.diseaseId, inheritance.id);
    if (keys.has(key)) continue;
    keys.add(key);
    frames.push({ key, geneId: r.geneId, geneSymbol: r.gene, diseaseId: r.diseaseId, label: r.diseaseLabel,
      inheritance, selectionSource: 'Gene2Phenotype', xrefs: [], validity: [], mechanisms: [], suggestedSystems: [] });
  }
  frames.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { ...data, frames };
}

/** Tone for a GenCC classification. Only dispute/refutation is flagged; strength is never ranked into a verdict. */
export function validityTone(level: string): 'warning' | 'neutral' {
  return /^(disputed|refuted)( evidence)?$/i.test(level) ? 'warning' : 'neutral';
}

export function buildGeneDiseaseEvidence(data: GeneDiseaseResponse | null, selectedKey: string | null) {
  const selected = data?.frames.find(frame => frame.key === selectedKey) ?? null;
  const assertions = selected?.validity ?? [];
  const adverse = assertions.filter(a => /^(disputed|refuted)( evidence)?$/i.test(a.level));
  const levels = [...new Set(assertions.map(a => a.level))];
  const disagreement = levels.length > 1;
  const finding = !selected ? 'Choose a disease to review its assertions.'
    : adverse.length ? 'Disputed or refuted assertions require review.'
    : disagreement ? 'Submitters report different validity levels.'
    : assertions.length ? `${levels[0]} relationship reported.`
    : data?.status === 'not-installed' ? 'GenCC validity is unavailable: snapshot not installed.'
    : data?.status === 'error' ? 'GenCC validity is unavailable: snapshot could not be read.'
    : 'Not curated by the installed GenCC snapshot.';
  return { selected, assertions, adverse, disagreement, finding,
    // Coverage counts say nothing about favourable evidence; no score is emitted.
    causalityAvailable: assertions.length > 0, mechanismAvailable: !!selected &&
      scopeMechanismRecords(data?.mechanismContext?.records ?? [], selected).matching.length > 0 };
}

/**
 * GenCC's ordinal classification, weakest to strongest. It positions one submitter's level on the
 * scale; it is never averaged, and classifications outside it (animal model only, no known disease
 * relationship) are not plotted rather than forced onto a rung.
 */
export const VALIDITY_SCALE = ['Refuted', 'Disputed', 'Limited', 'Supportive', 'Moderate', 'Strong', 'Definitive'] as const;
export function validityPosition(level: string): number | null {
  const i = VALIDITY_SCALE.findIndex(x => x.toLowerCase() === level.replace(/\s+evidence$/i, '').trim().toLowerCase());
  return i < 0 ? null : i;
}
