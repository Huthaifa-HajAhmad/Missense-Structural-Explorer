import { z } from 'zod';

const URL = 'https://www.alliancegenome.org/api/releaseInfo';
const schema = z.object({ releaseVersion: z.string().min(1), releaseDate: z.string().min(10) });
let cached: { at: number; value: string | null } | null = null;
const TTL = 6 * 60 * 60 * 1000;
/** A failed lookup is retried soon: a blip must not hide the release for hours. */
const MISS_TTL = 5 * 60 * 1000;

/**
 * The Alliance release the orthology and phenotype reads came from, e.g. "9.1.0 (2026-09-02)".
 * Best effort: the release is provenance, so a failed lookup yields null ("Release not reported")
 * and never fails the evidence read it annotates.
 */
export async function loadAllianceRelease(): Promise<string | null> {
  if (cached && Date.now() - cached.at < (cached.value ? TTL : MISS_TTL)) return cached.value;
  let value: string | null = null;
  try {
    const response = await fetch(URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (response.ok) { const j = schema.parse(await response.json()); value = `${j.releaseVersion} (${j.releaseDate.slice(0, 10)})`; }
  } catch { value = null; }
  cached = { at: Date.now(), value };
  return value;
}
export function resetAllianceReleaseCache() { cached = null; }
