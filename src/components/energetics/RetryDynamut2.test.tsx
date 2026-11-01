// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useVariantAnalysisStore as store } from '../../stores/useVariantAnalysisStore';
import { RetryDynamut2 } from './RetryDynamut2';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));
vi.mock('../../api/authSession', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/authSession')>()), useAuthSession: () => ({ fetchWithAuth }) }));

const ENERGETICS = { foldx: 0.58, dynamut2Error: 'timed out', dynamut2Listening: true, structureProvenance: { source: 'alphafold', chainId: 'B' } } as any;
const RESULT = { metadata: { variant: 'p.Ser159Cys' } } as any;
const onSubmitted = vi.fn();
const view = (props: Partial<React.ComponentProps<typeof RetryDynamut2>> = {}) =>
  render(<RetryDynamut2 variant="p.Ser159Cys" uniprotId="P43694" energetics={ENERGETICS} status="unavailable" onSubmitted={onSubmitted} {...props} />);
const accepted = (body: object) => fetchWithAuth.mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const refused = (status: number, message: string) =>
  fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } }));
const click = () => fireEvent.click(screen.getByRole('button', { name: 'Retry DynaMut2' }));

describe('DynaMut2 retry', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
    onSubmitted.mockReset();
    store.setState({
      dynamut2Status: 'unavailable', dynamut2JobId: null, foldingEnergetics: ENERGETICS,
      // The repacked pair is deliberately different from the template: the retry must not submit it.
      foldxReferencePdb: 'REPACKED', pdbText: 'TEMPLATE', pdbTextProvenance: { source: 'alphafold' }, foldedResidueIndex: 42,
      analysisState: { result: RESULT, isLoading: false, error: null },
    } as any);
  });
  afterEach(cleanup);

  it('submits only DynaMut2 on the template FoldX started from, preserving FoldX', async () => {
    accepted({ dynamut2JobId: 'retry-job', dynamut2Status: 'pending' });
    view();
    click();
    await waitFor(() => expect(store.getState().dynamut2JobId).toBe('retry-job'));
    expect(JSON.parse(fetchWithAuth.mock.calls[0][1].body)).toEqual({ wtPdb: 'TEMPLATE', mutation: 'SB42C' });
    expect(store.getState().foldingEnergetics?.foldx).toBe(0.58);
    expect(store.getState().dynamut2Status).toBe('pending');
    expect(store.getState().foldingEnergetics?.dynamut2Error).toBeNull();
    expect(store.getState().foldingEnergetics?.dynamut2Listening).toBe(false);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('still submits when the run recorded no chain; the server finds it', async () => {
    accepted({ dynamut2JobId: 'retry-job', dynamut2Status: 'pending' });
    view({ energetics: { ...ENERGETICS, structureProvenance: { source: 'alphafold' } } });
    click();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    expect(JSON.parse(fetchWithAuth.mock.calls[0][1].body).mutation).toBe('S42C');
  });

  it('does not submit when the template or position is unknown', () => {
    view({ energetics: { foldx: 0.58 } as any });
    expect(screen.getByRole('button', { name: 'Retry DynaMut2' })).toBeDisabled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it('is hidden once DynaMut2 has a score or a job is running', () => {
    const { container, rerender } = view({ energetics: { ...ENERGETICS, dynamut2: 0.3 } });
    expect(container).toBeEmptyDOMElement();
    rerender(<RetryDynamut2 variant="p.Ser159Cys" uniprotId="P43694" energetics={ENERGETICS} status="pending" onSubmitted={onSubmitted} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the server\'s own reason when it refuses the retry, and keeps other results', async () => {
    refused(422, 'Wild-type residue mismatch: the mutation expects S (Ser) at position 42.');
    view();
    click();
    expect(await screen.findByRole('alert')).toHaveTextContent('Wild-type residue mismatch');
    expect(store.getState().foldingEnergetics?.foldx).toBe(0.58);
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('records an "unavailable" answer instead of pretending the job started', async () => {
    store.setState({ dynamut2Status: 'pending' } as any);
    accepted({ dynamut2JobId: null, dynamut2Status: 'unavailable' });
    view({ status: 'unavailable' });
    click();
    expect(await screen.findByRole('alert')).toHaveTextContent('did not accept the job');
    expect(store.getState().dynamut2Status).toBe('unavailable');
    expect(store.getState().dynamut2JobId).toBeNull();
  });

  it('waits before the next attempt so a busy public queue is not flooded', async () => {
    refused(503, 'DynaMut2 is busy.');
    view();
    click();
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry DynaMut2' })).toBeDisabled();
  });

  it('ignores an answer that arrives after another variant was loaded', async () => {
    let finish!: (response: Response) => void;
    fetchWithAuth.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    view();
    click();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    store.setState({ analysisState: { result: { metadata: { variant: 'p.Gly1Ala' } }, isLoading: false, error: null } } as any);
    finish(new Response(JSON.stringify({ dynamut2JobId: 'late-job', dynamut2Status: 'pending' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry DynaMut2' })).toBeInTheDocument());
    expect(store.getState().dynamut2JobId).toBeNull();
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
