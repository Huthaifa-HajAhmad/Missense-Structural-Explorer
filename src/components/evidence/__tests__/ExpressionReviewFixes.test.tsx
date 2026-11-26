// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { ExpressionAnswer } from '../expression/ExpressionAnswer';
import { ReviewContextBar } from '../expression/ReviewContextBar';
import { buildExpressionFinding, buildSourceFacts } from '../../../shared/expressionTabEvidence';
import { PextCard } from '../PextCard';
import { PextStrip } from '../ContextCharts';
import { DevelopmentalExpressionCard } from '../DevelopmentalExpressionCard';
import { HpoAnnotationCard } from '../HpoAnnotationCard';
import { HpaCard } from '../HpaCard';
import type { HpaResponse } from '../../../shared/hpa';
import { emptyPhenotypeSelection } from '../../../shared/phenotypeFrame';
import type { PextResponse } from '../../../shared/pext';
import type { DevelopmentalExpressionResponse } from '../../../shared/developmentalExpression';

const data: PextResponse = { gene: 'TEST', status: 'ready', geneId: 'ENSG1', chrom: '21', flags: [], provenance: null, message: null,
  regions: [{ start: 100, stop: 199, mean: null, tissues: [] }, { start: 300, stop: 399, mean: 0.123456, tissues: [{ tissue: 'liver', value: 0 }, { tissue: 'kidney_cortex', value: 0 }] }] };

describe('Expression review fixes', () => {
  it('shows all four source readings and explains early-onset coverage', () => {
    const facts = buildSourceFacts({ adult: buildExpressionFinding(null, null, []), developmental: undefined, hpa: undefined,
      pext: { load: null, status: null, location: { state: 'no-gene-locus', region: null, index: -1 }, regionCount: 0 } });
    render(<ExpressionAnswer answer={{ source: 'Adult RNA', headline: 'Reading GTEx', detail: 'Loading tissues' }} coverage={[]} facts={facts} onset="childhood" />);
    const summary = screen.getByRole('region', { name: 'Expression summary' });
    expect(within(summary).getAllByRole('term')).toHaveLength(4);
    expect(within(summary).getByText('At the variant').nextElementSibling).toHaveTextContent('No gene locus');
    expect(within(summary).getByRole('note')).toHaveTextContent('Adult GTEx does not cover this onset period');
  });
  it('opens review systems from an independent action while keeping the disclosure usable', () => {
    const ref = createRef<HTMLDetailsElement>();
    render(<ReviewContextBar ref={ref} disease="A long disease label" systemCount={0}
      action={<button onClick={() => { ref.current!.open = true; }}>Change review systems</button>}><p>System choices</p></ReviewContextBar>);
    expect(screen.getByText('System choices')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change review systems' }));
    expect(screen.getByText('System choices')).toBeVisible();
    expect(screen.getByText('All systems')).toBeVisible();
  });
  it('separates HPA protein existence from the antibody-staining result instead of one contradictory "Protein" row', () => {
    // ABCG1: HPA says "Evidence at protein level" (the protein exists) and IHC "Not detected" in normal tissues.
    const hpa = { gene: 'ABCG1', status: 'ready', ensemblId: 'ENSG00000160179', provenance: null, message: null,
      rna: { specificity: 'Low tissue specificity', distribution: 'Detected in all', enrichedTissues: [] },
      cells: { specificity: 'Low cell type specificity', distribution: 'Detected in many', enrichedCells: [] },
      protein: { evidence: 'Evidence at protein level', tissueSpecificity: 'Not detected', antibodies: ['HPA031470'], reliabilityIhc: 'Approved', reliabilityIf: 'Approved' } } as HpaResponse;
    render(<HpaCard load={{ status: 'ready', data: hpa }} onRetry={vi.fn()} />);
    expect(screen.getByText('Protein existence').nextElementSibling).toHaveTextContent(/^Evidence at protein level/);
    expect(screen.getByText('Protein in tissues').nextElementSibling).toHaveTextContent(/^Not detected.*immunohistochemistry/);
    expect(screen.queryByText(/Tissue pattern/)).not.toBeInTheDocument();
  });
  it('exposes exact region means and missingness outside mouse hover, and summarises tied tissue values', () => {
    render(<PextCard transcript="NM_013809.3" load={{ status: 'ready', data }} site={{ chrom: '21', pos: 350 }} systems={[]} onRetry={vi.fn()} />);
    expect(screen.getByText('NM_013809.3')).toBeVisible();
    expect(screen.getByText(/does not show the exons or the expression of/)).toBeVisible();
    // A pext region is not an exon (gnomAD cuts the coding bases of all transcripts wherever pext changes); the card says so.
    expect(screen.getByText(/A region is not an exon/)).toBeVisible();
    expect(screen.getByText('Coding region').nextElementSibling).toHaveTextContent('2 of 2');
    expect(screen.getByText(/All 2 tissues have base-level pext/)).toHaveTextContent('All 2 tissues have base-level pext 0 in this region');
    fireEvent.click(screen.getByText('All 2 tissues'));
    expect(screen.getByRole('rowheader', { name: 'Liver' })).toBeVisible();
    const summary = screen.getByText('All coding region values (2)');
    fireEvent.click(summary);
    const table = screen.getByRole('region', { name: 'Coding region values' });
    expect(within(table).getByText('Not reported')).toBeVisible();
    expect(within(table).getByText('0.123456')).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: '2 (variant)' })).toBeVisible();
  });
  it('does not describe rounded tissue values as identical, and numbers narrow coding regions', () => {
    const distinct = { ...data, regions: [{ start: 100, stop: 10000, mean: 1, tissues: [] }, { start: 10001, stop: 10002, mean: 1, tissues: [{ tissue: 'liver', value: 0.9991 }, { tissue: 'kidney_cortex', value: 1 }] }] };
    const { container } = render(<PextCard load={{ status: 'ready', data: distinct }} site={{ chrom: '21', pos: 10001 }} systems={[]} onRetry={vi.fn()} />);
    expect(screen.queryByText(/All 2 tissues have base-level pext/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-region-label="2"]')).toHaveTextContent('2');
    expect(screen.getByText('0.9991')).toBeVisible();
    expect(screen.getByText('1', { selector: 'td .ctx-mono' })).toBeVisible();
  });
  it.each([0, 0.0001, 0.9991, 1])('preserves the exact uniform tissue value %s in the summary and table', value => {
    const uniform = { ...data, regions: [{ start: 100, stop: 200, mean: value, tissues: [{ tissue: 'liver', value }] }] };
    render(<PextCard load={{ status: 'ready', data: uniform }} site={{ chrom: '21', pos: 150 }} systems={[]} onRetry={vi.fn()} />);
    expect(screen.getByText(/The tissue has base-level pext/)).toHaveTextContent(`The tissue has base-level pext ${value} in this region`);
    fireEvent.click(screen.getByText('All 1 tissue'));
    expect(screen.getByText(String(value), { selector: 'td .ctx-mono' })).toBeVisible();
  });
  it('keeps unknown tissue values distinct from a uniform measured value', () => {
    const missing = { ...data, regions: [{ start: 100, stop: 200, mean: 1, tissues: [{ tissue: 'liver', value: 1 }, { tissue: 'kidney_cortex', value: null }] }] };
    render(<PextCard load={{ status: 'ready', data: missing }} site={{ chrom: '21', pos: 150 }} systems={[]} onRetry={vi.fn()} />);
    expect(screen.queryByText(/All 2 tissues have base-level pext/)).not.toBeInTheDocument();
    expect(screen.getByText('No value')).toBeVisible();
  });
  it('limits labels on dense maps and reserves the active region on a single baseline', () => {
    const regions = Array.from({ length: 320 }, (_, i) => ({ start: i * 10 + 1, stop: i * 10 + 10, mean: 1, tissues: [] }));
    const { container } = render(<PextStrip regions={regions} activeIndex={159} position={1595} />);
    const labels = [...container.querySelectorAll('[data-region-label]')];
    expect(labels.length).toBeLessThan(50);
    expect(container.querySelector('[data-region-label="160"]')).toHaveTextContent('160');
    expect(new Set(labels.map(label => label.getAttribute('y')))).toEqual(new Set(['94']));
    for (let i = 1; i < labels.length; i++) {
      const previous = labels[i - 1];
      const current = labels[i];
      const distance = Number(current.getAttribute('x')) - Number(previous.getAttribute('x'));
      expect(distance).toBeGreaterThan((previous.textContent!.length + current.textContent!.length) * 4);
    }
  });
  it('names no transcript, and does not claim one, when none is known', () => {
    render(<PextCard load={{ status: 'ready', data }} site={{ chrom: '21', pos: 350 }} systems={[]} onRetry={vi.fn()} />);
    expect(screen.queryByText(/Annotation transcript/)).not.toBeInTheDocument();
    expect(screen.getByText(/expression of the transcript carrying the variant/)).toBeVisible();
  });
  it('keeps relevant tissues visible and other tissues reachable in their disclosure', () => {
    render(<PextCard load={{ status: 'ready', data }} site={{ chrom: '21', pos: 350 }} systems={['renal']} onRetry={vi.fn()} />);
    expect(screen.getByRole('rowheader', { name: 'Kidney cortex' })).toBeVisible();
    expect(screen.getByRole('rowheader', { name: 'Liver' })).not.toBeVisible();
    fireEvent.click(screen.getByText('Other tissues (1)'));
    expect(screen.getByRole('rowheader', { name: 'Liver' })).toBeVisible();
  });
  it.each(['not-installed', 'error'] as const)('shows pediatric %s details and an explicit retry action', status => {
    const retry = vi.fn();
    const response: DevelopmentalExpressionResponse = { gene: 'TEST', status, gencodeId: null, observations: [], counts: null, provenance: null, message: 'Snapshot unavailable at the configured path.' };
    render(<DevelopmentalExpressionCard load={{ status: 'ready', data: response }} systems={[]} onRetry={retry} />);
    expect(screen.getByRole('status')).toHaveClass('cx-source-state');
    expect(screen.getByRole('status')).toHaveTextContent(response.message!);
    fireEvent.click(screen.getByRole('button', { name: status === 'error' ? 'Try again' : 'Check again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('exposes HPO failure details with its recovery action', () => {
    const retry = vi.fn();
    render(<HpoAnnotationCard load={{ status: 'error', data: null, error: 'HPO source failed.' }} hasDisease hasIds diseaseId="MONDO:1" selection={emptyPhenotypeSelection()} onChange={vi.fn()} onRetry={retry} />);
    expect(screen.getByRole('status')).toHaveClass('cx-source-state');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
