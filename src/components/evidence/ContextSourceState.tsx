import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
export function ContextSourceState({ name, load, onRetry }: { name: string; load?: { status: string; error?: string; data: { status: string; message?: string | null } | null }; onRetry: () => void }) {
  const state = !load || load.status === 'loading' ? 'running' : load.status === 'error' || load.data?.status === 'error' ? 'upstream-error' : load.data?.status === 'not-installed' ? 'not-installed' : 'no-result';
  return <div className="cx-notice" role="status"><strong>{name} · {ENGINE_STATE_LABELS[state]}</strong><p>{load?.error ?? load?.data?.message ?? (state === 'running' ? 'Reading this source.' : 'No returned reading. This does not establish biological absence.')}</p>
    {state !== 'running' && <button type="button" className="viz-action" onClick={onRetry}>Try again</button>}</div>;
}
