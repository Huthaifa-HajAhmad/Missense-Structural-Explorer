// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import AppViews from '../AppViews';
import type { MasterView } from '../MasterSidebar';
import { SettingsProvider } from '../../context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../stores/useVariantAnalysisStore';
import { landscapeKey } from '../../shared/landscapeEvidence';
import { SOD1_LANDSCAPE_CONTEXT } from '../../shared/__tests__/fixtures/sod1Landscape';

vi.mock('../../hooks/useProteinSequence', () => ({ useProteinSequence: () => ({ sequence: 'MAAAAVAAAA', isLoading: false, error: null }) }));
vi.mock('../LiteratureView', () => ({ default: () => null }));
vi.mock('../telemetry/LiveTelemetryPanel', () => ({ default: () => null }));
vi.mock('../MolstarViewer', () => ({ default: (props: { onResidueClick: (position: number) => void; model: { family: string } }) => <div data-testid="canvas-instance">
  <button onClick={() => props.onResidueClick(8)}>Pick structure residue 8</button>
  <button onClick={() => props.onResidueClick(5)}>Pick structure residue 5</button>
  <span>Canvas family: {props.model.family}</span>
</div> }));
afterEach(cleanup);

function Workspace({ initialView = 'landscape' }: { initialView?: MasterView }) {
  const [view, setView] = useState<MasterView>(initialView);
  const [mode, setMode] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  return <SettingsProvider><AppViews masterView={view} setMasterView={setView} pushErrorEntry={vi.fn()} setIsSettingsOpen={vi.fn()}
    activeEvidenceTab="population" setActiveEvidenceTab={vi.fn()} metricMode={mode} setMetricMode={setMode} windowSize={width} setWindowSize={setWidth}
    classCardTitle="" classCardHeader="" classBorderSec="" classTextBody="" classTextMute="" /></SettingsProvider>;
}

const key = landscapeKey('TEST', 'p.Ala5Val', 'FIXTURE');
const seed = () => store.setState({ gene: 'TEST', variant: 'p.Ala5Val', uniprotId: 'FIXTURE', selectedResidueIndex: 5, hoveredResidueIndex: null,
  landscapeSelection: { key, kind: 'substitution', pos: 5, alt: 'V' },
  landscapeOverview: { key, status: 'ready', error: null, data: { positions: [], context: SOD1_LANDSCAPE_CONTEXT } as any },
  analysisState: { isLoading: false, error: null, result: { metadata: { residueIndex: 5, wildType: 'Ala', mutant: 'Val' }, landscapeData: [] } } as any,
  pdbText: null, customPdbUrl: null, esmFoldWtPdb: null, esmFoldMutPdb: null, viewMode: 'wildtype',
});
beforeEach(seed);

it('keeps the 3D canvas unmounted when visiting an empty workspace and returning to Search', async () => {
  store.setState({ analysisState: { result: null, isLoading: false, error: null }, gene: '', variant: '', uniprotId: '' });
  const ui = render(<Workspace initialView="structure_alphafold" />);
  expect(ui.getByRole('heading', { name: 'No analysis loaded' })).toBeInTheDocument();
  expect(ui.queryByTestId('canvas-instance')).toBeNull();
  await act(async () => fireEvent.click(ui.getByRole('button', { name: 'Analyse a variant' })));
  expect(ui.getByRole('heading', { name: 'Analyse a variant' })).toBeInTheDocument();
  expect(ui.queryByTestId('canvas-instance')).toBeNull();
});

it('links Energetics records to the inspector, retains plot controls, and resets selection for a new query', async () => {
  store.setState({ foldingEnergetics: { foldx: 2, foldxMean: 2, dynamut2: 0.5 } as any, foldingStatus: 'success' });
  const ui = render(<Workspace initialView="energetics" />);
  // The comparison is a lazy import; under a loaded full-suite worker it needs more than the default second.
  await ui.findByRole('img', { name: /^Stability estimates by method/ }, { timeout: 6000 });
  fireEvent.change(ui.getByRole('combobox', { name: 'Order' }), { target: { value: 'value' } });
  fireEvent.click(ui.getByRole('checkbox', { name: 'Local guides' }));
  fireEvent.click(ui.getByRole('tab', { name: 'Engine records' }));
  fireEvent.click(ui.getByRole('button', { name: 'DynaMut2' }));
  expect(ui.getByRole('heading', { name: 'DynaMut2' })).toBeInTheDocument();
  expect(store.getState().selectedResidueIndex).toBe(5);
  expect(store.getState().analysisState.result?.metadata?.residueIndex).toBe(5);
  fireEvent.click(ui.getByRole('tab', { name: 'Comparison' }));
  expect(await ui.findByRole('combobox', { name: 'Order' })).toHaveValue('value');
  expect(ui.getByRole('checkbox', { name: 'Local guides' })).toBeChecked();
  act(() => store.setState({ variant: 'p.Ala6Val' }));
  expect(ui.getByRole('heading', { name: 'Explore an estimate' })).toBeInTheDocument();
  expect(await ui.findByRole('combobox', { name: 'Order' })).toHaveValue('method');
});

async function openStructure(ui: ReturnType<typeof render>) {
  fireEvent.click(ui.getByRole('tab', { name: 'Focus residue' }));
  fireEvent.click(ui.getByRole('button', { name: 'Inspect in 3D' }));
  return ui.findByTestId('canvas-instance');
}

it('defers the canvas, then keeps its identity, family and the Landscape tab across navigation', async () => {
  const ui = render(<Workspace />);
  expect(ui.queryByTestId('canvas-instance')).toBeNull();
  const canvas = await openStructure(ui);
  fireEvent.click(ui.getByRole('tab', { name: 'ESMFold' }));
  fireEvent.click(ui.getByRole('button', { name: 'Open Landscape' }));
  expect(ui.getByRole('tab', { name: 'Focus residue' }).getAttribute('aria-selected')).toBe('true');
  expect(ui.getByTestId('canvas-instance')).toBe(canvas);
  fireEvent.click(ui.getByRole('button', { name: 'Inspect in 3D' }));
  expect(ui.getByRole('tab', { name: 'ESMFold' }).getAttribute('aria-selected')).toBe('true');
  expect(ui.getByTestId('canvas-instance')).toBe(canvas);
});

it('selects a picked residue without moving the queried variant', async () => {
  const ui = render(<Workspace />);
  await openStructure(ui);
  fireEvent.click(ui.getByRole('button', { name: 'Pick structure residue 8' }));
  expect(store.getState().selectedResidueIndex).toBe(8);
  expect(store.getState().landscapeSelection).toEqual({ key, kind: 'residue', pos: 8 });
  expect(store.getState().analysisState.result?.metadata?.residueIndex).toBe(5);
});

it('keeps a same-position substitution selection intact and clears a stale nucleotide selection', async () => {
  store.setState({ selectedGenomicVariant: { id: 'stale' } as any });
  const ui = render(<Workspace />);
  await openStructure(ui);
  fireEvent.click(ui.getByRole('button', { name: 'Pick structure residue 5' }));
  expect(store.getState().landscapeSelection).toEqual({ key, kind: 'substitution', pos: 5, alt: 'V' });
  fireEvent.click(ui.getByRole('button', { name: 'Pick structure residue 8' }));
  expect(store.getState().selectedGenomicVariant).toBeNull();
});

it('clears transient hover on navigation', async () => {
  const ui = render(<Workspace />);
  await openStructure(ui);
  store.setState({ hoveredResidueIndex: 8 });
  fireEvent.click(ui.getByRole('button', { name: 'Open Landscape' }));
  expect(store.getState().hoveredResidueIndex).toBeNull();
});

it('returns to the queried substitution and keeps keyboard focus on the page', async () => {
  const ui = render(<Workspace />);
  await openStructure(ui);
  fireEvent.click(ui.getByRole('button', { name: 'Pick structure residue 8' }));
  await waitFor(() => expect((document.activeElement as HTMLElement).dataset.workspaceFocus).toBe('structure'));
  fireEvent.click(ui.getByRole('button', { name: 'Return to variant' }));
  await waitFor(() => expect(store.getState().selectedResidueIndex).toBe(5));
  expect(store.getState().landscapeSelection).toEqual({ key, kind: 'substitution', pos: 5, alt: 'Val' });
  expect(document.activeElement).toBe(ui.getByRole('button', { name: 'Open Landscape' }));
});
