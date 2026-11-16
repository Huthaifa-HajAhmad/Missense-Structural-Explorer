import { useVariantAnalysisStore } from '../stores/useVariantAnalysisStore';
import { hotspotContextSchema } from '../shared/hotspotEvidence';
import { hotspotSearch, hotspotsSlot } from '../shared/evidenceKeys';
import { ContextHttpError, contextRequestFailure } from '../shared/contextRequest';

export type FetchWithAuth = (url: string, options?: { timeout?: number; signal?: AbortSignal }) => Promise<Response>;

/**
 * The one hot-spot read. The prefetch, the evidence hook's own retry and the view's Try-again button all call
 * it, so a button cannot drift from the load it repairs (the slot key, the endpoint, the identity check and the
 * failure words are written once). It lives outside the hook because the button sits in a leaf component that
 * must not mount the hook's other readers.
 *
 * The server answers model-free rungs when there is no UniProt, so a result without one is still read.
 */
export async function readHotspots(
  fetchWithAuth: FetchWithAuth,
  gene: string | null | undefined,
  uniprot: string | null | undefined,
  transcript: string | null | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (!gene || signal?.aborted) return;
  const slot = hotspotsSlot(gene, uniprot, transcript);
  const actions = useVariantAnalysisStore.getState();
  if (actions.extraContexts[slot]?.status === 'loading') return;
  actions.setExtraContext(slot, { status: 'loading', data: null });
  try {
    const options = signal ? { timeout: 120000, signal } : { timeout: 120000 };
    const response = await fetchWithAuth(`/api/v1/evidence-context/${encodeURIComponent(gene)}/hotspots${hotspotSearch(uniprot, transcript)}`, options);
    if (signal?.aborted) {
      await response.body?.cancel();
      return;
    }
    if (!response.ok) { await response.body?.cancel(); throw new ContextHttpError(response.status); }
    const data = hotspotContextSchema.parse(await response.json());
    if (signal?.aborted) return;
    if (data.gene !== gene) throw new Error('Context identity mismatch');
    actions.setExtraContext(slot, { status: data.status === 'error' ? 'error' : 'ready', data });
  } catch (error: any) {
    if (signal?.aborted || error?.name === 'AbortError') {
      useVariantAnalysisStore.setState((s) => {
        if (s.extraContexts[slot]?.status !== 'loading') return s;
        const { [slot]: _dropped, ...rest } = s.extraContexts;
        return { extraContexts: rest };
      });
      return;
    }
    actions.setExtraContext(slot, { status: 'error', data: null, error: contextRequestFailure(error) });
  }
}
