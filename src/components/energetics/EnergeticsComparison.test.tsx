// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EnergeticsComparison from './EnergeticsComparison';
import { buildEnergeticsEvidence } from '../../shared/energeticsEvidence';
import type { EnergyEngineId } from '../../shared/engineStatus';
import type { EnergeticsChartOptions } from '../../shared/energeticsComparison';

function Fixture({ missing = false }: { missing?: boolean }) {
  const [selected, setSelected] = useState<EnergyEngineId | null>(null);
  const [options, setOptions] = useState<EnergeticsChartOptions>({ sort: 'method', countedOnly: false, showMarks: false });
  const evidence = buildEnergeticsEvidence({ foldingStatus: 'success', foldingEnergetics: missing ? {} : { foldxMean: 2, foldx: 2, dynamut2: 0.5, ddmut: 0 } });
  return <><EnergeticsComparison evidence={evidence} unit="kcal/mol" selected={selected} onSelect={setSelected} options={options} onOptions={setOptions} /><output aria-label="Pinned method">{selected ?? 'None'}</output></>;
}

function PinnedFoldxFixture({ showCountedOnly = false }: { showCountedOnly?: boolean }) {
  const [selected, setSelected] = useState<EnergyEngineId | null>('foldx');
  const [options, setOptions] = useState<EnergeticsChartOptions>({ sort: 'method', countedOnly: showCountedOnly, showMarks: false });
  // Failed repair → the FoldX value is displayed but excluded from agreement.
  const evidence = buildEnergeticsEvidence({
    foldingStatus: 'success',
    foldingEnergetics: { foldx: 3, foldxMean: 3, foldxRepairFailed: true, dynamut2: 0.5, ddmut: 1.2 },
  });
  return <><EnergeticsComparison evidence={evidence} unit="kcal/mol" selected={selected} onSelect={setSelected} options={options} onOptions={setOptions} /><output aria-label="Pinned method">{selected ?? 'None'}</output></>;
}

describe('TanStack stability comparison', () => {
  it('labels every returned estimate before interaction, including true zero, without extra selection targets', async () => {
    render(<Fixture />);
    const chart = await screen.findByRole('img', { name: /^Stability estimates by method/ }, { timeout: 8000 });
    for (const value of ['+2.00', '−0.50', '0.00']) expect(within(chart).getByText(value)).toBeInTheDocument();
    expect(within(chart).queryByText('NaN')).not.toBeInTheDocument();
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'Home' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    expect(screen.getByLabelText('Pinned method')).toHaveTextContent('dynamut2');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    // Neither the stem midpoint, direct label nor pin ring is another focus stop.
    await waitFor(() => expect(screen.getByLabelText('Pinned method')).toHaveTextContent('ddmut'));
  });
  it('renders the real library and pins a canonical negative estimate by keyboard', async () => {
    render(<Fixture />);
    // The comparison chart is a lazy chunk; the 1s default expires under full-suite CPU load.
    const chart = await screen.findByRole('img', { name: /^Stability estimates by method/ }, { timeout: 8000 });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'Home' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Pinned method')).toHaveTextContent('dynamut2'));
    expect(screen.getByRole('status', { name: 'Estimate readout' })).toHaveTextContent('−0.50 kcal/mol');
    // The positive FoldX estimate remains reachable after selection rebuilds the chart definition.
    fireEvent.keyDown(chart, { key: 'End' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Pinned method')).toHaveTextContent('foldx'));
  });
  it('offers an inspectable missing-method state with no fabricated zero point', () => {
    render(<Fixture missing />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/No estimates to plot yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /RaSP/ }));
    expect(screen.getByLabelText('Pinned method')).toHaveTextContent('rasp');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Counted only' }));
    expect(screen.getByText(/Turn off Counted only/)).toBeInTheDocument();
  });

  it('says when Counted only hides the pinned estimate instead of silently dropping its point', () => {
    // FoldX returned a value its failed repair excludes from agreement: pinned under "Counted only",
    // its row (and its dot) disappear — the old chart gave no explanation for the vanishing pin.
    render(<PinnedFoldxFixture />);
    expect(screen.getByText(/FoldX: /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Counted only' }));
    expect(screen.getByText(/excluded from the agreement, so "Counted only" hides it/)).toBeInTheDocument();
    expect(screen.getByText(/Turn the filter off/)).toBeInTheDocument();
  });
});
