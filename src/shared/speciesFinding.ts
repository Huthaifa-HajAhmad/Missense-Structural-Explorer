/**
 * The Species & models answer: one headline about the variant site, then one line per source.
 * Built once and rendered by both the tab and the Evidence Lineage rail.
 *
 * INVARIANTS
 * - The headline answers the variant question (is this residue the same in orthologs?) when the
 *   site was placed; record counts never stand in for that answer.
 * - A site that could not be placed is said so; it is never counted as a different residue.
 * - No mouse ortholog, an unscreened mouse and "no significant difference" are three different
 *   statements; none of them is a normal result.
 * - Context only: nothing here feeds an ACMG criterion.
 *
 * Replaced: a banner that counted species and "identifiers" and said nothing about the residue.
 */
import { alignedProteinName, buildAlignmentEvidence, mismatchReason, speciesNames, type AlignmentResponse } from './residueAlignment';
import type { ImpcScreen, ModelOrganismResponse } from './modelOrganisms';
import type { ModelPhenotypesResponse } from './modelPhenotypes';
import { AMINO_ACID_1_TO_3_TITLE } from './aminoAcids';

type Load<T> = { status: 'loading' | 'ready' | 'error'; data: T | null } | undefined;
export type SpeciesFindingInput = {
  models: Load<ModelOrganismResponse>; alignment: Load<AlignmentResponse>; phenotypes: Load<ModelPhenotypesResponse>;
  /** One-letter codes, as the alignment walk compares them with the sequence. */
  residue: { sequence: string | null | undefined; position: number | null; wildType: string; mutant: string };
  /** Phenotype records matching the chosen disease's HPO terms; null when no disease was compared. */
  diseaseMatches: number | null;
};
export type SpeciesFinding = { state: 'reading' | 'failed' | 'ready'; headline: string; facts: { label: string; text: string }[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const aa = (code: string) => AMINO_ACID_1_TO_3_TITLE[code] ?? code;
const failed = (load: Load<{ status: string }>) => load?.status === 'error' || load?.data?.status === 'error';

function siteFact(input: SpeciesFindingInput, evidence: ReturnType<typeof buildAlignmentEvidence>): string {
  const load = input.alignment;
  if (!load || load.status === 'loading') return 'Reading the Ensembl protein alignments.';
  if (failed(load)) return 'Not read: Ensembl did not return the protein alignments.';
  if (load.data?.status !== 'ready' || !evidence.rows.length) return load.data?.message ?? 'Ensembl returned no ortholog alignment for the covered organisms.';
  if (!input.residue.position) return 'Not placed: this variant has no protein position.';
  if (evidence.mismatchCause) return `Not placed. ${mismatchReason(evidence.mismatchCause, load.data.sourceProteinId)}`;
  const gaps = evidence.rows.filter(r => r.m.state === 'gap').length;
  const carriers = speciesNames(evidence.rows.filter(r => r.m.carriesVariantResidue));
  const split = evidence.oneToOne.length > 0 && evidence.oneToOne.length < evidence.rows.length;
  const others = evidence.rows.length - evidence.oneToOne.length;
  return [
    split ? `Same residue in ${evidence.identicalOneToOne} of ${evidence.oneToOne.length} one-to-one orthologs, and in ${evidence.identical - evidence.identicalOneToOne} of ${others} records from many-to-many gene families${gaps ? `; a gap in ${gaps}` : ''}.`
      : `Same residue in ${evidence.identical} of ${evidence.rows.length} aligned orthologs${gaps ? `; a gap in ${gaps}` : ''}.`,
    carriers.length ? `${aa(input.residue.mutant)}, the substituted residue, is the normal residue in ${carriers.join(', ')}; that does not show it is tolerated in human.` : '',
    evidence.bridge ? `Placed on ${alignedProteinName(load.data.sourceProteinId)}, the isoform Ensembl aligns, as its residue ${evidence.bridge.sourcePosition}, by the 21 residues around it.` : '',
  ].filter(Boolean).join(' ');
}

function orthologFact(load: Load<ModelOrganismResponse>): string {
  if (!load || load.status === 'loading') return 'Reading Alliance orthologs.';
  if (failed(load)) return 'Not read: the Alliance did not respond.';
  if (load.data?.status !== 'ready') return load.data?.message ?? 'The Alliance did not resolve this gene.';
  const species = new Set(load.data.orthologs.map(o => o.taxonId)).size;
  return load.data.orthologs.length ? `${plural(load.data.orthologs.length, 'Alliance ortholog')} in ${plural(species, 'species', 'species')}.` : 'No stringent Alliance ortholog.';
}

function mouseFact(load: Load<ModelOrganismResponse>): string {
  if (!load || load.status === 'loading') return 'Reading the IMPC mouse screen.';
  const data = load.data;
  if (failed(load) || data?.status !== 'ready') return 'Not read, because the orthologs were not read.';
  if (data.impc === null) return 'No mouse ortholog, so no IMPC screen.';
  if (data.impc.status === 'error') return 'Not read: IMPC did not respond.';
  if (data.impc.status === 'not-found' || !data.impc.screens.length) return 'IMPC has no record for the mouse ortholog.';
  return data.impc.screens.map(screenSentence).join(' ');
}

/** "Not phenotyped" is IMPC's own answer. A missing answer is a different statement. */
function screenSentence(s: ImpcScreen): string {
  if (s.phenotypingDataAvailable === false) return `IMPC has not phenotyped ${s.symbol}. Absence of data is not a normal result.`;
  if (s.phenotypingDataAvailable === null) return `IMPC does not say whether ${s.symbol} was phenotyped. This is not a normal result.`;
  return `IMPC phenotyped ${s.symbol}: ${s.significant.length ? `a significant difference in ${s.significant.length}` : 'no significant difference in any'} of ${s.significant.length + s.notSignificant.length} reported categories.`;
}

/** What the disease comparison supports. A table that was not read supports no claim either way. */
function diseaseSentence(mapping: ModelPhenotypesResponse['mapping'], matches: number | null): string {
  if (matches === null) return '';
  if (mapping !== 'available') return 'Disease overlap could not be checked, because the cross-species term table was not read.';
  return matches ? `${matches} ${matches === 1 ? 'matches' : 'match'} the chosen disease.` : 'Of these, none match the chosen disease.';
}

function phenotypeFact(load: Load<ModelPhenotypesResponse>, diseaseMatches: number | null): string {
  if (!load || load.status === 'loading') return 'Reading curated phenotypes.';
  if (failed(load)) return 'Not read: the Alliance phenotype service did not respond.';
  const data = load.data;
  if (data?.status !== 'ready') return data?.message ?? 'No curated phenotypes were returned.';
  const ready = data.species.filter(s => s.status === 'ready');
  const shown = ready.reduce((n, s) => n + s.phenotypes.length, 0);
  const withRecords = ready.filter(s => s.phenotypes.length).length;
  const missing = ready.reduce((n, s) => n + Math.max(0, s.total - s.phenotypes.length), 0);
  return [
    shown ? `${plural(shown, 'curated record')} in ${plural(withRecords, 'species', 'species')}.` : 'No curated phenotype records. That is not evidence of a normal organism.',
    missing ? `${missing} more ${missing === 1 ? 'summary has' : 'summaries have'} no resolved term, so this count is partial.` : '',
    shown ? diseaseSentence(data.mapping, diseaseMatches) : '',
  ].filter(Boolean).join(' ').replace('. Of these, none', '; none');
}

export function speciesFinding(input: SpeciesFindingInput): SpeciesFinding {
  const loads = [input.models, input.alignment, input.phenotypes];
  const facts = [] as SpeciesFinding['facts'];
  if (loads.every(l => !l || l.status === 'loading')) return { state: 'reading', headline: 'Reading the model-organism sources.', facts };
  if (loads.every(failed)) return { state: 'failed', headline: 'The model-organism sources could not be read.', facts };
  const { sequence, position, wildType, mutant } = input.residue;
  const evidence = buildAlignmentEvidence(input.alignment?.data?.status === 'ready' ? input.alignment.data : null, sequence, position, wildType, mutant);
  const placed = evidence.ready && evidence.rows.length > 0 && !evidence.mismatchCause && !!position;
  const split = evidence.oneToOne.length > 0 && evidence.oneToOne.length < evidence.rows.length;
  const kept = speciesNames(evidence.oneToOne.filter(r => r.m.state === 'identical'));
  const headline = !placed ? '' : split
    ? `${aa(wildType)}${position} is the same amino acid in ${evidence.identicalOneToOne} of ${evidence.oneToOne.length} one-to-one orthologs${kept.length ? ` (${kept.join(', ')})` : ''}.`
    : `${aa(wildType)}${position} is the same amino acid in ${evidence.identical} of ${evidence.rows.length} aligned orthologs.`;
  const answer = placed ? headline
    : evidence.mismatchCause ? 'The variant site could not be placed in the ortholog alignments.'
    : 'The variant site has no ortholog alignment to read.';
  return { state: 'ready', headline: answer, facts: [
    { label: 'Variant site', text: siteFact(input, evidence) },
    { label: 'Orthologs', text: orthologFact(input.models) },
    { label: 'Mouse screen', text: mouseFact(input.models) },
    { label: 'Curated phenotypes', text: phenotypeFact(input.phenotypes, input.diseaseMatches) },
  ] };
}
