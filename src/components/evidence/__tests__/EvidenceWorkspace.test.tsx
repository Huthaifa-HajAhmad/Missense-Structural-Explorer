// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { EvidenceWorkspaceProvider, useEvidenceWorkspace, EvidenceViewTabs, EvidencePanel } from '../EvidenceWorkspace';
import EvidenceComparison from '../EvidenceComparison';
import { EvidenceReadingInspector } from '../../inspector/EvidenceReadingInspector';
import { buildAttributionComparison } from '../../../shared/evidenceComparison';
import { buildAlphaGenomeEvidence } from '../../../shared/alphagenomeEvidence';
import { evidenceWorkspaceFixture } from '../../../test/evidenceWorkspaceFixture';
import type { AnalysisResult } from '../../../types';

function Contents() {
  const [tab, setTab] = useState<'alphagenome' | 'clinical'>('alphagenome');
  const w = useEvidenceWorkspace(tab);
  const ev = buildAlphaGenomeEvidence({ result: evidenceWorkspaceFixture('Partial') });
  return <><button onClick={() => setTab(tab === 'clinical' ? 'alphagenome' : 'clinical')}>Change evidence tab</button>
    <output aria-label="View state">{w.view} {w.filter} {w.selected ?? 'None'}</output>
    <EvidenceViewTabs tab={tab} /><EvidencePanel tab={tab}>
      {w.view === 'comparison' ? <EvidenceComparison tab="alphagenome" model={buildAttributionComparison(ev, w.filter)} title="Feature contributions" description="Select a feature" /> : <button onClick={() => w.select('MAX_ABS_RNA_SEQ')}>Pin RNA-seq record</button>}
    </EvidencePanel>
    <EvidenceReadingInspector tab={tab} rows={buildAttributionComparison(ev).rows} />
  </>;
}
function Fixture({ result = evidenceWorkspaceFixture('Partial') }: { result?: AnalysisResult }) {
  return <EvidenceWorkspaceProvider result={result}><Contents /></EvidenceWorkspaceProvider>;
}

describe('Evidence workspace interactions', () => {
  it('pins signed contributions with the real TanStack keyboard renderer and retains the pin across filters and record views', async () => {
    render(<Fixture />);
    // The comparison chart is a lazy chunk; the 1s default expires under full-suite CPU load.
    const chart = await screen.findByRole('img', { name: /^Feature contributions/ }, { timeout: 8000 });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'Home' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('View state')).not.toHaveTextContent('None'));
    // The contribution stem and pin ring are decorative: stepping right must reach
    // another feature, not focus this same feature again at its stem's midpoint.
    const firstPin = screen.getByLabelText('View state').textContent;
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('View state').textContent).not.toBe(firstPin));
    const inspector = screen.getByRole('region', { name: 'Selected evidence reading' });
    expect(within(inspector).getByText(/Signed contribution/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Feature family'), { target: { value: 'indicator' } });
    expect(screen.getByText(/pinned feature is outside this filter/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Feature contributions/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin RNA-seq record' }));
    expect(within(inspector).getByText('The returned contribution is zero.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Comparison' }));
    expect(screen.getByLabelText('Feature family')).toHaveValue('indicator');
    expect(screen.getByLabelText('View state')).toHaveTextContent('MAX_ABS_RNA_SEQ');
  });
  it('retains each tab’s state but resets synchronously when the analysed allele changes', () => {
    const { rerender } = render(<Fixture />);
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin RNA-seq record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change evidence tab' }));
    expect(screen.getByLabelText('View state')).toHaveTextContent('comparison all None');
    fireEvent.click(screen.getByRole('button', { name: 'Change evidence tab' }));
    expect(screen.getByLabelText('View state')).toHaveTextContent('records all MAX_ABS_RNA_SEQ');
    rerender(<Fixture result={evidenceWorkspaceFixture('Mixed')} />);
    expect(screen.getByLabelText('View state')).toHaveTextContent('records all MAX_ABS_RNA_SEQ');
    rerender(<Fixture result={evidenceWorkspaceFixture('New variant')} />);
    expect(screen.getByLabelText('View state')).toHaveTextContent('comparison all None');
  });
  it('keeps missing features inspectable and distinguishes them from a returned zero', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: /ATAC-seq Not attributed/ }));
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent('Missing does not mean zero');
    fireEvent.click(screen.getByRole('button', { name: 'Clear pin' }));
    expect(screen.getByLabelText('View state')).toHaveTextContent('None');
  });
});
