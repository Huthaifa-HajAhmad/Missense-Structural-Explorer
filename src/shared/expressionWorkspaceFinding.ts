/**
 * Expression workspace: the one reading the tab headline and the inspector rail both show.
 *
 * The reading follows the open sub-tab. On the RNA views (tissue explorer and sampling) it is the
 * active RNA source. On "Protein measurements" it is the Protein Atlas protein evidence, and on
 * "Expression at variant" it is the pext value of the variant's region. Units never cross: a TPM
 * median is never shown for a protein or pext view.
 *
 * INVARIANTS:
 *  - Adult GTEx and pediatric dGTEx remain strictly separate: no cross-dataset averaging or ranking.
 *  - Absence of a snapshot or returned reading is a distinct state, never a 0 TPM reading.
 *  - Zero median TPM is an authentic measurement and is reported with its unit.
 *  - Review systems filter visibility only; they do not alter the quantitative source scale.
 *  - Sampled age in pediatric cohorts is descriptive anatomy, not disease onset.
 *  - Contextual reading only; no ACMG criterion is applied, added, or modified.
 *
 * DEFECTS REPLACED:
 *  - Conflation of adult and pediatric measurements in the tab headline when switching views.
 *  - Misinterpreting missing dGTEx snapshot installation as "no expression" (biological absence).
 *  - Inconsistency between tab hero and rail trace when reviewing developmental cohorts.
 *  - The RNA median shown as the reading on the protein and pext sub-tabs.
 */
import { buildExpressionFinding, PEXT_LOCATION_NOTE, type ExpressionFinding, type PextFactInput } from './expressionTabEvidence';
import type { AdultExpressionResponse } from './expressionModels';
import { buildDevelopmentalEvidence, type DevelopmentalExpressionResponse } from './developmentalExpression';
import type { ReviewSystemId } from './phenotypeFrame';
import type { HpaResponse } from './hpa';

type Load<T> = { status: 'loading' | 'error' | 'ready'; data: T | null } | undefined;
export interface ExpressionWorkspaceFinding { source: string; headline: string; detail: string }

interface RnaReadingInput {
  section: string; adult: Load<AdultExpressionResponse>; developmental: Load<DevelopmentalExpressionResponse>;
  systems: ReviewSystemId[]; cohort: string; adultFinding?: ExpressionFinding;
}
/** The RNA reading is the default. A sub-tab that shows another measurement passes its own inputs. */
export type ExpressionReadingInput = RnaReadingInput & (
  { measure?: 'rna' } | { measure: 'protein'; hpa: Load<HpaResponse> } | { measure: 'pext'; pext: PextFactInput });

export function expressionWorkspaceFinding(input: ExpressionReadingInput): ExpressionWorkspaceFinding {
  if (input.measure === 'protein') return proteinReading(input.hpa);
  if (input.measure === 'pext') return pextReading(input.pext);
  return rnaReading(input);
}

function rnaReading(input: RnaReadingInput): ExpressionWorkspaceFinding {
  if (input.section !== 'developmental') {
    const finding = input.adultFinding ?? buildExpressionFinding(input.adult?.data ?? null, input.adult?.status ?? null, input.systems);
    return { source: 'Adult RNA · GTEx', headline: finding.figure === null ? finding.headline
      : `${finding.headline} · ${Number(finding.figure.toPrecision(4))} TPM`,
    detail: input.systems.length ? finding.predicate : finding.figureLabel ? `Highest measured median among ${finding.sampledTissues} returned adult tissue / cell categories.` : finding.predicate };
  }
  const source = 'Pediatric RNA · dGTEx';
  const load = input.developmental;
  if (!load || load.status === 'loading') return { source, headline: 'Reading pediatric measurements', detail: 'Public tissue and age-cohort medians are being read.' };
  if (load.status === 'error' || load.data?.status === 'error') return { source, headline: 'Pediatric measurements could not be read', detail: 'A source error does not establish biological absence.' };
  if (load.data?.status === 'not-installed') return { source, headline: 'Pediatric measurements are not available here', detail: 'No dGTEx snapshot was found at the configured path. Pediatric coverage cannot be assessed.' };
  if (!load.data || load.data.status !== 'ready') return { source, headline: 'No pediatric gene reading returned', detail: 'This does not establish that the gene is unexpressed.' };
  const evidence = buildDevelopmentalEvidence(load.data, input.systems, input.cohort);
  const observations = input.systems.length ? evidence.relevant : [...evidence.relevant, ...evidence.other];
  const top = [...observations].sort((a, b) => b.value - a.value)[0];
  if (!top) return { source, headline: 'No pediatric measurements in this review scope', detail: 'Choose another sampled age cohort or review system. Missing coverage is not a low reading.' };
  return { source, headline: `${top.tissue} · ${Number(top.value.toPrecision(4))} TPM`,
    detail: `Highest measured median among ${observations.length} tissue / cohort records in scope; ${top.cohort}.${evidence.gaps.length ? ' Some selected systems have no returned measurements in this scope.' : ''}` };
}

/** Protein existence from the Protein Atlas. The RNA tissue class is not a protein measurement. */
function proteinReading(load: Load<HpaResponse>): ExpressionWorkspaceFinding {
  const source = 'Human Protein Atlas · protein';
  if (!load || load.status === 'loading') return { source, headline: 'Reading the Protein Atlas', detail: 'Protein-level evidence is being read.' };
  if (load.status === 'error' || load.data?.status === 'error') return { source, headline: 'Protein Atlas could not be read', detail: 'A source error does not establish that the protein is absent.' };
  if (load.data?.status !== 'ready') return { source, headline: 'No Protein Atlas record for this gene', detail: 'This does not establish that the protein is absent.' };
  const evidence = load.data.protein?.evidence;
  if (!evidence) return { source, headline: 'No protein-level evidence reported', detail: 'The RNA tissue class is not a protein measurement.' };
  return { source, headline: evidence, detail: 'Whether the protein is known to exist, not where it is found.' };
}

/** The pext value of the coding region that holds the variant, or the reason there is none. */
function pextReading(pext: PextFactInput): ExpressionWorkspaceFinding {
  const source = 'gnomAD · base-level pext';
  if (pext.load === null || pext.load === 'loading') return { source, headline: 'Reading gnomAD pext', detail: 'Base-level pext is being read.' };
  if (pext.load === 'error') return { source, headline: 'gnomAD pext could not be read', detail: 'A source error does not establish that the variant lacks a pext value.' };
  const { region, index, state } = pext.location;
  if (!region) return { source, headline: 'No pext value at this variant', detail: PEXT_LOCATION_NOTE[state] ?? 'Base-level pext for the coding region' };
  if (region.mean === null) return { source, headline: 'Coding region has no pext value', detail: `Region ${index + 1} of ${pext.regionCount}.` };
  return { source, headline: `Coding region ${index + 1} of ${pext.regionCount} · pext ${region.mean.toFixed(2)}`,
    detail: `Mean across ${region.tissues.length} tissues in this coding region.` };
}
