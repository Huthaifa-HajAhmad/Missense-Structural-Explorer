// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelPhenotypesCard } from '../ModelPhenotypesCard';

describe('Unresolved zebrafish summaries', () => {
  it.each([1, 27])('opens an explanation for %i unresolved summaries', total => {
    render(<ModelPhenotypesCard diseaseTerms={new Map()} diseaseName="Selected disease" onRetry={() => {}} load={{ status: 'ready', data: {
      gene: 'CNNM2', status: 'ready', mapping: 'available', provenance: [], message: null,
      species: [{ taxonId: 'NCBITaxon:7955', species: 'Zebrafish', orthologId: 'ZFIN:1', symbol: 'cnnm2a', status: 'ready', total, phenotypes: [] }],
    } }} />);
    const summary = screen.getByText(/0 displayed/).closest('summary')!;
    const disclosure = summary.parentElement!;
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(screen.getByText(/0 displayed/)).toHaveTextContent(`${total} ${total === 1 ? 'summary' : 'summaries'}`);
    expect(screen.getByText(/no resolved phenotype terms/)).toHaveTextContent(`${total} ${total === 1 ? 'summary has' : 'summaries have'}`);
    expect(screen.getByText(/No term details can be displayed/)).toBeInTheDocument();
  });
});
