// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelOrganismsCard } from '../ModelOrganismsCard';
import type { ContextLoad } from '../../../stores/slices/evidenceContextSlice';
import type { ModelOrganismResponse } from '../../../shared/modelOrganisms';

const ready = (data: ModelOrganismResponse): ContextLoad<ModelOrganismResponse> => ({ status: 'ready', data });

const response: ModelOrganismResponse = {
  gene: 'SOD1', status: 'ready', hgncId: 'HGNC:11179',
  orthologs: [
    { id: 'ENSMUSG1', symbol: 'Sod1', taxonId: 'NCBITaxon:10090', species: 'mouse', bestForward: true, bestReverse: true, confidence: 'Reviewed', methodCount: 12 },
    // A provider that left the match direction unreported must not read as "not a best match".
    { id: 'ENSEBLR2', symbol: 'Sod1b', taxonId: 'NCBITaxon:7955', species: 'zebrafish', bestForward: null, bestReverse: null, confidence: null, methodCount: 3 },
  ],
  impc: { status: 'ready', screens: [{
    mgiId: 'MGI:1338824', symbol: 'Sod1', phenotypeStatus: 'Phenotyping complete', phenotypingDataAvailable: true,
    embryoDataAvailable: false, significant: ['nervous system phenotype'], notSignificant: [],
  }] },
  provenance: [], message: null,
};

describe('ModelOrganismsCard null-coverage safeguards', () => {
  it('labels an unreported match direction instead of a weaker match', () => {
    render(<ModelOrganismsCard load={ready(response)} systems={['nervous']} onRetry={() => {}} />);
    expect(screen.getByText('Match direction not fully reported')).toBeInTheDocument();
  });

  it('keeps the mouse screen reading anchored, never as a normal mouse', () => {
    render(<ModelOrganismsCard load={ready(response)} systems={['nervous']} onRetry={() => {}} />);
    expect(screen.getAllByText('Significant difference').length).toBeGreaterThan(0);
    expect(screen.getByText(/not that the mouse is normal/)).toBeInTheDocument();
  });

  it('says phenotype availability is unreported where the record is silent', () => {
    const unreported: ModelOrganismResponse = { ...response,
      impc: { status: 'ready', screens: [{ ...response.impc!.screens[0], phenotypeStatus: null, phenotypingDataAvailable: null }] } };
    render(<ModelOrganismsCard load={ready(unreported)} systems={['nervous']} onRetry={() => {}} />);
    expect(screen.getByText(/not reported for/)).toBeInTheDocument();
    expect(screen.getByText(/not a confirmed untested or normal result/)).toBeInTheDocument();
  });

  it('keeps un-phenotyped genes distinct from both normal and untested', () => {
    const unphenotyped: ModelOrganismResponse = { ...response,
      impc: { status: 'ready', screens: [{ ...response.impc!.screens[0], phenotypingDataAvailable: false, embryoDataAvailable: false }] } };
    render(<ModelOrganismsCard load={ready(unphenotyped)} systems={['nervous']} onRetry={() => {}} />);
    expect(screen.getByText(/has not phenotyped/)).toBeInTheDocument();
    expect(screen.getByText(/Absence of data is not a normal result/)).toBeInTheDocument();
  });

  it('marks the IMPC screen not applicable when no mouse ortholog exists', () => {
    const noMouse: ModelOrganismResponse = { ...response, orthologs: [response.orthologs[1]], impc: null };
    render(<ModelOrganismsCard load={ready(noMouse)} systems={['nervous']} onRetry={() => {}} />);
    expect(screen.getByText(/No mouse ortholog, so no IMPC screen to read/)).toBeInTheDocument();
  });
});
