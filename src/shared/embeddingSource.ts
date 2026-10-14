/** The requested service slot is not evidence of which model actually ran. */
export function embeddingSource(provenance: unknown) {
  const recorded = typeof provenance === 'string' && provenance.trim() ? provenance.trim() : null;
  const fallback = Boolean(recorded && /vesm/i.test(recorded));
  const model = fallback ? 'VESM' : recorded && /esm3/i.test(recorded) ? 'ESM3' : null;
  return {
    recorded,
    fallback,
    label: model ? `${model} embedding drift` : 'Sequence embedding drift',
    topic: fallback ? 'vesm_embedding' : model === 'ESM3' ? 'esm3' : 'embedding_shift',
  };
}
