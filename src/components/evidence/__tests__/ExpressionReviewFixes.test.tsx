// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PextCard } from '../PextCard';
import { DevelopmentalExpressionCard } from '../DevelopmentalExpressionCard';
import { HpoAnnotationCard } from '../HpoAnnotationCard';
import { emptyPhenotypeSelection } from '../../../shared/phenotypeFrame';
import type { PextResponse } from '../../../shared/pext';
import type { DevelopmentalExpressionResponse } from '../../../shared/developmentalExpression';

const data: PextResponse = { gene: 'TEST', status: 'ready', geneId: 'ENSG1', chrom: '21', flags: [], provenance: null, message: null,
  regions: [{ start: 100, stop: 199, mean: null, tissues: [] }, { start: 300, stop: 399, mean: 0.123456, tissues: [{ tissue: 'liver', value: 0 }, { tissue: 'kidney_cortex', value: 0 }] }] };

describe('Expression review fixes', () => {
  it('exposes exact region means and missingness outside mouse hover, and summarises tied tissue values', () => {
    render(<PextCard load={{ status: 'ready', data }} site={{ chrom: '21', pos: 350 }} systems={[]} onRetry={vi.fn()} />);
    expect(screen.getByText('Variant in region 2 of 2')).toBeVisible();
    expect(screen.getByText(/All 2 tissues have base-level pext/)).toHaveTextContent('0.00');
    fireEvent.click(screen.getByText('All 2 tissues'));
    expect(screen.getByRole('rowheader', { name: 'Liver' })).toBeVisible();
    const summary = screen.getByText('All coding region values (2)');
    fireEvent.click(summary);
    const table = screen.getByRole('region', { name: 'Coding region values' });
    expect(within(table).getByText('Not reported')).toBeVisible();
    expect(within(table).getByText('0.123456')).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: '2 (variant)' })).toBeVisible();
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
