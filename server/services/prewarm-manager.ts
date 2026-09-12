import crypto from "crypto";
import path from "path";
import { fetchPdbFromRcsb } from "./external.ts";
import { AMINO_ACID_3_TO_1 } from "../../src/shared/aminoAcids.ts";
import { BiophysicalJobQueue } from "./biophysical-queue.ts";
import { activeBackgroundTasks, inFlightPrewarms } from "../routes/state.ts";

export interface PrewarmParams {
  gene: string;
  variant: string;
  uniprotId: string;
  sequence?: string;
  pos: number;
  wt1Letter: string;
  mutant: string;
  pdbMapping: { pdbId?: string; chainId?: string; unpStart?: number; structStart?: number } | null;
}

export class PrewarmManager {
  private static instance: PrewarmManager;

  private constructor() {}

  public static getInstance(): PrewarmManager {
    if (!PrewarmManager.instance) {
      PrewarmManager.instance = new PrewarmManager();
    }
    return PrewarmManager.instance;
  }

  /**
   * Dispatches non-blocking FoldX mutant simulation in the background if not already in flight.
   */
  public async triggerPrewarm(params: PrewarmParams): Promise<void> {
    if (process.env.NODE_ENV === "test") return;

    const { gene, variant, uniprotId, sequence, pos, wt1Letter, mutant, pdbMapping } = params;
    const prewarmKey = `${gene}_${variant}`.toUpperCase();

    if (await inFlightPrewarms.has(prewarmKey)) {
      return;
    }

    await inFlightPrewarms.add(prewarmKey);
    const prewarmTaskId = crypto.randomUUID();
    const prewarmController = new AbortController();

    const prewarmPromise = (async () => {
      let createdJobDir = "";
      try {
        if (pdbMapping && pdbMapping.pdbId) {
          const wtPdbText = await fetchPdbFromRcsb(
            pdbMapping.pdbId,
            pdbMapping.chainId,
            pdbMapping.unpStart,
            pdbMapping.structStart,
            { uniprotId, sequence, pos, expectedWt1: wt1Letter }
          );
          if (wtPdbText) {
            const wt1 = wt1Letter.toUpperCase();
            const chain = (pdbMapping.chainId || "A").toUpperCase();
            const mut1 = AMINO_ACID_3_TO_1[mutant] || (mutant.length === 1 ? mutant.toUpperCase() : mutant[0].toUpperCase());

            const mutation = `${wt1}${chain}${pos}${mut1}`;
            const prewarmJobId = crypto.randomUUID();
            const prewarmJobDir = path.join(process.cwd(), "temp_jobs", prewarmJobId);
            createdJobDir = prewarmJobDir;

            const queue = BiophysicalJobQueue.getInstance();
            console.log(`[Pre-warm Cache] Queueing FoldX mutant simulation in background for ${gene} ${variant}`);
            const queueJobId = await queue.pushJob("foldx", {
              wtPdb: wtPdbText,
              mutation,
              uniprotId,
              jobDir: prewarmJobDir
            });

            const prewarmStart = Date.now();
            while (true) {
              if (prewarmController.signal.aborted) {
                await queue.abortJob(queueJobId);
                throw new Error("Aborted");
              }
              if (Date.now() - prewarmStart > 240000) {
                await queue.abortJob(queueJobId);
                throw new Error("Pre-warm FoldX job timed out");
              }
              const statusInfo = await queue.getJobStatus(queueJobId);
              if (statusInfo) {
                if (statusInfo.status === "completed") break;
                if (statusInfo.status === "failed") throw new Error(statusInfo.error || "Prewarm FoldX job failed");
              }
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
      } catch (prewarmErr: any) {
        console.warn(`[Pre-warm Cache Warning] Background FoldX pre-warm failed:`, prewarmErr.message);
      } finally {
        await inFlightPrewarms.delete(prewarmKey);
        const idx = activeBackgroundTasks.findIndex(t => t.id === prewarmTaskId);
        if (idx !== -1) activeBackgroundTasks.splice(idx, 1);
      }
    })();

    activeBackgroundTasks.push({ id: prewarmTaskId, controller: prewarmController, promise: prewarmPromise });
  }
}
