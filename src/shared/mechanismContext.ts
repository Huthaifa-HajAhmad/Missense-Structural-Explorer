import { z } from 'zod';
// Kept separate from disease validity: mechanism support is not a variant functional vote.
export const mechanismRecordSchema = z.object({
  id: z.string().regex(/^G2P\d+$/), geneId: z.string().regex(/^HGNC:\d+$/), gene: z.string().min(1),
  diseaseId: z.string().regex(/^MONDO:\d{7}$/).nullable(), diseaseLabel: z.string(),
  allelicRequirement: z.string(), modifier: z.string(), confidence: z.string(),
  mechanism: z.string(), support: z.string(), categorisation: z.string(), evidence: z.string(),
  consequence: z.string(), variantTypes: z.string(), publications: z.array(z.string().regex(/^\d+$/)),
  reviewedAt: z.string().nullable(),
});
export type MechanismRecord = z.infer<typeof mechanismRecordSchema>;
export function scopeMechanismRecords(records: MechanismRecord[], frame: { geneId: string; diseaseId: string; inheritance: { id: string } }) {
  const requirement: Record<string, string> = { 'HP:0000006': 'monoallelic_autosomal', 'HP:0000007': 'biallelic_autosomal' };
  const sameDisease = records.filter(r => r.geneId === frame.geneId && r.diseaseId === frame.diseaseId);
  // This compares source allelic labels only. Modifiers remain visible, never resolved for the variant.
  const matching = sameDisease.filter(r => r.allelicRequirement === requirement[frame.inheritance.id]);
  return { matching, unresolvedScope: sameDisease.filter(r => !matching.includes(r)),
    otherDiseaseCount: records.filter(r => !sameDisease.includes(r)).length };
}
