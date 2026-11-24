// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useVariantAnalysisStore as store } from '../../stores/useVariantAnalysisStore';
import { RetryThermompnn } from './RetryThermompnn';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));
vi.mock('../../api/authSession', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/authSession')>()), useAuthSession: () => ({ fetchWithAuth }) }));

const ENERGETICS = { foldx: 1.44, structureProvenance: { source: 'alphafold', chainId: 'A' } } as any;
const RESULT = { metadata: { variant: 'p.Gly380Arg' } } as any;
const BUSY = 'ThermoMPNN did not answer within 150 s: the model service was busy with earlier work.';
const onSubmitted = vi.fn();
const view = (props: Partial<React.ComponentProps<typeof RetryThermompnn>> = {}) =>
  render(<RetryThermompnn variant="p.Gly380Arg" uniprotId="P22607" energetics={ENERGETICS} status="error" folding={false} onSubmitted={onSubmitted} {...props} />);
const accepted = (body: object) => fetchWithAuth.mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const refused = (status: number, message: string) =>
  fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } }));
const click = () => fireEvent.click(screen.getByRole('button', { name: 'Retry ThermoMPNN' }));

describe('ThermoMPNN retry', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
    onSubmitted.mockReset();
    store.setState({
      thermompnnStatus: 'error', thermompnnError: BUSY, foldingEnergetics: ENERGETICS,
      // The repacked pair is deliberately different from the template: the retry must not submit it.
      foldxReferencePdb: 'REPACKED', pdbText: 'TEMPLATE', pdbTextProvenance: { source: 'alphafold' }, foldedResidueIndex: 380,
      analysisState: { result: RESULT, isLoading: false, error: null },
    } as any);
  });
  afterEach(cleanup);

  it('writes the synchronous local prediction into the run and preserves FoldX', async () => {
    accepted({ thermompnnStatus: 'done', prediction: 0.87, error: null });
    view();
    click();
    await waitFor(() => expect(store.getState().foldingEnergetics?.thermompnn).toBe(0.87));
    expect(JSON.parse(fetchWithAuth.mock.calls[0][1].body)).toEqual({ wtPdb: 'TEMPLATE', mutation: 'GA380R' });
    expect(store.getState().foldingEnergetics?.foldx).toBe(1.44);
    expect(store.getState().thermompnnStatus).toBe('done');
    expect(store.getState().thermompnnError).toBeNull();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('still submits when the run recorded no chain; the server finds it', async () => {
    accepted({ thermompnnStatus: 'done', prediction: 0.87 });
    view({ energetics: { ...ENERGETICS, structureProvenance: { source: 'alphafold' } } });
    click();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    expect(JSON.parse(fetchWithAuth.mock.calls[0][1].body).mutation).toBe('G380R');
  });

  it('does not submit when the template or position is unknown', () => {
    view({ energetics: { foldx: 1.44 } as any });
    expect(screen.getByRole('button', { name: 'Retry ThermoMPNN' })).toBeDisabled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it('is hidden once ThermoMPNN has a score or a job is running', () => {
    const { container, rerender } = view({ energetics: { ...ENERGETICS, thermompnn: 0.6 } });
    expect(container).toBeEmptyDOMElement();
    rerender(<RetryThermompnn variant="p.Gly380Arg" uniprotId="P22607" energetics={ENERGETICS} status="pending" folding={false} onSubmitted={onSubmitted} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden before a run has reported, because there is nothing to retry yet', () => {
    const { container } = view({ status: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('waits for FoldX to finish instead of queueing behind it', () => {
    view({ folding: true });
    expect(screen.getByRole('button', { name: 'Retry ThermoMPNN' })).toBeDisabled();
    expect(screen.getByText(/Retry once FoldX has finished/)).toBeInTheDocument();
  });

  it('keeps the engine retryable and shows the server reason when the sidecar is still busy', async () => {
    accepted({ thermompnnStatus: 'busy', prediction: null, error: 'ThermoMPNN did not start: the model server was still busy with earlier work' });
    view({ status: 'busy' });
    click();
    expect(await screen.findByRole('alert')).toHaveTextContent('still busy with earlier work');
    expect(store.getState().thermompnnStatus).toBe('busy');
    expect(store.getState().thermompnnError).toContain('still busy');
    expect(store.getState().foldingEnergetics?.foldx).toBe(1.44);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal when it rejects the retry', async () => {
    refused(422, 'Wild-type residue mismatch: the mutation expects G (Gly) at position 380.');
    view();
    click();
    expect(await screen.findByRole('alert')).toHaveTextContent('Wild-type residue mismatch');
    expect(store.getState().foldingEnergetics?.foldx).toBe(1.44);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('waits before the next attempt so a busy CPU sidecar is not flooded', async () => {
    refused(503, 'ThermoMPNN is busy.');
    view();
    click();
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry ThermoMPNN' })).toBeDisabled();
  });

  it('ignores an answer that arrives after another variant was loaded', async () => {
    let finish!: (response: Response) => void;
    fetchWithAuth.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    view();
    click();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    store.setState({ analysisState: { result: { metadata: { variant: 'p.Gly1Ala' } }, isLoading: false, error: null } } as any);
    finish(new Response(JSON.stringify({ thermompnnStatus: 'done', prediction: 0.55 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry ThermoMPNN' })).toBeInTheDocument());
    expect(store.getState().foldingEnergetics?.thermompnn).toBeUndefined();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('cancels the request when the view is left', async () => {
    fetchWithAuth.mockReturnValue(new Promise<Response>(() => {}));
    const { unmount } = view();
    click();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    const signal: AbortSignal = fetchWithAuth.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
