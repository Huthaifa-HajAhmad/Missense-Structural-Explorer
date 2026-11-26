/**
 * Residue-in-ortholog mapping from gapped Ensembl Compara alignments.
 * The app's sequence must equal the alignment's human source protein, or the variant must sit in a
 * 21-residue stretch that occurs exactly once in it (`mapIsoformResidue`: Compara aligns one human
 * isoform per gene, which need not be the run's); otherwise no residue claim is made.
 * Columns are walked (never indexed by residue number), and a gap is a gap, not a mismatch.
 * Orthology is predicted: conservation is context, never a verdict.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';
import { mapIsoformResidue } from './isoformResidue.ts';
import { speciesLabel, speciesOrder } from './modelOrganisms.ts';

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
/** Why no residue is mapped. The app-level causes are the analysis's own inputs and must not be
 * read as an Ensembl difference; `sequence-differs` says the alignment is another protein, and
 * `mixed-sources` that its rows do not even share one human sequence. */
export type MismatchCause = 'no-sequence' | 'no-position' | 'wildtype-differs' | 'sequence-differs' | 'mixed-sources';
export type ResidueMapping = {
  state: ResidueState; targetResidue: string | null; targetPosition: number | null; carriesVariantResidue: boolean;
  window: { human: string; target: string; focus: number } | null;
  mismatchCause: MismatchCause | null;
};
const FLANK = 7;
const GAP = '-';
const ungapped = (s: string) => s.replaceAll(GAP, '');
const unmapped = (cause: MismatchCause): ResidueMapping => ({ state: 'reference-mismatch', mismatchCause: cause, targetResidue: null, targetPosition: null, carriesVariantResidue: false, window: null });

/** The aligned human protein as it reads in a sentence; the provider may not name it. */
export const alignedProteinName = (sourceProteinId: string | null | undefined) => sourceProteinId ?? 'a human protein';

/** Why nothing is mapped. The card, the tab answer and the pinned reading all say it in these words. */
export function mismatchReason(cause: MismatchCause, sourceProteinId: string | null | undefined): string {
  switch (cause) {
    case 'no-sequence': return 'This analysis recorded no protein sequence, so no residue could be compared.';
    case 'no-position': return 'This variant has no protein position, so there is no residue to map.';
    case 'wildtype-differs': return 'The reference residue recorded for this variant does not match the sequence this analysis used, so no residue is mapped.';
    case 'mixed-sources': return 'Ensembl returned ortholog alignments built on different human sequences, so no single position applies and no residue is mapped.';
    case 'sequence-differs': return `Ensembl aligns ${alignedProteinName(sourceProteinId)}, another isoform than the sequence this analysis used, and the 21 residues around this site do not occur exactly once in it, so no residue is mapped.`;
  }
}

/** Species named once each, in the usual order, as they read inside a sentence ("fruit fly", "frog (X. tropicalis)"). */
export function speciesNames(rows: { h: AlignedHomology }[]): string[] {
  const names = [...rows].sort((a, b) => speciesOrder(a.h.taxonId) - speciesOrder(b.h.taxonId))
    .map(({ h }) => speciesLabel(h.taxonId, h.species)).map(name => name.charAt(0).toLowerCase() + name.slice(1));
  return [...new Set(names)];
}

export function mapResidue(h: AlignedHomology, appSequence: string | null | undefined, position: number | null, wildType: string, mutant: string): ResidueMapping {
  if (!appSequence) return unmapped('no-sequence');
  if (!position || position < 1) return unmapped('no-position');
  // The run's own inputs are checked first: a residue that disagrees with the run's sequence is an
  // input fault, not an isoform difference.
  if (appSequence[position - 1] !== wildType) return unmapped('wildtype-differs');
  if (ungapped(h.sourceAligned) !== appSequence) return unmapped('sequence-differs');
  let seen = 0; let targetSeen = 0; let column = -1;
  for (let i = 0; i < h.sourceAligned.length; i++) {
    if (h.targetAligned[i] !== GAP) targetSeen++;
    if (h.sourceAligned[i] !== GAP && ++seen === position) { column = i; break; }
  }
  // With the sequences verified equal, the walk reaches every residue; this guard is not reachable.
  if (column < 0) return unmapped('sequence-differs');
  const t = h.targetAligned[column];
  const from = Math.max(0, column - FLANK); const to = Math.min(h.sourceAligned.length, column + FLANK + 1);
  const window = { human: h.sourceAligned.slice(from, to), target: h.targetAligned.slice(from, to), focus: column - from };
  if (t === GAP) return { state: 'gap', mismatchCause: null, targetResidue: null, targetPosition: null, carriesVariantResidue: false, window };
  return { state: t === wildType ? 'identical' : 'different', mismatchCause: null, targetResidue: t, targetPosition: targetSeen, carriesVariantResidue: t === mutant, window };
}

export const RESIDUE_STATE_LABEL: Record<ResidueState, string> = {
  identical: 'Same residue', different: 'Different residue', gap: 'Gap in alignment', 'reference-mismatch': 'Reference differs',
};
/** Where the variant sits on the aligned human isoform when it is not the run's own sequence. */
export type IsoformBridge = { sourcePosition: number; sourceLength: number; appLength: number };

/** The run's residue placed on the aligned human isoform, or null when it needs no bridge or has none. */
function bridgeIsoform(data: AlignmentResponse | null, appSequence: string | null | undefined, position: number | null, wildType: string): { source: string; bridge: IsoformBridge } | null {
  const first = data?.homologies[0];
  if (!first || !appSequence || !position) return null;
  const source = ungapped(first.sourceAligned);
  if (source === appSequence) return null;
  const mapped = mapIsoformResidue(appSequence, source, position, wildType);
  return mapped === null ? null : { source, bridge: { sourcePosition: mapped, sourceLength: source.length, appLength: appSequence.length } };
}

/** Every ortholog row stays; aligned-but-gapped and mismatched are explicit states, not omissions. */
export function buildAlignmentEvidence(data: AlignmentResponse | null, appSequence: string | null | undefined, position: number | null, wildType: string, mutant: string) {
  const homologies = data?.homologies ?? [];
  // One position is applied to every row, so the rows must be built on one human sequence.
  const mixed = new Set(homologies.map(h => ungapped(h.sourceAligned))).size > 1;
  const bridged = mixed ? null : bridgeIsoform(data, appSequence, position, wildType);
  const rows = homologies.map(h => ({ h, m: mixed ? unmapped('mixed-sources')
    : bridged ? mapResidue(h, bridged.source, bridged.bridge.sourcePosition, wildType, mutant)
    : mapResidue(h, appSequence, position, wildType, mutant) }));
  // The inputs and the human sequence are shared, so every row that is not mapped has the same cause.
  const mismatchCause = rows.find(r => r.m.mismatchCause)?.m.mismatchCause ?? null;
  const identical = rows.filter(r => r.m.state === 'identical').length;
  // One-to-one orthologs answer "is this residue kept?" best; many-to-many family members (8 fly ABC
  // transporters for ABCG1) are paralog-rich, so they are counted apart rather than diluting the answer.
  const oneToOne = rows.filter(r => r.h.type === '1:1');
  const referenceOk = rows.length > 0 && !mismatchCause;
  return { rows, referenceOk, mismatched: mismatchCause !== null, mismatchCause, identical, oneToOne, identicalOneToOne: oneToOne.filter(r => r.m.state === 'identical').length, bridge: bridged?.bridge ?? null, ready: data?.status === 'ready' };
}
