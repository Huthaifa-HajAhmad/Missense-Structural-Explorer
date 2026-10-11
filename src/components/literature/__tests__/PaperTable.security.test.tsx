// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaperTable } from '../PaperTable';
import { buildLiteratureEvidence } from '../../../shared/literatureEvidence';

describe('curated provider links', () => {
  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'https://www.uniprot.org/uniprotkb/Q13564/variant/VAR_1'])('renders only HTTP(S) provider URLs as links: %s', sourceUrl => {
    const ev = buildLiteratureEvidence({ gene: 'NAE1', variant: 'p.Asp116Gly', citations: [{ id: '91000000', title: 'Illustrative source', authors: '', journal: '', year: 2026, abstract: 'NAE1 p.Asp116Gly', curatedLinks: [{ provider: 'uniprot', featureId: 'VAR_1', accession: 'Q13564', variant: 'D116G', variantDescription: null, evidenceCode: null, pmid: '91000000', source: 'PubMed', sourceUrl, retrievedAt: '2026-10-11T00:00:00Z' }] }], response: null, executedQuery: '', narrowingFilter: '', groupFilter: 'all', pinnedIds: new Set(), probe: { state: 'idle', hitCount: null }, load: 'ready', error: null });
    render(<PaperTable papers={ev.papers} gene="NAE1" forms={ev.forms} constraint={null} onTogglePin={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Illustrative source' }));
    const provider = screen.getByText('Provider record').closest('a')!;
    if (sourceUrl.startsWith('https:')) {
      expect(provider).toHaveAttribute('href', sourceUrl);
      expect(screen.getByRole('link', { name: /Cited by UniProt/ })).toHaveAttribute('href', sourceUrl);
    } else {
      expect(provider).not.toHaveAttribute('href');
      expect(provider).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByRole('link', { name: /Cited by UniProt/ })).not.toBeInTheDocument();
    }
  });
});
