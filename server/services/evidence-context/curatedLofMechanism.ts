import { stat } from "node:fs/promises";
import path from "node:path";
import { loadMechanismContext } from "./g2p.ts";
import { getCachedDosageHaploScore } from "./clingenDosage.ts";
import { summariseCuratedLofMechanism, type CuratedLofMechanism } from "../../../src/shared/lofMechanismBasis.ts";
import { normalizeGeneSymbol } from "../infra/http-client.ts";

/**
 * Curated LOF disease mechanism for PVS1, read non-blocking from installed snapshots / warm cache.
 *
 * Parallels `readCuratedInheritance`: checks the local G2P snapshot with `stat` so analysis never
 * stalls on a remote download when `g2p-context.json` is not installed yet, and checks any already-
 * loaded in-memory ClinGen dosage table (`haplo_assertion === 3`).
 */
export async function readCuratedLofMechanism(gene: string | null | undefined): Promise<CuratedLofMechanism | null> {
  if (!gene) return null;
  const normGene = normalizeGeneSymbol(gene);
  const clingenHaploScore = getCachedDosageHaploScore(normGene);

  const target = path.resolve(process.env.G2P_CONTEXT_PATH ?? "data/g2p-context.json");
  let records: Array<{ mechanism: string; confidence: string }> | null = null;
  try {
    await stat(target);
    const context = await loadMechanismContext(normGene);
    if (context.status === "ready") {
      records = context.records;
    }
  } catch {
    records = null;
  }

  return summariseCuratedLofMechanism(records, { clingenHaploScore });
}
