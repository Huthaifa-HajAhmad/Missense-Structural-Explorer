// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EvidenceDashboardCard from '../../EvidenceDashboardCard';
import { SettingsProvider } from '../../../context/SettingsContext';
import { EvidenceWorkspaceProvider } from '../../evidence/EvidenceWorkspace';
import { EVIDENCE_SUB_ITEMS } from '../../MasterSidebar';
import { EVIDENCE_GUIDES, resolveResearchGuide } from '../../../shared/researchGuides';
import { mechanismWorkspaceFixture } from '../../../test/mechanismWorkspaceFixture';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('rendered contextual coverage', () => {
  it('renders population guidance safely for an unknown saved tab id', () => {
    const result = mechanismWorkspaceFixture('SOD1');
    render(<SettingsProvider><EvidenceWorkspaceProvider result={result}>
      <EvidenceDashboardCard {...({ analysisState: { result, isLoading: false, error: null }, activeTab: 'unknown-saved-tab' } as any)} />
    </EvidenceWorkspaceProvider></SettingsProvider>);
    const title = resolveResearchGuide(EVIDENCE_GUIDES.clinical)!.title;
    fireEvent.click(screen.getByRole('button', { name: `About ${title}` }));
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
  });
  it.each(EVIDENCE_SUB_ITEMS)('$label exposes and opens its own explanation in the real dashboard', ({ id }) => {
    const result = mechanismWorkspaceFixture('SOD1');
    const title = resolveResearchGuide(EVIDENCE_GUIDES[id])!.title;
    render(<SettingsProvider><EvidenceWorkspaceProvider result={result}>
      <EvidenceDashboardCard {...({ analysisState: { result, isLoading: false, error: null }, activeTab: id } as any)} />
    </EvidenceWorkspaceProvider></SettingsProvider>);
    const trigger = screen.getByRole('button', { name: `About ${title}` });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(within(dialog).getByRole('heading', { name: 'What this cannot tell you' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return to workspace' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens every visible contextual and legacy predictor control from source records', () => {
    const result = mechanismWorkspaceFixture('SOD1');
    const view = render(<SettingsProvider><EvidenceWorkspaceProvider result={result}>
      <EvidenceDashboardCard {...({ analysisState: { result, isLoading: false, error: null }, activeTab: 'predictors' } as any)} />
    </EvidenceWorkspaceProvider></SettingsProvider>);
    fireEvent.click(screen.getByRole('tab', { name: 'Source records' }));
    for (const toggle of view.container.querySelectorAll('.prd-group__toggle[aria-expanded="false"]')) fireEvent.click(toggle);
    const triggers = within(view.container).getAllByRole('button').filter(button => /^About /.test(button.getAttribute('aria-label') ?? button.textContent ?? ''));
    expect(triggers.length).toBeGreaterThan(10);
    for (const trigger of triggers) {
      fireEvent.click(trigger);
      expect(screen.getByRole('dialog').textContent).not.toContain('Explanation unavailable');
      fireEvent.click(screen.getByRole('button', { name: 'Close explanation' }));
    }
  });
});
