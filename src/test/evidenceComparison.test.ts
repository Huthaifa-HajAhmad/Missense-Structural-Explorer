import { describe, expect, it } from 'vitest';
import { evidenceWorkspaceFixture } from './evidenceWorkspaceFixture';
import { buildFrequencyEvidence, frequencyEvidenceInputFromResult } from '../shared/frequencyEvidence';
import { buildPredictorEvidence, predictorUseLabel } from '../shared/predictorEvidence';
import { buildLadderEvidence } from '../shared/ladderEvidence';
import { buildAlphaGenomeEvidence, aviFinding } from '../shared/alphagenomeEvidence';
import { formatAlleleFrequency } from '../shared/frequencyFormat';
import { buildAttributionComparison, buildPopulationComparison, buildPredictorComparison, formatAttributionValue, populationLabelWidth, populationRowLabel, POPULATION_LABEL_MAX_PX, POPULATION_LABEL_MIN_PX } from '../shared/evidenceComparison';

describe('Evidence comparison contracts', () => {
  it('keeps the group maximum separate from dataset counts and expands to every positive frequency', () => {
    const evidence = buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture()));
    const model = buildPopulationComparison(evidence);
    const rule = model.rows.find(r => r.key === 'frequency-rule-input')!;
    expect(rule.value).toBeCloseTo(Math.log10(.00008));
    expect(rule.facts.some(f => f.label.includes('Allele count'))).toBe(false);
    expect(rule.contextText).toBe('Rule input · not a cohort');
    expect(model.rows.find(r => r.name === 'gnomAD exomes')?.contextText).toBe('AC 8 · AN 1,459,156');
    expect(model.rows.find(r => r.name === 'gnomAD genomes')?.contextText).toBe('AC 2 · AN 500,000');
    for (const r of model.rows) if (r.value !== null) {
      expect(r.value).toBeGreaterThanOrEqual(model.domain[0]);
      expect(r.value).toBeLessThanOrEqual(model.domain[1]);
    }
  });
  it('never plots reported zero, missing frequencies or a confirmed absence at an invented log position', () => {
    const zero = buildPopulationComparison(buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture('Zero'))));
    expect(zero.rows.every(r => r.value === null)).toBe(true);
    expect(zero.rows.some(r => r.description.includes('reported frequency of zero'))).toBe(true);
    const missing = buildPopulationComparison(buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture('Missing'))));
    expect(missing.rows.some(r => r.valueText === 'Provider error')).toBe(true);
    const absent = buildPopulationComparison(buildFrequencyEvidence({ serviceStatus: { gnomadFrequency: 'not_found' }, assembly: 'GRCh38' }));
    expect(absent.rows.find(r => r.key === 'frequency-rule-input')).toMatchObject({ value: null, valueText: 'Not observed' });
  });
  it('places calibrated tools in their published bands and never invents strength for direction-only tools', () => {
    const result = evidenceWorkspaceFixture();
    const predictor = buildPredictorEvidence({ result });
    const ladder = buildLadderEvidence({ result, predictor });
    const model = buildPredictorComparison(predictor, ladder);
    for (const r of ladder.ladder) {
      const plotted = model.rows.find(row => row.key === r.key)!;
      const hasBands = predictor.readings.find(p => p.key === r.key)!.cutpoints.bands.length > 0;
      expect(plotted.value).toBe(r.at === null || !hasBands ? null : ladder.columns.findIndex(c => c.id === r.at));
    }
    for (const r of ladder.directional) expect(model.rows.find(row => row.key === r.key)?.value).toBeNull();
    expect(model.rows.find(r => r.key === 'revel')?.tone).toBe('good');
  });
  it('preserves signed and zero attributions, names incomplete coverage, and leaves unreported features null', () => {
    const evidence = buildAlphaGenomeEvidence({ result: evidenceWorkspaceFixture('Partial') });
    const model = buildAttributionComparison(evidence);
    expect(model.rows.find(r => r.key === 'MERGED_SPLICING')?.value).toBe(-.08);
    expect(model.rows.find(r => r.key === 'MAX_ABS_RNA_SEQ')?.value).toBe(0);
    expect(model.rows.find(r => r.key === 'MAX_ABS_ATAC')?.value).toBeNull();
    expect(model.summary).toContain('3 of 18');
    expect(model.summary).toContain('incomplete');
    expect(model.rows.find(r => r.key === 'MERGED_SPLICING')?.notes[0]).toContain('does not tell you whether gene expression');
  });
  it('filters features without renormalising shares, changing the axis or modifying the evidence', () => {
    const evidence = buildAlphaGenomeEvidence({ result: evidenceWorkspaceFixture('Partial') });
    const before = JSON.stringify(evidence);
    const all = buildAttributionComparison(evidence);
    const molecular = buildAttributionComparison(evidence, 'molecular');
    expect(molecular.domain).toEqual(all.domain);
    expect(molecular.rows).toEqual(all.rows.filter(r => r.group === 'molecular'));
    expect(JSON.stringify(evidence)).toBe(before);
  });
  it('renders an all-zero vector without claiming missing attribution or assigning shares', () => {
    const model = buildAttributionComparison(buildAlphaGenomeEvidence({ result: evidenceWorkspaceFixture('Zero') }));
    expect(model.rows).toHaveLength(18);
    expect(model.rows.every(r => r.value === 0)).toBe(true);
    expect(model.rows.every(r => r.facts.find(f => f.label === 'Share of reported magnitude')?.value === 'Not defined')).toBe(true);
    expect(model.summary).toContain('18 of 18');
  });
  it('does not describe an empty or partial vector as a complete attribution', () => {
    const result = evidenceWorkspaceFixture('Partial');
    const partial = buildAlphaGenomeEvidence({ result });
    expect(aviFinding(partial)?.detail).toContain('Only 3 of 18');
    result.conservationData!.alphagenome!.featureAttributions = {};
    expect(aviFinding(buildAlphaGenomeEvidence({ result }))?.headline).toBe('No feature contributions reported.');
  });
  it('keeps very small non-zero contributions distinguishable from zero', () => {
    expect(formatAttributionValue(.0000003)).toBe('+3.00e-7');
    expect(formatAttributionValue(-.0000003)).toBe('−3.00e-7');
    expect(formatAttributionValue(0)).toBe('0');
  });
  it('never says a contribution was returned when the Atlas was not assessed', () => {
    // Unassessed: nothing queried — "0 of 18 returned" claimed the Atlas answered.
    const unassessed = buildAttributionComparison(buildAlphaGenomeEvidence({ result: evidenceWorkspaceFixture('Missing') }));
    expect(unassessed.summary).toContain('No AlphaGenome impact score was assessed');
    expect(unassessed.summary).not.toContain('returned');
    expect(unassessed.emptyCopy).toContain('nothing to plot');
    // Assessed without a vector: the score arrived, the attributions did not.
    const result = evidenceWorkspaceFixture('Partial');
    result.conservationData!.alphagenome = { status: 'live', aviPhred: 22.5, featureAttributions: null } as never;
    const vectorless = buildAttributionComparison(buildAlphaGenomeEvidence({ result }));
    expect(vectorless.summary).toContain('The score arrived without its feature contributions');
    expect(vectorless.summary).not.toMatch(/of 18 feature contributions returned/);
  });
  it('prints one allele frequency with the shared formatter on the chart value, the record and the rule input', () => {
    // The same fact must read the same on every row of the Population chart, not two ways.
    const evidence = buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture()));
    const model = buildPopulationComparison(evidence);
    const exomes = model.rows.find(r => r.name === 'gnomAD exomes')!;
    expect(exomes.valueText).toBe(formatAlleleFrequency(0.0000055));
    expect(exomes.facts.find(f => f.label === 'Frequency (AF)')?.value.startsWith(formatAlleleFrequency(0.0000055))).toBe(true);
    expect(model.rows.find(r => r.key === 'frequency-rule-input')?.valueText).toBe(formatAlleleFrequency(0.00008));
  });
  it('prints a reported zero frequency as "0" on the chart, the same as the shared formatter', () => {
    const zero = buildPopulationComparison(buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture('Zero'))));
    expect(zero.rows.find(r => r.name === 'gnomAD exomes')?.valueText).toBe(formatAlleleFrequency(0));
  });
  it('names the local gnomAD ingest once, exactly as the records row does', () => {
    // frequencyObservationName is the one naming rule: the local ingest label already says "gnomAD",
    // so the generic prefix would have doubled it into "gnomAD gnomad (local dbnsfp, …)".
    const evidence = buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture()));
    const model = buildPopulationComparison(evidence);
    for (const row of model.rows) {
      expect(row.name.match(/gnomAD/g)?.length ?? 0).toBeLessThanOrEqual(1);
      if (row.name.includes('local dbNSFP')) expect(row.name).not.toContain('gnomAD gnomad');
    }
  });
  it('sizes the Population label column to the longest source name instead of clipping it', () => {
    const long = 'gnomAD (local dbNSFP, cohorts combined)';
    expect(populationLabelWidth(['gnomAD exomes', 'Engine frequency input'])).toBe(POPULATION_LABEL_MIN_PX);
    // 39 characters at ~6.4px plus the 12px label offset and tick gutter: wider than the old fixed 175px column.
    const width = populationLabelWidth([long, 'All of Us']);
    expect(width).toBeGreaterThan(long.length * 6);
    expect(width).toBeLessThanOrEqual(POPULATION_LABEL_MAX_PX);
    expect(populationRowLabel(long)).toBe(long);
  });
  it('ellipsizes only a name no column can hold, and the label then fits the cap', () => {
    const absurd = 'gnomAD (local dbNSFP, cohorts combined, ancestry-grouped maximum across every released cohort)';
    expect(populationLabelWidth([absurd])).toBe(POPULATION_LABEL_MAX_PX);
    const shown = populationRowLabel(absurd);
    expect(shown.endsWith('…')).toBe(true);
    expect(shown.length * 6.4 + 28).toBeLessThanOrEqual(POPULATION_LABEL_MAX_PX);
  });
});

describe('Evidence comparison wording and units (release fix FC-a)', () => {
  it('writes every allele-frequency tick in percent, with no exponent, so the axis matches its title', () => {
    const model = buildPopulationComparison(buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture())));
    expect(model.axisLabel).toContain('Allele frequency (%)');
    for (const label of model.tickLabels) expect(label).toMatch(/^[\d,.]+%$/);
  });

  it('describes a candidate allele the way the Population rail does: BA1 reads FAF95, BS1 is a reference', () => {
    const evidence = buildFrequencyEvidence(frequencyEvidenceInputFromResult(evidenceWorkspaceFixture()));
    const candidate = {
      key: 'c1', id: 'rs1', change: 'c.1A>G', af: 0.0001, absent: false, decision: 'BA1', benignStatistic: 'faf95',
      benignAf: 0.00005, note: null, counts: '1 / 100', lifted: false, cdna: null, homozygotes: 0, allOfUs: null, pm2Hold: false,
    };
    const model = buildPopulationComparison({ ...evidence, candidates: [candidate] } as any);
    const row = model.rows.find(r => r.key === 'candidate:c1')!;
    expect(row.description).toBe('BA1 reads FAF95; the BS1 reference value is shown, not counted.');
  });

  it('gives each predictor its engine use from the same wording the Predictors rail uses', () => {
    const result = evidenceWorkspaceFixture();
    const predictor = buildPredictorEvidence({ result });
    const ladder = buildLadderEvidence({ result, predictor });
    const model = buildPredictorComparison(predictor, ladder);
    for (const reading of predictor.readings) {
      const row = model.rows.find(r => r.key === reading.key)!;
      expect(row.facts.find(f => f.label === 'Engine use')?.value).toBe(predictorUseLabel(reading, predictor.primary));
    }
  });

  it('does not repeat the "not additional engine criteria" sentence in the predictor summary', () => {
    const result = evidenceWorkspaceFixture();
    const predictor = buildPredictorEvidence({ result });
    const model = buildPredictorComparison(predictor, buildLadderEvidence({ result, predictor }));
    expect(model.summary).not.toContain('not additional engine criteria');
  });
});
