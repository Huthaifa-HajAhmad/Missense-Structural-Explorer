/** Context workspaces share exact record identities with their inspectors.
 * INVARIANTS: no ACMG votes; no cross-assay normalisation; zero is measured;
 * failed sources cannot supply readings. Taxon grouping never joins provider gene IDs.
 * Filters change presentation only. Every assertion/ortholog remains reachable. */
import type { EvidenceChartRow } from './evidenceComparison';
import type { GeneDiseaseModel } from './geneDiseaseEvidence';
import type { AdultExpressionResponse } from './expressionModels';
import { tissueMatchesSystem } from './expressionModels';
import { developmentalTissueMatchesSystem, type DevelopmentalExpressionResponse } from './developmentalExpression';
import { speciesLabel, speciesOrder, type ModelOrganismResponse } from './modelOrganisms';
import { buildAlignmentEvidence, RESIDUE_STATE_LABEL, type AlignmentResponse, type ResidueMapping } from './residueAlignment';
import type { ModelPhenotypesResponse } from './modelPhenotypes';
import type { ContextProvenance } from './diseaseFrame';
import type { ReviewSystemId } from './phenotypeFrame';

export type ContextTab = 'gene-disease' | 'expression-models' | 'species-models';
export interface ContextReading extends EvidenceChartRow {
  source: string; cohort?: string; relevant?: boolean; taxon?: string; mapping?: ResidueMapping;
  reportUrl?: string | null;
}
const reported = (v: string | number | null | undefined) => v == null ? 'Not reported' : String(v);
const formatTpm = (v: number | null) => v === null ? 'No gene reading' : `${v === 0 ? '0' : v < .001 ? v.toExponential(3) : Number(v.toPrecision(4))} TPM`;
const provenanceFacts = (p: ContextProvenance | null | undefined) => [
  { label: 'Release', value: p?.release ?? 'Not reported' }, { label: 'Retrieved', value: p?.retrievedAt ?? 'Not reported' },
];
const row = (r: Omit<ContextReading, 'tone'> & { tone?: ContextReading['tone'] }): ContextReading => ({ tone: 'neutral', ...r });
export const assertionKey = (frame: string | null | undefined, id: string) => JSON.stringify(['assertion', frame, id]);

/** Source coverage only. Never equate Alliance and Ensembl genes, even within one taxon. */
export function speciesCoverage(rows: ContextReading[]) {
  const taxa = [...new Set(rows.flatMap(r => r.taxon ? [r.taxon] : []))];
  return taxa.sort((a, b) => speciesOrder(a) - speciesOrder(b) || a.localeCompare(b)).map(taxon => ({
    taxon, label: speciesLabel(taxon, `Taxon ${taxon}`),
    counts: {
      orthologs: rows.filter(r => r.taxon === taxon && r.group === 'orthologs').length,
      alignment: rows.filter(r => r.taxon === taxon && r.group === 'alignment').length,
      phenotypes: rows.filter(r => r.taxon === taxon && r.group === 'phenotypes').length,
    },
  }));
}

export function geneDiseaseReadings(model: GeneDiseaseModel): ContextReading[] {
  const frame = model.selected;
  return [
    ...model.assertions.map(a => row({ key: assertionKey(frame?.key, a.id), name: a.submitter, value: null, valueText: a.level,
      description: 'A submitted gene–disease validity assertion for the selected inheritance.', group: 'validity', source: 'GenCC', reportUrl: a.reportUrl,
      facts: [{ label: 'Classification', value: a.level }, { label: 'Disease', value: frame?.label ?? 'None selected' },
        { label: 'Disease identifier', value: frame?.diseaseId ?? 'Not reported' }, { label: 'Inheritance', value: frame?.inheritance.label ?? 'Not reported' },
        { label: 'Evaluated', value: reported(a.evaluatedAt) }, { label: 'Assertion', value: a.id }],
      notes: [a.adverse ? 'This assertion disputes, refutes, or reports no known relationship. Read it alongside every other submission.' : 'Validity describes the gene–disease relationship; it does not classify this variant.', 'Submission counts are not independent votes. No consensus score is calculated.'],
    })),
    ...(model.dosage.state === 'ready' ? model.dosage.readings.map(d => row({ key: `dosage:${d.key}`, name: d.name, value: null, valueText: d.call,
      description: d.asks, group: 'dosage', source: 'ClinGen dosage', reportUrl: model.dosage.reportUrl,
      facts: [{ label: 'Score', value: reported(d.code) }, { label: 'Disease', value: d.disease ?? 'Not reported' }, { label: 'Selected disease scope', value: d.scope }, { label: 'Evaluated', value: reported(model.dosage.evaluatedAt) }],
      notes: ['Whole-gene copy-number evidence does not establish the mechanism of a missense variant. Codes 30 and 40 are special categories, not higher scores.', d.history ?? 'No curation history reported.'],
    })) : []),
  ];
}

export function expressionReadings(adult: AdultExpressionResponse | null, developmental: DevelopmentalExpressionResponse | null, systems: ReviewSystemId[]): ContextReading[] {
  return [
    ...(adult?.status === 'ready' ? adult.tissues.map(t => row({ key: `adult:${t.id}`, name: t.label, value: t.value, valueText: formatTpm(t.value),
      description: 'Median gene-level RNA abundance in adult tissue. TPM means transcripts per million.', group: 'adult', source: adult.provenance?.source ?? 'GTEx',
      relevant: systems.some(s => tissueMatchesSystem(t.id, s)),
      facts: [{ label: 'Median TPM (exact)', value: reported(t.value) }, { label: 'RNA samples', value: reported(t.sampleCount) },
        { label: 'Anatomy identifier', value: reported(t.ontologyId) }, { label: 'GENCODE gene', value: reported(adult.gencodeId) }, ...provenanceFacts(adult.provenance)],
      notes: ['Sample counts describe the tissue cohort, not independent donors or gene-specific detection.', 'A zero median is a measurement; it does not prove absence. Adult bulk RNA does not establish developmental or cell-specific expression.'],
    })) : []),
    ...(developmental?.status === 'ready' ? developmental.observations.map(t => row({ key: JSON.stringify(['developmental', t.tissueId, t.tissue, t.cohortId]), name: t.tissue,
      value: t.value, valueText: formatTpm(t.value), group: 'developmental', cohort: t.cohortId, source: developmental.provenance?.source ?? 'dGTEx',
      relevant: systems.some(s => developmentalTissueMatchesSystem(t.tissue, s)), description: t.cohort,
      facts: [{ label: 'Median TPM (exact)', value: String(t.value) }, { label: 'Donors', value: String(t.donorCount) }, { label: 'RNA samples', value: String(t.sampleCount) },
        { label: 'Age cohort', value: t.cohort }, { label: 'Anatomy identifier', value: t.tissueId }, { label: 'GENCODE gene', value: reported(developmental.gencodeId) }, ...provenanceFacts(developmental.provenance)],
      notes: [t.donorCount === 1 ? 'Single donor: this is not a population baseline.' : 'Median across donors after within-donor medians for repeated samples.',
        'Public sampled-age cohorts remain separate from disease onset. These cohorts and adult GTEx are not a matched comparison or a developmental trajectory.'],
    })) : []),
  ];
}

export function speciesReadings(input: { models: ModelOrganismResponse | null; alignment: AlignmentResponse | null; phenotypes: ModelPhenotypesResponse | null;
  sequence?: string | null; position: number | null; wildType: string; mutant: string; diseaseTerms: string[] | null; diseaseKey: string | null }): ContextReading[] {
  const { models, alignment, phenotypes } = input;
  // `null` means the disease-term comparison cannot run (no selection or terms not read yet);
  // phenotype rows must then refuse the overlap claim instead of reading it as a negative result.
  const termSet: Set<string> | null = input.diseaseTerms && input.diseaseTerms.length ? new Set(input.diseaseTerms) : null;
  const alignmentEvidence = buildAlignmentEvidence(alignment?.status === 'ready' ? alignment : null, input.sequence, input.position, input.wildType, input.mutant);
  return [
    ...(models?.status === 'ready' ? models.orthologs.map(o => row({ key: `ortholog:${o.taxonId}:${o.id}`, name: `${speciesLabel(o.taxonId, o.species)} · ${o.symbol}`, taxon: o.taxonId,
      value: null, valueText: o.confidence ?? 'Confidence not reported', group: 'orthologs', source: 'Alliance', description: 'Predicted orthology; multiple orthologs in a species remain separate.',
      facts: [{ label: 'Ortholog', value: o.id }, { label: 'Methods', value: String(o.methodCount) }, { label: 'Best forward match', value: reported(o.bestForward == null ? null : o.bestForward ? 'Yes' : 'No') }, { label: 'Best reverse match', value: reported(o.bestReverse == null ? null : o.bestReverse ? 'Yes' : 'No') }, ...provenanceFacts(models.provenance[0])],
      notes: ['Orthology and method counts do not prove equal function or model suitability. Alliance and Ensembl records are grouped by species, never equated by symbol.'],
    })) : []),
    ...alignmentEvidence.rows.map(({ h, m }) => row({ key: `alignment:${h.taxonId}:${h.geneId}:${h.proteinId}`, name: `${speciesLabel(h.taxonId, h.species)} · ${h.geneId}`, taxon: h.taxonId,
      value: null, valueText: RESIDUE_STATE_LABEL[m.state], group: 'alignment', source: 'Ensembl Compara', mapping: m,
      description: `Gapped alignment at human residue ${input.position ?? 'not supplied'}.`,
      facts: [{ label: 'Target residue', value: m.targetResidue && m.targetPosition ? `${m.targetResidue}${m.targetPosition}` : RESIDUE_STATE_LABEL[m.state] },
        { label: 'Source protein', value: reported(alignment?.sourceProteinId) }, { label: 'Target protein', value: h.proteinId }, { label: 'Orthology type', value: h.type },
        { label: 'Whole-protein human identity', value: h.humanIdentity === null ? 'Not reported' : `${h.humanIdentity}%` }, ...provenanceFacts(alignment?.provenance)],
      notes: [m.state === 'reference-mismatch' ? 'The human sequence, position or reference residue does not match. No residue mapping is asserted.' : 'Positions are mapped by walking gapped columns, not by copying the human residue number.',
        m.carriesVariantResidue ? 'The substituted residue occurs here in this ortholog. This does not establish tolerance in human.' : 'Conservation is context, not a pathogenicity verdict.'],
    })),
    ...(phenotypes?.status === 'ready' ? phenotypes.species.flatMap(s => s.status === 'ready' ? s.phenotypes.map((p, i) => row({
      key: JSON.stringify(['phenotype', input.diseaseKey, s.orthologId, p.termId, i]), name: p.statement, taxon: s.taxonId, group: 'phenotypes', source: 'Alliance / uPheno',
      value: null, valueText: `${p.annotations} annotations`, relevant: phenotypes.mapping === 'available' && termSet !== null && p.humanTerms.some(t => termSet.has(t)),
      description: `${speciesLabel(s.taxonId, s.species)} · ${s.symbol} · ${p.termId}`,
      facts: [{ label: 'Ortholog', value: s.orthologId }, { label: 'Phenotype term', value: p.termId }, { label: 'Annotations', value: String(p.annotations) },
        { label: 'Model identifiers counted', value: String(p.models) },
        { label: 'Disease term overlap', value: phenotypes.mapping !== 'available' ? 'Mapping not available'
          : termSet === null ? 'No disease terms to compare with'
          : p.humanTerms.filter(t => termSet.has(t)).join(', ') || 'No returned overlap' },
        ...provenanceFacts(phenotypes.provenance[0])],
      notes: ['Disease term overlap uses uPheno cross-species exact matches. It is not patient phenotype similarity or proof of disease causality.',
        'The current source response aggregates annotations. Allele, genotype, sex, age, procedures and sample counts are not supplied; no variant-specific functional claim is made. No automatic PS3/BS3.'],
    })) : []) : []),
  ].sort((a, b) => speciesOrder(a.taxon ?? '') - speciesOrder(b.taxon ?? '') || a.name.localeCompare(b.name));
}

/** Pure bounded presentation: quantitative domains use the full source group, not the filter. */
export function contextPage(rows: ContextReading[], options: { group: string; query: string; cohort?: string; relevantOnly?: boolean; limit?: number }) {
  const group = rows.filter(r => r.group === options.group);
  const query = options.query.trim().toLocaleLowerCase();
  const filtered = group.filter(r => (!query || `${r.name} ${r.description} ${r.valueText} ${r.source} ${r.taxon ?? ''}`.toLocaleLowerCase().includes(query)) &&
    (!options.relevantOnly || r.relevant) && (!options.cohort || options.cohort === 'all' || r.cohort === options.cohort));
  filtered.sort((a, b) => Number(!!b.relevant) - Number(!!a.relevant) || (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));
  return { rows: filtered.slice(0, options.limit ?? 20), total: filtered.length, max: group.reduce((m, r) => Math.max(m, r.value ?? 0), 0), sourceCount: group.length };
}
