// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LandscapeAgreement } from '../LandscapeAgreement';
import type { LandscapeResidueItem } from '../../../shared/contracts';

const rows = [
  { residx: 1, revelMean: 0.9, amMean: 0.1, revelCount: 2, amCount: 2 },
  { residx: 2, revelMean: 0.9, amMean: 0.95, revelCount: 2, amCount: 2 },
  { residx: 3, revelMean: 0, amMean: 0, revelCount: 2, amCount: 2 },
  { residx: 4, revelMean: null, amMean: 0.8, revelCount: 0, amCount: 2 },
] as LandscapeResidueItem[];

function setup() {
  const select = vi.fn();
  render(<LandscapeAgreement rows={rows} mode="mean" variantRevel={0.9} variantAm={0.95} selectedResidue={2} onSelect={select} onHover={() => {}} />);
  return select;
}
describe('Landscape agreement exploration', () => {
  it('counts missing paired scores separately and keeps measured zeros', () => {
    setup();
    expect(screen.getByRole('status').textContent).toContain('3 of 3 paired residues shown · 1 without paired scores');
    expect(screen.getByRole('button', { name: 'Residue 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Residue 4' })).toBeNull();
  });
  it('filters the chart and table together, and selects a residue from the table', () => {
    const select = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Discordant/ }));
    expect(screen.getByRole('status').textContent).toContain('1 of 3 paired residues shown');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(within(table).getByRole('button', { name: 'Residue 1' }));
    expect(select).toHaveBeenCalledWith(1);
    expect(screen.getByText(/The diamond is the queried variant/)).toBeTruthy();
  });
  it('supports precise region selection with keyboard-accessible numeric fields and reset', () => {
    setup();
    fireEvent.click(screen.getByText('Set score range'));
    fireEvent.change(screen.getByLabelText('REVEL maximum'), { target: { value: '0.2' } });
    expect(screen.getByRole('status').textContent).toContain('1 of 3 paired residues shown');
    fireEvent.click(screen.getByRole('button', { name: 'Clear region' }));
    expect(screen.getByRole('status').textContent).toContain('3 of 3 paired residues shown');
  });
});
