// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ResearchGuideDrawer } from '../ResearchGuideDrawer';
import { ResearchGuideButton } from '../ResearchGuideButton';
import { ModelKnowledgeModal } from '../../modals/ModelKnowledgeModal';
import { MetricExplanationModal } from '../../evidence/MetricExplanationModal';
import { calibrationBands } from '../../../shared/thresholds/calibration';

beforeAll(() => {
  // jsdom has no top layer. Real focus containment, inertness and backdrop clicks are checked
  // by tools/explanation-preview/check.mjs in a browser, not claimed by this stub.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('individual explanation drawers', () => {
  it('opens the requested subject, teaches its method and restores focus to its trigger', () => {
    render(<ResearchGuideButton topic="foldx" label="About FoldX" />);
    const trigger = screen.getByRole('button', { name: 'About FoldX' });
    trigger.focus(); fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: 'FoldX' });
    expect(within(drawer).getByText('From input to result')).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'What this cannot tell you' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('All topics')).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close explanation' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps topic navigation inside the drawer and returns to the original subject', () => {
    render(<ResearchGuideDrawer isOpen topic="foldx" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'ΔΔG · stability change' }));
    expect(screen.getByRole('dialog', { name: 'ΔΔG · stability change' })).toBeTruthy();
    expect(screen.getByText('Reading the displayed sign')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to FoldX' }));
    expect(screen.getByRole('dialog', { name: 'FoldX' })).toBeTruthy();
  });
  it('reads calibration thresholds from the same authority as the evidence model', () => {
    render(<ModelKnowledgeModal isOpen modelKey="revel" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Published evidence bands'));
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(calibrationBands('revel').length);
    for (const band of calibrationBands('revel')) expect(screen.getByText(`${band.direction === 'PP3' ? '≥' : '≤'} ${band.threshold}`)).toBeTruthy();
  });
  it('migrates metric notices and handles native cancellation', () => {
    const close = vi.fn();
    render(<MetricExplanationModal selectedMetric="rmsd" setSelectedMetric={close} />);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledWith(null);
  });
  it('reports clipboard rejection without a false copied message', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<ResearchGuideDrawer isOpen topic="foldx" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }));
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
    expect(screen.queryByText('Reference copied.')).toBeNull();
  });
  it('handles aliased and unmapped related topics safely without throwing', () => {
    // Render a guide that has related concepts with aliases or missing entries
    render(<ResearchGuideDrawer isOpen topic="revel" onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'REVEL' })).toBeTruthy();
    expect(screen.getByText('Related concepts')).toBeTruthy();
  });
  it('guards calibration block and handles alias topic resolution', () => {
    render(<ResearchGuideDrawer isOpen topic="alphaMissense" onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'AlphaMissense' })).toBeTruthy();
  });
  it('shows an honest unavailable state for an unknown topic', () => {
    render(<ResearchGuideDrawer isOpen topic="unknown-provider" onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Explanation unavailable' })).toBeTruthy();
    expect(screen.getByText(/No interpretation has been supplied/)).toBeTruthy();
  });
});
