import { describe, expect, it } from 'vitest';
import { addVerifiedMechanismChoices, buildGeneDiseaseEvidence, type GeneDiseaseResponse } from '../diseaseFrame';
import { emptyPhenotypeSelection, selectDisease, toggleReviewSystem } from '../phenotypeFrame';
import { expressionObservationState, modelPhenotypeState, buildAdultExpressionEvidence, type AdultExpressionResponse } from '../expressionModels';
const data: GeneDiseaseResponse = { gene: 'TEST', status: 'ready', message: null, provenance: null, frames: [{ key: 'a', geneId: 'HGNC:1', geneSymbol: 'TEST', diseaseId: 'MONDO:1', label: 'Example', xrefs: [], inheritance: { id: 'HP:1', label: 'AD' }, mechanisms: [], suggestedSystems: [], validity: ['Strong', 'Refuted Evidence'].map((level, i) => ({ id: String(i), level, submitter: String(i), submitterId: String(i), evaluatedAt: null, reportUrl: null })) }] };
describe('evidence context invariants', () => {
  it('allows source-verified G2P choices while distinguishing missing GenCC from uncurated validity', () => {
    const record = { id: 'G2P1', geneId: 'HGNC:1', gene: 'TEST', diseaseId: 'MONDO:0000001', diseaseLabel: 'Example',
      allelicRequirement: 'monoallelic_autosomal', modifier: 'restricted mutation set', confidence: 'definitive', mechanism: 'gain of function',
      support: 'inferred', categorisation: '', evidence: '', consequence: '', variantTypes: '', publications: [], reviewedAt: null };
    const base: GeneDiseaseResponse = { gene: 'TEST', status: 'not-installed', frames: [], provenance: null, message: 'Missing',
      mechanismContext: { status: 'ready', provenance: null, message: null, records: [record,
        { ...record, id: 'G2P2', gene: 'OTHER' }, { ...record, id: 'G2P3', diseaseId: null }, { ...record, id: 'G2P4', allelicRequirement: 'unsupported' }] } };
    const choices = addVerifiedMechanismChoices(base);
    expect(choices.frames).toHaveLength(1);
    expect(choices.frames[0]).toMatchObject({ selectionSource: 'Gene2Phenotype', validity: [], inheritance: { id: 'HP:0000006' } });
    expect(buildGeneDiseaseEvidence(choices, choices.frames[0].key).finding).toMatch(/snapshot not installed/);
    expect(buildGeneDiseaseEvidence({ ...choices, status: 'ready' }, choices.frames[0].key).finding).toBe('Not curated by the installed GenCC snapshot.');
    expect(addVerifiedMechanismChoices(choices).frames).toHaveLength(1);
    expect(base.frames).toEqual([]);
  });
  it('requires selection, retains disagreement and leads with disputed/refuted assertions', () => {
    expect(buildGeneDiseaseEvidence(data, null).selected).toBeNull();
    const evidence = buildGeneDiseaseEvidence(data, 'a');
    expect(evidence.finding).toBe('Disputed or refuted assertions require review.');
    expect(evidence.assertions).toHaveLength(2); expect(evidence.disagreement).toBe(true);
    expect(buildGeneDiseaseEvidence(data, 'unknown').selected).toBeNull();
    expect(evidence).not.toHaveProperty('score'); expect(evidence).not.toHaveProperty('acmgCriteria');
  });
  it('does not turn a disease change or suggestions into patient findings', () => {
    const selection = { ...toggleReviewSystem(emptyPhenotypeSelection(), 'hearing'), onset: 'infantile' as const };
    expect(selectDisease(selection, 'new')).toMatchObject({ systems: ['hearing'], onset: 'infantile' });
    expect(emptyPhenotypeSelection().systems).toEqual([]);
  });
  it('distinguishes measured zero, unsampled anatomy and missing infrastructure', () => {
    const base = { value: null, sampled: null, detectionCall: null, sourceInstalled: true, providerError: false };
    expect(expressionObservationState({ ...base, value: 0 })).toBe('measured');
    expect(expressionObservationState({ ...base, sampled: false })).toBe('not-sampled');
    expect(expressionObservationState({ ...base, sourceInstalled: false })).toBe('not-installed');
    expect(expressionObservationState({ ...base, providerError: true })).toBe('upstream-error');
    expect(expressionObservationState(base)).toBe('unknown');
  });
  it('does not infer a normal phenotype from an empty annotation list or testing alone', () => {
    const base = { tested: null, abnormal: false, explicitNormal: false, lethalBeforeAssessment: false };
    expect(modelPhenotypeState(base)).toBe('assessment-unknown');
    expect(modelPhenotypeState({ ...base, tested: true })).toBe('assessment-unknown');
    expect(modelPhenotypeState({ ...base, tested: true, explicitNormal: true })).toBe('tested-no-abnormality-reported');
    expect(modelPhenotypeState({ ...base, lethalBeforeAssessment: true })).toBe('lethal-before-assessment');
  });
  it('keeps every tissue reachable and never uses skeletal muscle as cartilage coverage', () => {
    const expression: AdultExpressionResponse = { gene: 'FGFR3', status: 'ready', gencodeId: null, provenance: null, message: null,
      tissues: ['Muscle_Skeletal', 'Heart_Left_Ventricle', 'Liver'].map(id => ({ id, label: id, ontologyId: null, value: 0, unit: 'TPM', sampleCount: 5, samplingSite: null })) };
    const evidence = buildAdultExpressionEvidence(expression, ['skeletal', 'cardiovascular']);
    expect(evidence.gaps).toEqual(['skeletal']); expect(evidence.relevant.map(t => t.id)).toEqual(['Heart_Left_Ventricle']);
    expect([...evidence.relevant, ...evidence.other]).toHaveLength(expression.tissues.length);
  });
});
