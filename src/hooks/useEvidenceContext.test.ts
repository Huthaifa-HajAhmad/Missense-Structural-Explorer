// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEvidenceContext } from './useEvidenceContext';
import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));
vi.mock('../apiClient', () => ({ useApiClient: () => ({ fetchWithAuth }) }));
vi.mock('../stores/useVariantAnalysisStore', async () => {
  const { create } = await import('zustand');
  const { createEvidenceContextSlice } = await import('../stores/slices/evidenceContextSlice');
  return { useVariantAnalysisStore: create((set: any, get: any, api: any) => ({ ...createEvidenceContextSlice(set, get, api), gene: '', variant: '' })) };
});
const result = (gene: string) => ({ metadata: { gene, uniprotId: 'P1', variant: 'p.Ala1Val' } }) as any;
const data = (gene: string) => ({ gene, status: 'ready', frames: [], provenance: null, message: null });
beforeEach(() => {
  fetchWithAuth.mockReset(); sessionStorage.clear();
  useVariantAnalysisStore.setState({ diseaseContexts: {}, expressionContexts: {}, developmentalContexts: {}, phenotypeSelections: {} });
});
describe('authenticated context loading and gene isolation', () => {
  it.each([[401, 'Access denied'], [429, 'Request limit reached'], [503, 'HTTP 503']])('reports HTTP %s without blaming the evidence provider', async (status, message) => {
    fetchWithAuth.mockResolvedValue({ ok: false, status });
    const hook = renderHook(() => useEvidenceContext(result('RGS9')));
    await waitFor(() => expect(hook.result.current.diseaseLoad?.status).toBe('error'));
    expect(hook.result.current.diseaseLoad?.error).toContain(message);
  });
  it('discloses a refined transcript identity and retains the original choices without silently assigning them to another reference', async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => data('A') });
    const hook = renderHook(({ transcript }) => useEvidenceContext({ ...result('A'), transcriptId: transcript }), { initialProps: { transcript: undefined as string | undefined } });
    await waitFor(() => expect(hook.result.current.diseaseLoad?.status).toBe('ready'));
    const originalKey = hook.result.current.key;
    act(() => hook.result.current.setSelection({ ...hook.result.current.selection, systems: ['hearing'] }));
    hook.rerender({ transcript: 'ENST00000000001.2' });
    await waitFor(() => expect(hook.result.current.identityChanged).toBe(true));
    expect(hook.result.current.selection.systems).toEqual([]);
    expect(useVariantAnalysisStore.getState().phenotypeSelections[originalKey].systems).toEqual(['hearing']);
    act(() => hook.result.current.setSelection({ ...hook.result.current.selection, systems: ['hearing'] }));
    expect(hook.result.current.identityChanged).toBe(false);
  });
  it('keeps a late response for the previous gene out of the current gene frame', async () => {
    let resolveA!: (value: unknown) => void;
    fetchWithAuth.mockImplementation((url: string) => url.endsWith('/A') ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve({ ok: true, json: async () => data('B') }));
    const hook = renderHook(({ gene }) => useEvidenceContext(result(gene)), { initialProps: { gene: 'A' } });
    hook.rerender({ gene: 'B' });
    await waitFor(() => expect(hook.result.current.diseaseLoad?.data?.gene).toBe('B'));
    await act(async () => resolveA({ ok: true, json: async () => data('A') }));
    expect(hook.result.current.diseaseLoad?.data?.gene).toBe('B');
    expect(useVariantAnalysisStore.getState().diseaseContexts.A.data?.gene).toBe('A');
  });
  it('rejects a response for another gene and allows an explicit retry', async () => {
    fetchWithAuth.mockResolvedValueOnce({ ok: true, json: async () => data('OTHER') });
    const hook = renderHook(() => useEvidenceContext(result('A')));
    await waitFor(() => expect(hook.result.current.diseaseLoad?.status).toBe('error'));
    expect(hook.result.current.diseaseLoad?.data).toBeNull();
    fetchWithAuth.mockResolvedValueOnce({ ok: true, json: async () => data('A') });
    await act(async () => hook.result.current.retryDisease());
    expect(hook.result.current.diseaseLoad?.data?.gene).toBe('A');
  });
});
