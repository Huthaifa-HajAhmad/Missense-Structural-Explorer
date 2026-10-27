import { stat } from 'node:fs/promises';
import path from 'node:path';
import { loadGeneDiseaseContext } from './store.ts';
import { summariseCuratedInheritance, type CuratedInheritance } from '../../../src/shared/inheritanceBasis.ts';

/**
 * The gene's curated GenCC inheritance for the ACMG frequency rules (PM2's ceiling, BS2's genotype).
 *
 * Reads the installed snapshot only — it never starts the snapshot download that the Gene–disease
 * route may trigger, because the analysis pipeline must not wait on an install. No snapshot, an
 * unreadable one, or no qualifying record all return null, and the rule falls back to pLI as before.
 */
export async function readCuratedInheritance(gene: string | null | undefined): Promise<CuratedInheritance | null> {
  if (!gene) return null;
  const target = path.resolve(process.env.GENCC_CONTEXT_PATH ?? 'data/gencc-context.json');
  try {
    await stat(target);
  } catch {
    return null;
  }
  try {
    const context = await loadGeneDiseaseContext(gene);
    return context.status === 'ready' ? summariseCuratedInheritance(context.frames) : null;
  } catch {
    return null;
  }
}
