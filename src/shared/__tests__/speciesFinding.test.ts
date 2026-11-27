import { describe, expect, it } from 'vitest';
import { speciesFinding, type SpeciesFindingInput } from '../speciesFinding';
import type { AlignmentResponse, AlignedHomology } from '../residueAlignment';
import type { ModelOrganismResponse } from '../modelOrganisms';
import type { ModelPhenotypesResponse } from '../modelPhenotypes';

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const hom = (taxonId: string, species: string, target: string): AlignedHomology => ({ type: '1:1', species, taxonId, geneId: `G-${species}`, proteinId: `P-${species}`,
  sourceAligned: 'MACDEFGHIK', targetAligned: target, humanIdentity: 80, orthologIdentity: 80, humanSimilarity: 90 });
const alignment: AlignmentResponse = { gene: 'X', status: 'ready', sourceProteinId: 'ENSP1', provenance: null, message: null, homologies: [
  hom('NCBITaxon:10090', 'mus_musculus', 'MACDEFGHIK'), hom('NCBITaxon:10116', 'rattus_norvegicus', 'MACDEFGHIK'), hom('NCBITaxon:7955', 'danio_rerio', 'MAQDEFGHIK')] };
const models: ModelOrganismResponse = { gene: 'X', status: 'ready', hgncId: 'HGNC:1', provenance: [], message: null,
  orthologs: [{ id: 'MGI:1', symbol: 'Xm', taxonId: 'NCBITaxon:10090', species: 'Mouse' }, { id: 'RGD:1', symbol: 'Xr', taxonId: 'NCBITaxon:10116', species: 'Rat' }]
    .map(o => ({ ...o, bestForward: true, bestReverse: true, confidence: null, methodCount: 3 })),
  impc: { status: 'ready', screens: [{ mgiId: 'MGI:1', symbol: 'Xm', phenotypeStatus: 'Complete', phenotypingDataAvailable: true, embryoDataAvailable: null,
    significant: ['nervous system phenotype'], notSignificant: ['skeleton phenotype', 'hearing/vestibular/ear phenotype'] }] } };
const phenotypes: ModelPhenotypesResponse = { gene: 'X', status: 'ready', mapping: 'available', provenance: [], message: null,
  species: [{ taxonId: 'NCBITaxon:10090', species: 'Mouse', orthologId: 'MGI:1', symbol: 'Xm', status: 'ready', total: 3,
    phenotypes: [{ termId: 'MP:1', statement: 'a', annotations: 1, models: 1, humanTerms: [] }, { termId: 'MP:2', statement: 'b', annotations: 1, models: 1, humanTerms: [] }] }] };
const input = (patch: Partial<SpeciesFindingInput> = {}): SpeciesFindingInput => ({
  models: ready(models), alignment: ready(alignment), phenotypes: ready(phenotypes),
  residue: { sequence: 'MACDEFGHIK', position: 3, wildType: 'C', mutant: 'Q' }, diseaseMatches: null, ...patch,
});

describe('Species & models answer', () => {
  it('answers the variant-site question first, then one line per source', () => {
    const f = speciesFinding(input());
    expect(f.state).toBe('ready');
    expect(f.headline).toBe('Cys3 is the same amino acid in 2 of 3 aligned orthologs.');
    expect(f.facts.map(x => x.label)).toEqual(['Variant site', 'Orthologs', 'Mouse screen', 'Curated phenotypes']);
    expect(f.facts[0].text).toContain('Gln, the substituted residue, is the normal residue in zebrafish');
    expect(f.facts[1].text).toBe('2 Alliance orthologs in 2 species.');
    expect(f.facts[2].text).toBe('IMPC phenotyped Xm: a significant difference in 1 of 3 reported categories.');
    expect(f.facts[3].text).toBe('2 curated records in 1 species. 1 more summary has no resolved term, so this count is partial.');
  });

  it('names the isoform the site was placed on when Ensembl aligned another one', () => {
    const aligned = 'MQWERTYIPLKHGFDSNMVCAELMNPRSTVWY';
    const long = { ...alignment, homologies: [{ ...alignment.homologies[0], sourceAligned: aligned, targetAligned: aligned }] };
    const f = speciesFinding(input({ alignment: ready(long), residue: { sequence: `MSTT${aligned.slice(1)}`, position: 17, wildType: aligned[13], mutant: 'Q' } }));
    expect(f.headline).toBe(`Phe17 is the same amino acid in 1 of 1 aligned orthologs.`);
    expect(f.facts[0].text).toContain('Placed on ENSP1, the isoform Ensembl aligns, as its residue 14');
  });

  it('answers from one-to-one orthologs and counts many-to-many family members apart', () => {
    const fly = { ...hom('NCBITaxon:7227', 'drosophila_melanogaster', 'MACDEFGHIK'), type: 'many:many' };
    const f = speciesFinding(input({ alignment: ready({ ...alignment, homologies: [alignment.homologies[1], alignment.homologies[0], alignment.homologies[2], fly] }) }));
    expect(f.headline).toBe('Cys3 is the same amino acid in 2 of 3 one-to-one orthologs (mouse, rat).');
    expect(f.facts[0].text).toMatch(/^Same residue in 2 of 3 one-to-one orthologs, and in 1 of 1 records from many-to-many gene families\./);
  });

  it('says the site was not placed instead of counting a mismatch as a difference', () => {
    const f = speciesFinding(input({ residue: { sequence: 'ZZZZZZZZZZ', position: 3, wildType: 'Z', mutant: 'Q' } }));
    expect(f.headline).toBe('The variant site could not be placed in the ortholog alignments.');
    expect(f.facts[0].text).toMatch(/^Not placed/);
  });

  it('counts disease matches only when a disease was compared', () => {
    expect(speciesFinding(input({ diseaseMatches: 0 })).facts[3].text).toContain('none match the chosen disease');
  });

  it('makes no disease claim when the term table could not be read', () => {
    const f = speciesFinding(input({ phenotypes: ready({ ...phenotypes, mapping: 'unavailable' as const }), diseaseMatches: 0 }));
    expect(f.facts[3].text).not.toMatch(/none match/i);
    expect(f.facts[3].text).toContain('Disease overlap could not be checked');
  });

  it('counts a single disease match in the singular', () => {
    expect(speciesFinding(input({ diseaseMatches: 1 })).facts[3].text).toContain('1 matches the chosen disease.');
  });

  it('names each species carrying the substituted residue once, keeping Latin capitals', () => {
    const fly = hom('NCBITaxon:7227', 'drosophila_melanogaster', 'MAQDEFGHIK');
    const frog = hom('NCBITaxon:8364', 'xenopus_tropicalis', 'MAQDEFGHIK');
    const f = speciesFinding(input({ alignment: ready({ ...alignment, homologies: [fly, { ...fly, geneId: 'G2' }, frog] }) }));
    expect(f.facts[0].text).toContain('is the normal residue in frog (X. tropicalis), fruit fly;');
  });

  it('never prints a missing protein identifier as the word null', () => {
    const unnamed = { ...alignment, sourceProteinId: null };
    const f = speciesFinding(input({ alignment: ready(unnamed), residue: { sequence: 'ZZCZZ', position: 3, wildType: 'C', mutant: 'Q' } }));
    expect(f.facts[0].text).toContain('Ensembl aligns a human protein');
    expect(f.facts[0].text).not.toContain('null');
  });

  it('waits for the first answer and reports all-source failure', () => {
    expect(speciesFinding(input({ models: undefined, alignment: { status: 'loading', data: null }, phenotypes: undefined })).state).toBe('reading');
    const err = { status: 'error' as const, data: null };
    expect(speciesFinding(input({ models: err, alignment: err, phenotypes: err })).state).toBe('failed');
  });

  it('separates no mouse ortholog from an unscreened mouse', () => {
    expect(speciesFinding(input({ models: ready({ ...models, impc: null }) })).facts[2].text).toBe('No mouse ortholog, so no IMPC screen.');
    const unscreened = { ...models, impc: { status: 'ready' as const, screens: [{ ...models.impc!.screens[0], phenotypingDataAvailable: false }] } };
    expect(speciesFinding(input({ models: ready(unscreened) })).facts[2].text).toBe('IMPC has not phenotyped Xm. Absence of data is not a normal result.');
  });

  it('does not call a mouse unscreened when IMPC did not report whether it was screened', () => {
    const unknown = { ...models, impc: { status: 'ready' as const, screens: [{ ...models.impc!.screens[0], phenotypingDataAvailable: null }] } };
    const text = speciesFinding(input({ models: ready(unknown) })).facts[2].text;
    expect(text).toBe('IMPC does not say whether Xm was phenotyped. This is not a normal result.');
  });
});
