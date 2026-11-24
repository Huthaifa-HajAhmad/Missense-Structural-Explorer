import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { extractErrorMessage, useAuthSession } from '../../api/authSession';
import { createStructureApi } from '../../api/structureApi';
import { fetchTemplate } from '../../hooks/useFoldxSuperposition';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { parseVariantResidues } from '../../shared/literatureEvidence';
import { CLIENT_THERMOMPNN_RETRY_WAIT_MS } from '../../shared/timeouts';
import type { EnergeticsData } from '../../types';

/**
 * The submit route answers synchronously from the local sidecar: either a predicted ΔΔG or a refusal
 * with its reason.
 */
const responseSchema = z.object({
  thermompnnStatus: z.enum(['pending', 'done', 'unavailable', 'error', 'busy']).nullable().optional(),
  prediction: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** The model server runs one CPU pass at a time, so a retry cannot be repeated faster than this. */
const RETRY_COOLDOWN_MS = 15_000;

interface RetryThermompnnProps {
  /** The variant in HGVS protein notation, e.g. `p.Gly380Arg`. */
  variant: string | null | undefined;
  uniprotId: string | null;
  energetics: EnergeticsData | null | undefined;
  status: string | null | undefined;
  /** FoldX is still running, so every CPU request this sends would only queue behind it. */
  folding: boolean;
  /** Called after the engine returns a value so the view can refresh the row. */
  onSubmitted: () => void;
}

/**
 * Retry only ThermoMPNN.
 *
 * WHY THIS EXISTS: ThermoMPNN shares one CPU sidecar with StabilityOracle, and a pass
 * that has started cannot be pre-empted. When the other engines of the same analysis hold the queue,
 * ThermoMPNN's own budget expires and the run ends with every other engine succeeded and this one
 * reported as busy. Re-running the whole analysis repeats FoldX to recover one ~1 s prediction; this
 * submits the template FoldX started from (not the repacked wild type) to `/api/v1/thermompnn-submit`
 * and writes the answer into the same run synchronously.
 */
export function RetryThermompnn({ variant, uniprotId, energetics, status, folding, onSubmitted }: RetryThermompnnProps) {
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

  // The offer only appears for a terminal failure or busy refusal. Before a run there is nothing to
  // retry, and while one is in flight the engine owns its own answer.
  if (energetics?.thermompnn != null || (status !== 'error' && status !== 'busy' && status !== 'unavailable')) return null;
  const ready = Boolean(mutation && position && provenance?.source) && !folding;

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
    const response = await fetchWithAuth('/api/v1/thermompnn-submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: CLIENT_THERMOMPNN_RETRY_WAIT_MS, signal,
      body: JSON.stringify({ wtPdb: template.pdb, mutation: `${mutation.wildType}${provenance.chainId ?? ''}${position}${mutation.alternate}` }),
    });
    if (!response.ok) throw new Error(await extractErrorMessage(response, 'ThermoMPNN could not accept the retry'));
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('ThermoMPNN answered in a form this page does not recognise.');
    const store = useVariantAnalysisStore.getState();
    if (store.analysisState.result !== identity) return;

    const { thermompnnStatus, prediction } = parsed.data;
    if (typeof prediction === 'number') {
      // Synchronous answer: this IS the result, so settle the engine immediately.
      store.setFoldingEnergetics((previous: EnergeticsData | null) => previous ? { ...previous, thermompnn: prediction } : previous);
      store.setThermompnnError(null);
      store.setThermompnnStatus('done');
      onSubmitted();
      return;
    }
    // A refusal. Record the server's own words and the state they belong to, then show them here too:
    // the engine row alone would hide why the retry did not help.
    const reason = parsed.data.error ?? 'ThermoMPNN did not accept the retry.';
    store.setThermompnnStatus(thermompnnStatus === 'unavailable' ? 'unavailable' : thermompnnStatus === 'busy' ? 'busy' : 'error');
    store.setThermompnnError(reason);
    throw new Error(reason);
  };

  const retry = () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);
    submit(controller.signal, useVariantAnalysisStore.getState().analysisState.result)
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'ThermoMPNN could not start. Please try again later.'); })
      .finally(() => {
        if (controller.signal.aborted) return;
        setSubmitting(false);
        setCooling(true);
      });
  };

  return <div className="nrg-retry">
    <button type="button" className="nrg-retry__button" disabled={!ready || submitting || cooling} onClick={retry}>
      {submitting ? 'Running ThermoMPNN…' : 'Retry ThermoMPNN'}
    </button>
    {folding
      ? <p className="nrg-retry__note">ThermoMPNN shares one CPU queue with the rest of the run. Retry once FoldX has finished.</p>
      : !ready && <p className="nrg-retry__note">Retry needs the structure FoldX used and the mapped residue position.</p>}
    {error && <p className="nrg-retry__note" role="alert">{error}</p>}
  </div>;
}
