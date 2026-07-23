import { foldSequence } from "./esmfold.ts";
import { generateMutantPdb } from "./foldx.ts";

export interface StructureResult {
  pdb: string;
  status: "success" | "failed";
  energetics?: any;
}

export interface FoldingContext {
  wtPdb: string;
  uniprotId: string;
  jobDir: string;
  mutationCode: string; // e.g. "R408H"
  biohubToken?: string | null;
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
      const pdb = await foldSequence(sequence, context.biohubToken);
      if (!pdb) {
        throw new Error("ESMFold returned empty PDB data");
      }
      return { pdb, status: "success" };
    } catch (err: any) {
      console.warn("[ESMFoldEngine] Folding failed, falling back to wildtype backbone:", err.message);
      return { pdb: context.wtPdb, status: "failed" };
    }
  }
}

export class AlphaFoldEngine implements FoldingEngine {
  async fold(sequence: string, context: FoldingContext): Promise<StructureResult> {
    try {
      const res = await generateMutantPdb(
        context.wtPdb,
        context.mutationCode,
        context.uniprotId,
        context.jobDir
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
      console.warn("[AlphaFoldEngine] FoldX modeling failed, falling back to wildtype backbone:", err.message);
      return { pdb: context.wtPdb, status: "failed" };
    }
  }
}
