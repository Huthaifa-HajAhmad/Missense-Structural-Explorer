import { Mutation, applyMutation } from "../utils/mutation.ts";
import { FoldingEngine, FoldingContext, StructureResult } from "./folding-engines.ts";
import { submitThermoMpnnJob } from "./energy-models.ts";

export interface StabilityVerificationResult {
  ddG: number | null;
  thermompnnJobId: string | null;
  thermompnnStatus: "pending" | "done" | "unavailable" | "error";
  thermompnnError?: string;
  structure: StructureResult;
}

export async function verifyStability(
  wtSeq: string,
  mutation: Mutation,
  foldingEngine: FoldingEngine,
  context: FoldingContext,
  tamarindApiKey?: string
): Promise<StabilityVerificationResult> {
  const mutSequence = applyMutation(wtSeq, mutation);

  // 1. Submit/Run ThermoMPNN stability prediction (uses wtPdb backbone)
  let ddG: number | null = null;
  let thermompnnJobId: string | null = null;
  let thermompnnStatus: "pending" | "done" | "unavailable" | "error" = "unavailable";
  let thermompnnError: string | undefined = undefined;

  try {
    const thermoRes = await submitThermoMpnnJob(context.wtPdb, context.mutationCode, tamarindApiKey);
    if (thermoRes.status === "done" && thermoRes.prediction !== null) {
      ddG = thermoRes.prediction;
      thermompnnStatus = "done";
    } else if (thermoRes.status === "pending" && thermoRes.jobId) {
      thermompnnJobId = thermoRes.jobId;
      thermompnnStatus = "pending";
    } else if (thermoRes.status === "error") {
      thermompnnStatus = "error";
      thermompnnError = thermoRes.error;
      console.warn("[verifyStability] ThermoMPNN API error:", thermoRes.error);
    } else {
      thermompnnStatus = "unavailable";
    }
  } catch (err: any) {
    console.warn("[verifyStability] ThermoMPNN submission failed:", err.message);
    thermompnnStatus = "error";
    thermompnnError = err.message;
  }

  // 2. Fold the mutated sequence using the selected engine
  const structure = await foldingEngine.fold(mutSequence, context);

  return {
    ddG,
    thermompnnJobId,
    thermompnnStatus,
    thermompnnError,
    structure
  };
}
