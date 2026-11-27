// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { PackingView } from './PackingView';
import { NAE1_ENERGETICS, NAE1_METRICS, NAE1_SITE, NAE1_STRUCTURAL_DIFF } from '../../shared/__tests__/fixtures/nae1Packing';

afterEach(cleanup);

/**
 * Packing & geometry moved from the retired Structural perturbation tab to Energetics. It must show the
 * FoldX physical readings on their own, name a missing FoldX run's reason, and carry no language-model text.
 */
describe('PackingView', () => {
  it('draws the FoldX terms and counts once, and lists every physical reading', () => {
    const { container } = render(<PackingView position={116} foldingEnergetics={NAE1_ENERGETICS} structuralDiff={NAE1_STRUCTURAL_DIFF} metrics={NAE1_METRICS} site={NAE1_SITE} />);
    expect(screen.getByRole('heading', { name: 'What changed in the modelled protein structure?' })).toBeInTheDocument();
    expect(screen.getByText(/Input model confidence at residue 116: pLDDT 94.5/)).toBeInTheDocument();
    expect(screen.getByText('Heavy-atom clashes: 3 → 5')).toBeInTheDocument();
    const table = screen.getByTestId('packing-readings');
    for (const key of ['vdw', 'elec', 'neighbour-rmsd', 'clash', 'ca-max', 'contacts', 'sasa']) {
      expect(within(table).getByTestId(`pkg-phys-${key}`)).toBeInTheDocument();
    }
    // Drawn in the figures card, so the row says so rather than drawing it twice.
    expect(within(screen.getByTestId('pkg-phys-vdw')).getByText('Plotted above')).toBeInTheDocument();
    // FoldX keeps the backbone, so Cα displacement is not a measurement.
    expect(within(screen.getByTestId('pkg-phys-ca-max')).getByText('Not measured')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/ESM|SaProt|VESM|language model|embedding/i);
  });

  it('names why there is no FoldX model instead of drawing empty readings', () => {
    render(<PackingView position={116} foldingStatus="failed" foldingError="RepairPDB exceeded its time budget." />);
    expect(within(screen.getByTestId('pkg-foldx-absent')).getByText('The FoldX run failed: RepairPDB exceeded its time budget.')).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-phys-vdw')).toBeNull();
  });
});

describe('PackingView in kJ/mol', () => {
  it('shows the FoldX energy terms in kJ/mol, with no kcal/mol left on the view', () => {
    const { container } = render(<PackingView position={116} unit="kJ/mol" foldingEnergetics={NAE1_ENERGETICS} structuralDiff={NAE1_STRUCTURAL_DIFF} metrics={NAE1_METRICS} site={NAE1_SITE} />);
    expect(within(screen.getByTestId('packing-readings')).getByTestId('pkg-phys-vdw')).toHaveTextContent('kJ/mol');
    expect(container.textContent).not.toContain('kcal/mol');
  });
});
