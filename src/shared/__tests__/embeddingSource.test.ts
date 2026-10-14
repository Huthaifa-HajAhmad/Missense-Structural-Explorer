import { describe, expect, it } from 'vitest';
import { embeddingSource } from '../embeddingSource';

describe('served embedding identity', () => {
  it.each([
    [' VESM-150M fallback ', 'VESM-150M fallback', true, 'VESM embedding drift', 'vesm_embedding'],
    ['ESM3-open', 'ESM3-open', false, 'ESM3 embedding drift', 'esm3'],
    ['ESM3 via VESM fallback', 'ESM3 via VESM fallback', true, 'VESM embedding drift', 'vesm_embedding'],
    ['unidentified model', 'unidentified model', false, 'Sequence embedding drift', 'embedding_shift'],
    ['', null, false, 'Sequence embedding drift', 'embedding_shift'],
    [undefined, null, false, 'Sequence embedding drift', 'embedding_shift'],
    [42, null, false, 'Sequence embedding drift', 'embedding_shift'],
  ])('uses provenance %s without assuming the requested model ran', (input, recorded, fallback, label, topic) => {
    expect(embeddingSource(input)).toEqual({ recorded, fallback, label, topic });
  });
});
