// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PerturbationRail } from '../PerturbationRail';
import { EvidenceWorkspaceProvider, useEvidenceWorkspace } from '../../evidence/EvidenceWorkspace';
import { NAE1_ENERGETICS, NAE1_RESULT } from '../../../shared/__tests__/fixtures/nae1Perturbation';

/** Opens one view and pins one reading, as a reader does before switching views. Runs once on mount. */
function PinReading({ view, readingKey }: { view: 'records' | 'embeddings'; readingKey: string }) {
  const { setView, select } = useEvidenceWorkspace('perturbation');
  useEffect(() => { setView(view); select(readingKey); }, []);
  return null;
}

function renderPinned(view: 'records' | 'embeddings', readingKey: string) {
  return render(
    <EvidenceWorkspaceProvider result={NAE1_RESULT}>
      <PinReading view={view} readingKey={readingKey} />
      <PerturbationRail analysisResult={NAE1_RESULT} foldingEnergetics={NAE1_ENERGETICS} saprotEngine="remote-hf" />
    </EvidenceWorkspaceProvider>
  );
}

describe('PerturbationRail pinned reading', () => {
  it('says a pinned packing reading came from Packing & geometry', async () => {
    renderPinned('records', 'phys:vdw');
    expect(await screen.findByText(/^Pinned from Packing & geometry: .+\. It stays visible when you switch views\.$/)).toBeInTheDocument();
  });

  it('says a pinned embedding came from Sequence embeddings', async () => {
    renderPinned('embeddings', 'esm3');
    expect(await screen.findByText(/^Pinned from Sequence embeddings: .+\. It stays visible when you switch views\.$/)).toBeInTheDocument();
  });

  it('says a pinned model reading came from Model comparison', async () => {
    renderPinned('records', 'esm2');
    expect(await screen.findByText(/^Pinned from Model comparison: .+\. It stays visible/)).toBeInTheDocument();
  });

  it('keeps the generic sentence when the pinned key matches no row', async () => {
    renderPinned('records', 'no-such-row');
    expect(await screen.findByText('The pinned reading above is retained when you switch views.')).toBeInTheDocument();
  });

  it('states the scoring method of the selected model', () => {
    render(<PerturbationRail analysisResult={NAE1_RESULT} foldingEnergetics={NAE1_ENERGETICS} saprotEngine="remote-hf" />);
    expect(screen.getByText('Scoring method').closest('.ptb-kv__row')).toHaveTextContent('Not recorded by this engine');
  });
});
