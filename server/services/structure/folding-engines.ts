import { foldSequence } from "./esmfold.ts";
import { generateMutantPdb } from "../stability/foldx.ts";
import { CONFIG } from "../../config.ts";
import { governedForCredential, resolveCredential } from "../infra/credentials.ts";
import {
  STABILITY_ESMFOLD_ENGINE_MAX_AA,
  stabilityEsmFoldEngineLimitMessage,
} from "../../../src/shared/foldingLimits.ts";

export interface StructureResult {
  pdb: string | null;
  status: "success" | "failed";
  energetics?: any;
  error?: string;
}

export interface FoldingContext {
  wtPdb: string;
  uniprotId: string;
  jobDir: string;
  mutationCode: string; // e.g. "R408H"
  biohubToken?: string | null;
  signal?: AbortSignal;
}

export interface FoldingEngine {
  fold(sequence: string, context: FoldingContext): Promise<StructureResult>;
}

export class ESMFoldEngine implements FoldingEngine {
  async fold(sequence: string, context: FoldingContext): Promise<StructureResult> {
    try {
      if (!sequence) {
        throw new Error("No sequence provided to ESMFoldEngine");
      }
      /**
       * Deliberately tighter than the Tier-1 de novo ceiling, and it is NOT the number the structure
       * inspector may quote: this bounds the stability pipeline's folding step, not the model a reader
       * is looking at. Conflating the two is how "768 aa" ended up in a sentence about Tier-1.
       */
      if (sequence.length > STABILITY_ESMFOLD_ENGINE_MAX_AA) {
        throw new Error(stabilityEsmFoldEngineLimitMessage(sequence.length));
      }
      const pdb = await foldSequence(sequence, context.biohubToken);
      if (!pdb) {
        throw new Error("ESMFold returned empty PDB data");
      }
      return { pdb, status: "success" };
    } catch (err: any) {
      console.warn("[ESMFoldEngine] Folding failed:", err.message);
      return { pdb: null, status: "failed", error: err.message };
    }
  }
}

export class FoldxEngine implements FoldingEngine {
  async fold(sequence: string, context: FoldingContext): Promise<StructureResult> {
    try {
      const res = await generateMutantPdb(
        context.wtPdb,
        context.mutationCode,
        context.uniprotId,
        context.jobDir,
        context.signal
      );
      if (res && res.pdb) {
        return {
          pdb: res.pdb,
          status: "success",
          energetics: res.energetics
        };
      }
      throw new Error("FoldX returned empty mutant coordinates");
    } catch (err: any) {
      console.warn("[FoldxEngine] FoldX modeling failed:", err.message);
      return { pdb: null, status: "failed", error: err.message };
    }
  }
}

export class ESM3Engine implements FoldingEngine {
  async fold(sequence: string, context: FoldingContext): Promise<StructureResult> {
    try {
      const wt1 = context.mutationCode.substring(0, 1);
      const mut1 = context.mutationCode.substring(context.mutationCode.length - 1);
      const posMatch = context.mutationCode.match(/\d+/);
      const pos = posMatch ? parseInt(posMatch[0], 10) : 1;

      const tokenToUse = resolveCredential("biohub", context.biohubToken).token;
      const sidecarSecret = process.env.SIDECAR_SECRET || "";

      const response = await governedForCredential("biohub", tokenToUse, () => fetch(`${CONFIG.services.sidecarBaseUrl}/predict/esm3`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sidecar-Secret": sidecarSecret
        },
        body: JSON.stringify({
          sequence,
          position: pos,
          wt: wt1,
          mut: mut1,
          biohubToken: tokenToUse,
          refine: true,
          wtPdb: context.wtPdb
        }),
        signal: AbortSignal.timeout(30000)
      }), { lane: "compute", deadlineAt: Date.now() + 30000 });

      if (response.ok) {
        const data = await response.json() as any;
        if (data && data.status === "success" && data.refinedPdb) {
          return { pdb: data.refinedPdb, status: "success" };
        }
      }
      throw new Error("ESM3 coordinate refinement failed");
    } catch (err: any) {
      console.warn("[ESM3Engine] Refinement failed:", err.message);
      return { pdb: null, status: "failed", error: err.message };
    }
  }
}
