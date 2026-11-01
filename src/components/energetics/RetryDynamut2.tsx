import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { extractErrorMessage, useAuthSession } from '../../api/authSession';
import { createStructureApi } from '../../api/structureApi';
import { fetchTemplate } from '../../hooks/useFoldxSuperposition';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { parseVariantResidues } from '../../shared/literatureEvidence';
import { CLIENT_REMOTE_SUBMISSION_WAIT_MS } from '../../shared/timeouts';
import type { EnergeticsData } from '../../types';

const submissionSchema = z.object({ dynamut2JobId: z.string().nullable(), dynamut2Status: z.enum(['pending', 'unavailable']) });

/** DynaMut2 is a shared public service with a queue, so a retry can only be repeated after this pause. */
const RETRY_COOLDOWN_MS = 15_000;

interface RetryDynamut2Props {
  /** The variant in HGVS protein notation, e.g. `p.Ser159Cys`. */
  variant: string | null | undefined;
  uniprotId: string | null;
  energetics: EnergeticsData | null | undefined;
  status: string | null | undefined;
  /** Called after the retry is accepted, so the view can show the engine row again. */
  onSubmitted: () => void;
}

/**
 * Retry only DynaMut2; the existing poller collects its answer and FoldX is left as it is.
 *
 * It submits the template FoldX started from, the same structure the first DynaMut2 attempt used,
 * not FoldX's repacked wild type. The server cleans it and checks the wild-type residue the same
 * way the analysis route does.
 */
export function RetryDynamut2({ variant, uniprotId, energetics, status, onSubmitted }: RetryDynamut2Props) {
  const { fetchWithAuth } = useAuthSession();
  const [submitting, setSubmitting] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const position = useVariantAnalysisStore(s => s.foldedResidueIndex);
  const abortRef = useRef<AbortController | null>(null);
  const provenance = energetics?.structureProvenance ?? null;
  const mutation = parseVariantResidues(variant);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setCooling(false), RETRY_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooling]);

  if (energetics?.dynamut2 != null || status === 'pending') return null;
  const ready = Boolean(mutation && position && provenance?.source);

  const submit = async (signal: AbortSignal, identity: unknown) => {
    if (!mutation || !position || !provenance) return;
    const stored = useVariantAnalysisStore.getState();
    const template = await fetchTemplate({
      apiClient: createStructureApi(fetchWithAuth),
      template: provenance,
      uniprotId,
      position,
      pdbText: stored.pdbText,
      pdbTextProvenance: stored.pdbTextProvenance,
      signal,
    });
    if ('reason' in template) throw new Error(template.reason);
    // The chain is optional: the server finds it from the structure when the run did not record one.
    const response = await fetchWithAuth('/api/v1/dynamut2-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: CLIENT_REMOTE_SUBMISSION_WAIT_MS, signal,
      body: JSON.stringify({ wtPdb: template.pdb, mutation: `${mutation.wildType}${provenance.chainId ?? ''}${position}${mutation.alternate}` }),
    });
    if (!response.ok) throw new Error(await extractErrorMessage(response, 'DynaMut2 could not accept the retry'));
    const parsed = submissionSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('DynaMut2 answered in a form this page does not recognise.');
    const store = useVariantAnalysisStore.getState();
    if (store.analysisState.result !== identity) return;
    store.setDynamut2Status(parsed.data.dynamut2Status);
    if (!parsed.data.dynamut2JobId) throw new Error('DynaMut2 did not accept the job. Please try again later.');
    store.setDynamut2JobId(parsed.data.dynamut2JobId);
    store.setFoldingEnergetics((previous: EnergeticsData | null) => previous ? { ...previous, dynamut2Error: null, dynamut2Listening: false } : previous);
    onSubmitted();
  };

  const retry = () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);
    submit(controller.signal, useVariantAnalysisStore.getState().analysisState.result)
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'DynaMut2 could not start. Please try again later.'); })
      .finally(() => {
        if (controller.signal.aborted) return;
        setSubmitting(false);
        setCooling(true);
      });
  };

  return <div className="nrg-retry">
    <button type="button" className="nrg-retry__button" disabled={!ready || submitting || cooling} onClick={retry}>
      {submitting ? 'Submitting DynaMut2…' : 'Retry DynaMut2'}
    </button>
    {!ready && <p className="nrg-retry__note">Retry needs the structure FoldX used and the mapped residue position.</p>}
    {error && <p className="nrg-retry__note" role="alert">{error}</p>}
  </div>;
}
