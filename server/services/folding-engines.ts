import { foldSequence } from "./esmfold.ts";
import { generateMutantPdb } from "./foldx.ts";
import { CONFIG } from "../config.ts";

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
      if (sequence.length > 768) {
        throw new Error(`Protein sequence length (${sequence.length}) exceeds the maximum allowed limit of 768 residues for ESMFold.`);
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

      const tokenToUse = context.biohubToken || process.env.BIOHUB_API_TOKEN || null;
      const sidecarSecret = process.env.SIDECAR_SECRET || "";

      const response = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/esm3`, {
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
      });

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
