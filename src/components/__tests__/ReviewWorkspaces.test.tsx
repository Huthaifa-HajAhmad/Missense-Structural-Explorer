// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewWorkspaceProvider, useReviewWorkspace } from '../review/ReviewWorkspace';
import { InsightsScreen } from '../insights/InsightsScreen';
import { InsightsInspector } from '../inspector/InsightsInspector';
import { SettingsProvider } from '../../context/SettingsContext';
import { buildInsightsEvidence } from '../../shared/insightsEvidence';
import { functionEvidenceInputFrom } from '../evidence/function/functionInput';
import { deriveConsensus } from '../../lib/insightsConsensus';
import { nae1Reference } from '../../shared/__tests__/fixtures/splicingReference';
import LiteratureView from '../LiteratureView';
import { PaperTable } from '../literature/PaperTable';
import { buildLiteratureEvidence } from '../../shared/literatureEvidence';
import LiteratureInspector from '../inspector/LiteratureInspector';
import type { LiteratureEvidence } from '../../shared/literatureEvidence';
import { INSPECTOR_SECTIONS } from '../../lib/inspectorFocus';

const api = vi.hoisted(() => ({ getLiterature: vi.fn() }));
vi.mock('../../apiClient', () => ({ useApiClient: () => ({ apiClient: api }) }));
const result = nae1Reference();
const evidence = buildInsightsEvidence({ result, functionInput: functionEvidenceInputFrom(result), stability: null });
const papers = Array.from({ length: 12 }, (_, i) => ({ id: String(91000000 + i), title: `NAE1 source ${i + 1}`, authors: 'Research consortium', journal: 'Fixture journal', year: 2026 - i,
  abstract: i === 0 ? 'We report a patient with NAE1 p.Asp116Gly.' : 'NAE1 enzyme activity was measured in vitro.' }));

beforeEach(() => {
  api.getLiterature.mockImplementation(async (_gene, _force, _signal, query) => ({ gene: 'NAE1', citations: query ? [] : papers, hitCount: query ? 0 : 204,
    europePmcQuery: query || 'NAE1 AND variant', degraded: false, fetchedAt: 1700000000000, pageSize: 25 }));
});

describe('Insights reading workspace', () => {
  it.each([['PP3_Moderate', 'Moderate'], ['PP3_Strong', 'Strong'], ['BP4_Moderate', 'Strong']] as const)('shows the recorded strength of %s in both panes', (code, strength) => {
    const analysis = nae1Reference({ ruleBasedInsights: { acmgVerdict: 'Variant of Uncertain Significance (VUS)', acmgCriteria: [{ code, reason: 'Recorded calibrated criterion' }] }, insights: { acmgCriteria: [] } });
    const ev = buildInsightsEvidence({ result: analysis, functionInput: functionEvidenceInputFrom(analysis), stability: null });
    render(<SettingsProvider><ReviewWorkspaceProvider result={analysis}><InsightsScreen evidence={ev} narrative={null} /><InsightsInspector analysisResult={analysis} /></ReviewWorkspaceProvider></SettingsProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Computational' }));
    const selected = screen.getByRole('region', { name: 'Selected evidence reading' });
    expect(selected).toHaveAttribute('id', INSPECTOR_SECTIONS.evidenceReading);
    expect(selected).toHaveTextContent(`Recorded strength: ${strength}.`);
    expect(selected).not.toHaveTextContent('Not weighted');
    const lane = screen.getByRole('button', { name: 'Computational' }).closest('.ins-lane')!;
    expect(within(lane as HTMLElement).getByText(strength, { selector: '.ins-dim' })).toBeInTheDocument();
  });
  it('keeps PM2 guide wording consistent with the records table', () => {
    const analysis = nae1Reference({ ruleBasedInsights: { acmgVerdict: 'Uncertain', acmgCriteria: [{ code: 'PM2', reason: 'Recorded rarity' }] }, insights: { acmgCriteria: [] } });
    const ev = buildInsightsEvidence({ result: analysis, functionInput: functionEvidenceInputFrom(analysis), stability: null });
    render(<InsightsScreen evidence={ev} narrative={null} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Criterion records' }));
    const pm2 = screen.getByRole('rowheader', { name: /PM2/ });
    expect(pm2).toHaveTextContent('Supporting');
    expect(screen.getByText('The change is very rare or absent in healthy population databases. Supporting.')).toBeInTheDocument();
  });
  function tree(mounted = true, analysis = result) {
    return <SettingsProvider><ReviewWorkspaceProvider result={analysis}>
      {mounted && <InsightsScreen evidence={evidence} narrative={null} />}
      <InsightsInspector analysisResult={analysis} />
    </ReviewWorkspaceProvider></SettingsProvider>;
  }
  it('retains a selected lane and view across remounts, then resets for a different allele', () => {
    const view = render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Computational' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Criterion records' }));
    expect(within(screen.getByRole('region', { name: 'Selected evidence reading' })).getByText('Computational')).toBeInTheDocument();
    view.rerender(tree(false)); view.rerender(tree());
    expect(screen.getByRole('tab', { name: 'Criterion records' })).toHaveAttribute('aria-selected', 'true');
    view.rerender(tree(true, { ...result, metadata: { ...result.metadata!, variant: 'p.Asp116Ala' } }));
    expect(screen.getByRole('tab', { name: 'Evidence map' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
  });
  it('switches views without moving focus to a reading; explicit reveal does move it', () => {
    render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Computational' }));
    const tab = screen.getByRole('tab', { name: 'Evidence map' }); tab.focus();
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Criterion records' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Show in evidence map' }));
    expect(screen.getByRole('button', { name: 'Computational' })).toHaveFocus();
    const summary = screen.getByRole('tab', { name: 'Written summary' }); summary.focus(); fireEvent.click(summary);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence map' }));
    expect(screen.getByRole('button', { name: 'Computational' })).not.toHaveFocus();
  });
  it('keeps the stability reading in the inspector identical to the screen', () => {
    const foldingEnergetics = { foldx: 3, dynamut2: -2, ddmut: -2, rasp: 2, thermompnn: 2, stabilityoracle: 2 };
    const consensus = deriveConsensus({ result, foldingEnergetics })!;
    const ev = buildInsightsEvidence({ result, functionInput: functionEvidenceInputFrom(result), stability: { verdict: consensus.consensusVerdict, enginesCounted: consensus.enginesCounted, enginesDestabilizing: consensus.enginesDestabilizing } });
    render(<SettingsProvider><ReviewWorkspaceProvider result={result}><InsightsScreen evidence={ev} narrative={null} /><InsightsInspector analysisResult={result} foldingEnergetics={foldingEnergetics} /></ReviewWorkspaceProvider></SettingsProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Stability' }));
    const lane = ev.lanes.find(l => l.key === 'stability')!;
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent(lane.lead);
    expect(screen.getByRole('region', { name: 'Selected evidence reading' })).toHaveTextContent(lane.rest);
  });
});

describe('Literature reading workspace', () => {
  function Harness({ report }: { report: (e: LiteratureEvidence) => void }) {
    const [ev, setEv] = React.useState<LiteratureEvidence | null>(null);
    return <ReviewWorkspaceProvider result={result}><LiteratureView gene="NAE1" variant="p.Asp116Gly" onEvidenceChange={e => { setEv(e); report(e); }} /><LiteratureInspector gene="NAE1" variant="p.Asp116Gly" evidence={ev} /></ReviewWorkspaceProvider>;
  }
  it('does not present an unsupported variant check as a zero-match group', async () => {
    render(<LiteratureView gene="NAE1" variant="c.123A>G" />);
    await screen.findByTestId('literature-table');
    const coverage = screen.getByRole('region', { name: 'What the loaded text names' });
    expect(within(coverage).getAllByRole('button')).toHaveLength(2);
    expect(within(coverage).queryByRole('button', { name: /Names (the variant|p\.|c\.)/ })).not.toBeInTheDocument();
    expect(coverage).toHaveTextContent('Variant notation is unavailable; these groups check the gene only.');
    expect(within(coverage).getByRole('button', { name: /^Names NAE1/ })).toBeInTheDocument();
  });
  it('identifies a selected source that is absent from a subsequent query', async () => {
    function SearchHarness() {
      const [query, setQuery] = React.useState('');
      const [ev, setEv] = React.useState<LiteratureEvidence | null>(null);
      return <ReviewWorkspaceProvider result={result}><LiteratureView gene="NAE1" variant="p.Asp116Gly" searchQuery={query} onSearchQueryChange={setQuery} onEvidenceChange={setEv} /><LiteratureInspector gene="NAE1" variant="p.Asp116Gly" searchQuery={query} onSearch={setQuery} evidence={ev} /></ReviewWorkspaceProvider>;
    }
    render(<SearchHarness />);
    await screen.findByTestId('paper-91000000');
    fireEvent.click(within(screen.getByTestId('paper-91000000')).getByRole('button', { name: 'Inspect source' }));
    const search = screen.getByLabelText('Search literature');
    fireEvent.change(search, { target: { value: 'no sources' } });
    fireEvent.submit(search.closest('form')!);
    await screen.findByText('The selected paper is not in this search result. Clear the selection or select another loaded source.');
    expect(within(screen.getByRole('region', { name: 'Selected paper' })).queryByText('NAE1 source 1')).not.toBeInTheDocument();
  });
  it('consumes a reveal whose selected source is absent from the completed set', async () => {
    function RevealControl() {
      const w = useReviewWorkspace('literature');
      return <><button onClick={() => { w.select('missing'); w.showSelected(); }}>Simulate lost source</button><output data-testid="reveal-request">{w.reveal}</output></>;
    }
    render(<ReviewWorkspaceProvider result={result}><LiteratureView gene="NAE1" variant="p.Asp116Gly" /><RevealControl /></ReviewWorkspaceProvider>);
    await screen.findByTestId('literature-table');
    fireEvent.click(screen.getByRole('button', { name: 'Simulate lost source' }));
    await waitFor(() => expect(screen.getByTestId('reveal-request')).toHaveTextContent('0'));
    const search = screen.getByLabelText('Search literature'); search.focus();
    fireEvent.change(search, { target: { value: 'NAE1' } });
    expect(search).toHaveFocus();
  });
  it('downloads eight displayed records and all twelve shortlist records', async () => {
    render(<Harness report={() => {}} />);
    await screen.findByTestId('literature-table');
    fireEvent.click(screen.getByRole('button', { name: 'Show all tiers' }));
    await waitFor(() => expect(screen.getByText('The 8 papers shown, with any filter applied.')).toBeInTheDocument());
    const blobs: Blob[] = [];
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:fixture'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      for (const name of ['BibTeX', 'RIS', 'CSV', 'Export shortlist']) fireEvent.click(screen.getByRole('button', { name }));
      vi.runOnlyPendingTimers(); vi.useRealTimers();
      const texts = await Promise.all(blobs.map(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
      })));
      expect(texts[0].match(/@article\{/g)).toHaveLength(8);
      expect(texts[1].match(/TY  - JOUR/g)).toHaveLength(8);
      expect(texts[2].match(/^NAE1,p\.Asp116Gly,\d+,/gm)).toHaveLength(8);
      expect(texts[3].match(/^NAE1,p\.Asp116Gly,\d+,/gm)).toHaveLength(12);
      expect(texts[2]).not.toContain('91000011');
      expect(texts[3]).toContain('91000011');
    } finally {
      vi.useRealTimers(); click.mockRestore();
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else Reflect.deleteProperty(URL, 'createObjectURL');
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });
  it('reports success only after the clipboard write completes', async () => {
    let complete!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<Harness report={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'NAE1 source 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copy PMID' }));
      expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
      await act(async () => complete());
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith('91000000');
    } finally { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); }
  });
  it('explains a supported zero-match coverage group and recovers to all sources', async () => {
    api.getLiterature.mockResolvedValue({ gene: 'NAE1', citations: papers.slice(1), hitCount: 11, degraded: false });
    render(<Harness report={() => {}} />);
    await screen.findByTestId('literature-table');
    const coverage = screen.getByRole('heading', { name: 'What the loaded text names' }).closest('section')!;
    const zeroGroup = within(coverage).getByRole('button', { name: /^Names p.Asp116Gly/ });
    expect(zeroGroup).toHaveTextContent('0 / 11');
    fireEvent.click(zeroGroup);
    expect(screen.getByText('None in this group')).toBeInTheDocument();
    fireEvent.click(zeroGroup);
    expect(screen.getByTestId('literature-table')).toBeInTheDocument();
  });
  it('preserves a draft query while revealing a source outside its narrowing filter', async () => {
    render(<Harness report={() => {}} />);
    await screen.findByTestId('literature-table');
    fireEvent.click(within(screen.getByTestId('paper-91000000')).getByRole('button', { name: 'Inspect source' }));
    const search = screen.getByLabelText('Search literature');
    fireEvent.change(search, { target: { value: 'unsubmitted draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show selected source record' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'NAE1 source 1' })).toHaveFocus());
    expect(search).toHaveValue('unsubmitted draft');
    search.focus(); fireEvent.change(search, { target: { value: 'new draft' } });
    expect(search).toHaveFocus();
    expect(screen.queryByTestId('paper-91000000')).not.toBeInTheDocument();
  });
  it('bounds the desk and its export to eight papers; records expose all twelve loaded papers', async () => {
    let latest: LiteratureEvidence | null = null;
    render(<Harness report={e => { latest = e; }} />);
    await screen.findByTestId('literature-table');
    fireEvent.click(screen.getByRole('button', { name: 'Show all tiers' }));
    expect(within(screen.getByTestId('literature-table')).getAllByTestId(/^paper-/)).toHaveLength(8);
    await waitFor(() => expect(latest!.displayed).toHaveLength(8));
    expect(latest!.counts.total).toBe(12);
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    await waitFor(() => expect(latest!.displayed).toHaveLength(12));
    expect(within(screen.getByTestId('literature-table')).getAllByTestId(/^paper-/)).toHaveLength(12);
  });
  it('keeps hidden selections inspectable and reveals their source with explicit focus', async () => {
    render(<Harness report={() => {}} />);
    const table = await screen.findByTestId('literature-table');
    fireEvent.click(within(screen.getByTestId('paper-91000000')).getByRole('button', { name: 'Inspect source' }));
    fireEvent.click(screen.getByRole('button', { name: /^Names only NAE1/ }));
    await screen.findByText(/outside the current reading desk or filters/);
    expect(within(table).queryByTestId('paper-91000000')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show selected source record' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'NAE1 source 1' })).toHaveFocus());
    const search = screen.getByLabelText('Search literature'); search.focus(); fireEvent.change(search, { target: { value: 'NAE1' } });
    await waitFor(() => expect(search).toHaveFocus());
  });
  it('reports clipboard failure instead of claiming that a copy succeeded', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    try {
      render(<Harness report={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'NAE1 source 1' }));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy PMID' })));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
      expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    } finally { if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard'); }
  });
});

describe('Source reveal lifecycle', () => {
  it('consumes a missing target so a later result cannot steal focus', () => {
    const ev = buildLiteratureEvidence({ gene: 'NAE1', variant: 'p.Asp116Gly', citations: papers, load: 'ready', response: null, executedQuery: '', narrowingFilter: '', groupFilter: 'all', pinnedIds: new Set(), probe: { state: 'idle', hitCount: null }, error: null });
    function Harness({ loaded }: { loaded: boolean }) {
      const [reveal, setReveal] = React.useState(1);
      return <><input aria-label="Draft search" /><PaperTable papers={loaded ? ev.papers : []} gene="NAE1" forms={null} constraint={null} onTogglePin={() => {}} selectedId="91000000" reveal={reveal} onRevealed={() => setReveal(0)} /></>;
    }
    const view = render(<Harness loaded={false} />);
    screen.getByLabelText('Draft search').focus();
    view.rerender(<Harness loaded />);
    expect(screen.getByRole('button', { name: 'NAE1 source 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Draft search')).toHaveFocus();
  });
});
