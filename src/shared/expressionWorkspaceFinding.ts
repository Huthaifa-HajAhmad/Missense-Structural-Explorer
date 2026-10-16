/**
 * Expression workspace: active-source summary for the tab headline and inspector rail.
 *
 * Tab and rail share the active-source reading. Display filters never pool adult and
 * pediatric measurements or turn unavailable coverage into a biological zero.
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
 */
import { buildExpressionFinding } from './expressionTabEvidence';
import type { AdultExpressionResponse } from './expressionModels';
import { buildDevelopmentalEvidence, type DevelopmentalExpressionResponse } from './developmentalExpression';
import type { ReviewSystemId } from './phenotypeFrame';

type Load<T> = { status: 'loading' | 'error' | 'ready'; data: T | null } | undefined;
export interface ExpressionWorkspaceFinding { source: string; headline: string; detail: string }

/** Tab and rail share the active-source reading. Display filters never pool adult and
 * pediatric measurements or turn unavailable coverage into a biological zero. */
export function expressionWorkspaceFinding(input: {
  section: string; adult: Load<AdultExpressionResponse>; developmental: Load<DevelopmentalExpressionResponse>;
  systems: ReviewSystemId[]; cohort: string;
}): ExpressionWorkspaceFinding {
  if (input.section !== 'developmental') {
    const finding = buildExpressionFinding(input.adult?.data ?? null, input.adult?.status ?? null, input.systems);
    return { source: 'Adult RNA · GTEx', headline: finding.figure === null ? finding.headline
      : `${finding.headline} · ${Number(finding.figure.toPrecision(4))} TPM`,
    detail: input.systems.length ? finding.predicate : finding.figureLabel ? `Highest measured median among ${finding.sampledTissues} returned adult tissue / cell categories.` : finding.predicate };
  }
  const source = 'Pediatric RNA · dGTEx';
  const load = input.developmental;
  if (!load || load.status === 'loading') return { source, headline: 'Reading pediatric measurements', detail: 'Public tissue and age-cohort medians are being read.' };
  if (load.status === 'error' || load.data?.status === 'error') return { source, headline: 'Pediatric measurements could not be read', detail: 'A source error does not establish biological absence.' };
  if (load.data?.status === 'not-installed') return { source, headline: 'Pediatric measurements are not available here', detail: 'The dGTEx snapshot is not installed. Pediatric coverage cannot be assessed.' };
  if (!load.data || load.data.status !== 'ready') return { source, headline: 'No pediatric gene reading returned', detail: 'This does not establish that the gene is unexpressed.' };
  const evidence = buildDevelopmentalEvidence(load.data, input.systems, input.cohort);
  const observations = input.systems.length ? evidence.relevant : [...evidence.relevant, ...evidence.other];
  const top = [...observations].sort((a, b) => b.value - a.value)[0];
  if (!top) return { source, headline: 'No pediatric measurements in this review scope', detail: 'Choose another sampled age cohort or review system. Missing coverage is not a low reading.' };
  return { source, headline: `${top.tissue} · ${Number(top.value.toPrecision(4))} TPM`,
    detail: `Highest measured median among ${observations.length} tissue / cohort records in scope; ${top.cohort}. Sampled age is not disease onset.${evidence.gaps.length ? ' Some selected systems have no returned measurements in this scope.' : ''}` };
}
