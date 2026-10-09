import { KJ_PER_KCAL, type EnergyUnit } from './engineStatus';
import { absenceText, signedDdg, markText, type EnergeticsEvidence, type EnergeticsReading } from './energeticsEvidence';

/** Display geometry only. Canonical signs, calls and inclusion come from the evidence model.
 * Missing values never become points; filtering never changes agreement or the full-data axis.
 * These are model estimates, so neither inter-method spread nor local marks are error bars.
 */
export type EnergySort = 'method' | 'value';
export interface EnergeticsChartOptions { sort: EnergySort; countedOnly: boolean; showMarks: boolean }
export const returnedEnergyEstimates = (evidence: EnergeticsEvidence) => evidence.readings.filter(r => r.ddg !== null).length;
export function energeticsComparisonCautions(evidence: EnergeticsEvidence): string[] {
  const notes: string[] = [];
  if (evidence.lowPlddt !== null) notes.push(`Low confidence in the AlphaFold template here (pLDDT ${evidence.lowPlddt.toFixed(1)}); inspect the structure basis.`);
  const unrepaired = evidence.readings.filter(r => r.caveats.includes('unrepaired-template'));
  if (unrepaired.length) notes.push(`${unrepaired.map(r => r.name).join(', ')} used an unrepaired template, which can distort the estimate.`);
  const excluded = evidence.readings.filter(r => r.ddg !== null && !r.counted);
  if (excluded.length) notes.push(`${excluded.map(r => r.name).join(', ')} returned a value but is excluded from agreement. Select the method for the reason.`);
  return notes;
}
export interface EnergyPoint {
  key: EnergeticsReading['key'];
  name: string;
  value: number;
  row: number;
  guide: number;
  counted: boolean;
  tone: EnergeticsReading['callTone'];
  label: string;
  valueText: string;
  guideLabel: string;
}

export function buildEnergeticsComparison(evidence: EnergeticsEvidence, unit: EnergyUnit, sort: EnergySort = 'method', countedOnly = false) {
  const factor = unit === 'kJ/mol' ? KJ_PER_KCAL : 1;
  const readings = evidence.readings.filter(r => !countedOnly || r.counted).slice();
  if (sort === 'value') readings.sort((a, b) => (b.ddg ?? -Infinity) - (a.ddg ?? -Infinity));
  const points: EnergyPoint[] = readings.flatMap((r, row) => r.ddg === null ? [] : [{
    key: r.key, name: r.name, value: r.ddg === 0 ? 0 : r.ddg * factor, row, guide: r.strongMark * factor,
    counted: r.counted, tone: r.callTone,
    valueText: signedDdg(r.ddg, unit).replace(/ (kcal|kJ)\/mol$/, ''),
    guideLabel: `Local destabilising guide for ${r.name}: ${markText(r.strongMark, unit)} ${unit}. App-defined, not a clinical cut-point.`,
    label: `${r.name}: ${signedDdg(r.ddg, unit)}. ${r.callLabel ?? 'Estimate'}${r.counted ? '' : '; not counted in agreement'}.`,
  }]);
  const extent = evidence.readings.flatMap(r => r.ddg === null ? [] : [r.ddg, r.strongMark]);
  const min = Math.min(-1, ...extent);
  const max = Math.max(1, ...extent);
  const padding = (max - min) * 0.12;
  return {
    readings, points,
    domain: [(min - padding) * factor, (max + padding) * factor] as [number, number],
    missing: readings.filter(r => r.ddg === null).map(r => ({ key: r.key, name: r.name, status: r.outcome.label, reason: absenceText(r) })),
    summary: `${points.length} displayed estimates. Positive values predict less stable folding; negative values predict more stable folding. ${readings.length - points.length} displayed methods have no estimate. Values are predictions, not a disease classification.`,
  };
}

export function energeticsComparisonFinding(evidence: EnergeticsEvidence): string {
  const a = evidence.agreement;
  if (a.nCounted === 0) return 'There are not enough usable results to compare stability estimates.';
  if (a.nCounted === 1) return 'One method has a usable result. Agreement cannot be assessed yet.';
  if (a.direction === 'split') return 'The methods give different stability readings. Inspect the individual estimates before drawing a conclusion.';
  if (a.direction === 'destabilizing') return 'The methods agree on a destabilising reading under their local marks.';
  if (a.direction === 'moderate') return 'The methods agree on a moderately destabilising reading under their local marks.';
  return 'The methods do not predict destabilisation under their local marks. This does not establish that the variant is benign.';
}
