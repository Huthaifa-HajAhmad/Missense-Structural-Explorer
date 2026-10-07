/**
 * Residue-in-ortholog mapping from gapped Ensembl Compara alignments.
 * The app's sequence must equal the alignment's human source protein exactly; otherwise no
 * residue claim is made. Columns are walked (never indexed by residue number), and a gap is a
 * gap, not a mismatch. Orthology is predicted: conservation is context, never a verdict.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';

export const alignedHomologySchema = z.object({
  type: z.string(), species: z.string(), taxonId: z.string(), geneId: z.string(), proteinId: z.string(),
  sourceAligned: z.string().min(1), targetAligned: z.string().min(1),
  humanIdentity: z.number().min(0).max(100).nullable(), orthologIdentity: z.number().min(0).max(100).nullable(),
  humanSimilarity: z.number().min(0).max(100).nullable(),
}).refine(h => h.sourceAligned.length === h.targetAligned.length, 'Unequal alignment lengths');
export const alignmentResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']),
  sourceProteinId: z.string().nullable(), homologies: z.array(alignedHomologySchema),
  provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
});
export type AlignmentResponse = z.infer<typeof alignmentResponseSchema>;
export type AlignedHomology = z.infer<typeof alignedHomologySchema>;

export type ResidueState = 'identical' | 'different' | 'gap' | 'reference-mismatch';
export type ResidueMapping = {
  state: ResidueState; targetResidue: string | null; targetPosition: number | null; carriesVariantResidue: boolean;
  window: { human: string; target: string; focus: number } | null;
};
const FLANK = 7;
const GAP = '-';
const ungapped = (s: string) => s.replaceAll(GAP, '');

export function mapResidue(h: AlignedHomology, appSequence: string | null | undefined, position: number | null, wildType: string, mutant: string): ResidueMapping {
  const none: ResidueMapping = { state: 'reference-mismatch', targetResidue: null, targetPosition: null, carriesVariantResidue: false, window: null };
  if (!appSequence || !position || position < 1) return none;
  if (ungapped(h.sourceAligned) !== appSequence || appSequence[position - 1] !== wildType) return none;
  let seen = 0; let targetSeen = 0; let column = -1;
  for (let i = 0; i < h.sourceAligned.length; i++) {
    if (h.targetAligned[i] !== GAP) targetSeen++;
    if (h.sourceAligned[i] !== GAP && ++seen === position) { column = i; break; }
  }
  if (column < 0) return none;
  const t = h.targetAligned[column];
  const from = Math.max(0, column - FLANK); const to = Math.min(h.sourceAligned.length, column + FLANK + 1);
  const window = { human: h.sourceAligned.slice(from, to), target: h.targetAligned.slice(from, to), focus: column - from };
  if (t === GAP) return { state: 'gap', targetResidue: null, targetPosition: null, carriesVariantResidue: false, window };
  return { state: t === wildType ? 'identical' : 'different', targetResidue: t, targetPosition: targetSeen, carriesVariantResidue: t === mutant, window };
}

export const RESIDUE_STATE_LABEL: Record<ResidueState, string> = {
  identical: 'Same residue', different: 'Different residue', gap: 'Gap in alignment', 'reference-mismatch': 'Reference differs',
};
/** Every ortholog row stays; aligned-but-gapped and mismatched are explicit states, not omissions. */
export function buildAlignmentEvidence(data: AlignmentResponse | null, appSequence: string | null | undefined, position: number | null, wildType: string, mutant: string) {
  const rows = (data?.homologies ?? []).map(h => ({ h, m: mapResidue(h, appSequence, position, wildType, mutant) }));
  const referenceOk = rows.length > 0 && rows.every(r => r.m.state !== 'reference-mismatch');
  const identical = rows.filter(r => r.m.state === 'identical').length;
  return { rows, referenceOk, mismatched: rows.length > 0 && !referenceOk, identical, ready: data?.status === 'ready' };
}
