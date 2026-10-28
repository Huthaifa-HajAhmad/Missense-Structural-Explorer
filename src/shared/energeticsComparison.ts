import { KJ_PER_KCAL, MIN_ENGINES_FOR_CONSENSUS, type EnergyUnit } from './engineStatus';
import { AGREEMENT_CHIP, absenceText, listNames, signedDdg, markText, type EnergeticsEvidence, type EnergeticsReading } from './energeticsEvidence';

/** Display geometry only. Canonical signs, calls and inclusion come from the evidence model.
 * Missing values never become points; filtering never changes agreement or the full-data axis.
 * These are model estimates, so neither inter-method spread nor local marks are error bars.
 */
export type EnergySort = 'method' | 'value';
export interface EnergeticsChartOptions { sort: EnergySort; countedOnly: boolean; showMarks: boolean }
/** Engines that returned a value — of the engines that CAN count; a reference-only row (ProtVar) is not one. */
export const returnedEnergyEstimates = (evidence: EnergeticsEvidence) => evidence.readings.filter(r => r.ddg !== null && !r.outcome.engine.referenceOnly).length;
/** A prominent finding must qualify sparse evidence before presenting its direction. */
export function energeticsComparisonHeadline(evidence: EnergeticsEvidence): string {
  const count = evidence.agreement.nCounted;
  if (count === 0) return 'No usable estimate';
  if (count === 1) return 'One usable estimate';
  if (count < MIN_ENGINES_FOR_CONSENSUS) return `${count} usable estimates`;
  return AGREEMENT_CHIP[evidence.agreement.direction].label;
}
export function energeticsComparisonCautions(evidence: EnergeticsEvidence): string[] {
  const notes: string[] = [];
  if (evidence.lowPlddt !== null) notes.push(`Low confidence in the AlphaFold template here (pLDDT ${evidence.lowPlddt.toFixed(1)}); inspect the structure basis.`);
  const unrepaired = evidence.readings.filter(r => r.caveats.includes('unrepaired-template'));
  if (unrepaired.length) notes.push(`${unrepaired.map(r => r.name).join(', ')} used an unrepaired template, which can distort the estimate.`);
  // The cross-check names the other FoldX value beside the caveat it bears on.
  if (evidence.foldxTemplateCheck && (unrepaired.length || evidence.foldxTemplateCheck.state !== 'consistent')) notes.push(evidence.foldxTemplateCheck.headline);
  // A reference-only row is excluded by design, so it is not a caution with a reason to look up.
  const excluded = evidence.readings.filter(r => r.ddg !== null && !r.counted && !r.outcome.engine.referenceOnly);
  if (excluded.length) notes.push(`${excluded.map(r => r.name).join(', ')} returned a value but is excluded from agreement. Select the method for the reason.`);
  return notes;
}
/** The connector drawn between the two FoldX estimates (local and ProtVar) on adjacent rows. */
export interface FoldxPairLink { x1: number; y1: number; x2: number; y2: number; key: string }

export interface EnergyPoint {
  key: EnergeticsReading['key'];
  name: string;
  value: number;
  row: number;
  guide: number;
  counted: boolean;
  /** Canonical, unit-converted label. Units are printed once on the shared axis. */
  valueText: string;
  label: string;
  guideLabel: string;
}

export function buildEnergeticsComparison(evidence: EnergeticsEvidence, unit: EnergyUnit, sort: EnergySort = 'method', countedOnly = false) {
  const factor = unit === 'kJ/mol' ? KJ_PER_KCAL : 1;
  const readings = evidence.readings.filter(r => !countedOnly || r.counted).slice();
  if (sort === 'value') readings.sort((a, b) => (b.ddg ?? -Infinity) - (a.ddg ?? -Infinity));
  const points: EnergyPoint[] = readings.flatMap((r, row) => r.ddg === null ? [] : [{
    key: r.key, name: r.name, value: r.ddg === 0 ? 0 : r.ddg * factor, row, guide: r.strongMark * factor,
    counted: r.counted,
    valueText: signedDdg(r.ddg, unit).replace(/ (kcal|kJ)\/mol$/, ''),
    guideLabel: `Local destabilising guide for ${r.name}: ${markText(r.strongMark, unit)} ${unit}. App-defined, not a clinical cut-point.`,
    label: `${r.name}: ${signedDdg(r.ddg, unit)}. ${r.callLabel ?? 'Estimate'}${r.counted ? '' : '; not counted in agreement'}.`,
  }]);
  const local = points.find(p => p.key === 'foldx');
  const protvar = points.find(p => p.key === 'protvar');
  // Drawn only when the two rows touch; across other rows a diagonal would read as a third series.
  const foldxPair: FoldxPairLink[] = local && protvar && Math.abs(local.row - protvar.row) === 1
    ? [{ key: 'foldx-pair', x1: local.value, y1: local.row, x2: protvar.value, y2: protvar.row }]
    : [];
  const extent = evidence.readings.flatMap(r => r.ddg === null ? [] : [r.ddg, r.strongMark]);
  const min = Math.min(-1, ...extent);
  const max = Math.max(1, ...extent);
  const padding = (max - min) * 0.12;
  // A negative value's label sits left of its dot, so the stable side needs room for it.
  const leftPadding = extent.some(v => v < 0) ? padding * 1.6 : padding;
  return {
    readings, points, foldxPair,
    domain: [(min - leftPadding) * factor, (max + padding) * factor] as [number, number],
    missing: readings.filter(r => r.ddg === null).map(r => ({ key: r.key, name: r.name, status: r.outcome.label, reason: absenceText(r) })),
    summary: `${points.length} displayed estimates. Positive values predict less stable folding; negative values predict more stable folding. ${readings.length - points.length} displayed methods have no estimate. Values are predictions, not a disease classification.`,
  };
}

export function energeticsComparisonFinding(evidence: EnergeticsEvidence): string {
  const a = evidence.agreement;
  const running = evidence.running.length > 0 || evidence.isFolding;
  if (a.nCounted === 0) {
    if (running) return 'No method has a usable result yet. The comparison appears as methods report theirs.';
    return 'There are not enough usable results to compare stability estimates.';
  }
  if (a.nCounted === 1) {
    return running
      ? 'One method has a usable result. Agreement cannot be assessed yet; other results are still being collected.'
      : 'One method has a usable result. Agreement cannot be assessed yet.';
  }
  if (a.direction === 'split') {
    return 'The methods give different stability readings. Inspect the individual estimates before drawing a conclusion.';
  }
  if (a.direction === 'mostly-not-destabilizing') {
    return `Most methods predict no destabilisation under their local marks; ${listNames(a.moderate.map(r => r.name))} ${a.moderate.length === 1 ? 'gives' : 'give'} a moderately destabilising reading. This does not establish that the variant is benign.${running ? ' Other results are still being collected.' : ''}`;
  }
  if (a.direction === 'mostly-moderate') {
    return `Most methods give a moderately destabilising reading under their local marks; ${listNames(a.notDestabilizing.map(r => r.name))} ${a.notDestabilizing.length === 1 ? 'predicts' : 'predict'} no destabilisation. This does not establish that the variant is benign.${running ? ' Other results are still being collected.' : ''}`;
  }
  if (a.direction === 'mostly-destabilizing') {
    return `Most methods give a destabilising reading under their local marks; ${listNames(a.moderate.map(r => r.name))} ${a.moderate.length === 1 ? 'sits' : 'sit'} in the moderately destabilising band. This does not establish that the variant is pathogenic.${running ? ' Other results are still being collected.' : ''}`;
  }
  const pairWords: Record<'destabilizing' | 'moderate' | 'not-destabilizing', string> = {
    destabilizing: 'give a destabilising reading under their local marks.',
    moderate: 'give a moderately destabilising reading under their local marks.',
    'not-destabilizing': 'predict no destabilisation under their local marks. This does not establish that the variant is benign.',
  };
  const agreeWords: Record<'destabilizing' | 'moderate' | 'not-destabilizing', string> = {
    destabilizing: 'agree on a destabilising reading under their local marks.',
    moderate: 'agree on a moderately destabilising reading under their local marks.',
    'not-destabilizing': 'do not predict destabilisation under their local marks. This does not establish that the variant is benign.',
  };
  /**
   * Agreement is a THREE-engine reading (`MIN_ENGINES_FOR_CONSENSUS`). With only two counted values
   * this sentence must not say "the methods agree" while the Engine records tab, on the same screen,
   * says two is too few — both tabs read from this one finding.
   */
  if (a.nCounted === 2) {
    const direction = a.direction as 'destabilizing' | 'moderate' | 'not-destabilizing';
    return `Both methods ${pairWords[direction]} Two estimates are too few to read as agreement.${running ? ' Other results are still being collected.' : ''}`;
  }
  const direction = a.direction as 'destabilizing' | 'moderate' | 'not-destabilizing';
  const subject = running ? `The ${a.nCounted} methods that reported so far ` : 'The methods ';
  const tail = running ? ' Other results are still being collected.' : '';
  return `${subject}${agreeWords[direction]}${tail}`;
}
