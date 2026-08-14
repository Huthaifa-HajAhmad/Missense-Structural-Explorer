import { Mutation, applyMutation } from "../utils/mutation.ts";
import { FoldingEngine, FoldingContext, StructureResult } from "./folding-engines.ts";
import { submitThermoMpnnJob } from "./energy-models.ts";
import { submitDynaMut2Job, submitDdmutJob } from "./dynamut.ts";

export interface StabilityVerificationResult {
  ddG: number | null;
  thermompnnJobId: string | null;
  thermompnnStatus: "pending" | "done" | "unavailable" | "error";
  thermompnnError?: string;
  dynamut2JobId: string | null;
  dynamut2Status: "pending" | "done" | "unavailable" | "error";
  ddmutJobId: string | null;
  ddmutStatus: "pending" | "done" | "unavailable" | "error";
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
    const thermoRes = await submitThermoMpnnJob(context.wtPdb, context.mutationCode, tamarindApiKey, context.signal);
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

  // 2. Submit DynaMut2 & DDmut remote jobs concurrently with folding (25s timeout)
  let dynamut2JobId: string | null = null;
  let dynamut2Status: "pending" | "done" | "unavailable" | "error" = "unavailable";
  let ddmutJobId: string | null = null;
  let ddmutStatus: "pending" | "done" | "unavailable" | "error" = "unavailable";

  const d2Promise = submitDynaMut2Job(context.wtPdb, mutation.chain, mutation.position, mutation.wt, mutation.mt, context.signal)
    .catch(err => {
      console.warn("[verifyStability] DynaMut2 submission failed:", err.message);
      return null;
    });
  const ddmPromise = submitDdmutJob(context.wtPdb, mutation.chain, mutation.position, mutation.wt, mutation.mt, context.signal)
    .catch(err => {
      console.warn("[verifyStability] DDMut submission failed:", err.message);
      return null;
    });
  // Allow 25s for multipart PDB upload to biosig.lab.uq.edu.au (Australia)
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 25000));

  const submissionsPromise = Promise.all([
    Promise.race([d2Promise, timeout]),
    Promise.race([ddmPromise, timeout])
  ]);

  const [submissionsResult, structure] = await Promise.all([
    submissionsPromise,
    foldingEngine.fold(mutSequence, context)
  ]);

  const [d2Id, ddmId] = submissionsResult;
  if (d2Id) {
    dynamut2JobId = d2Id;
    dynamut2Status = "pending";
  }
  if (ddmId) {
    ddmutJobId = ddmId;
    ddmutStatus = "pending";
  }

  return {
    ddG,
    thermompnnJobId,
    thermompnnStatus,
    thermompnnError,
    dynamut2JobId,
    dynamut2Status,
    ddmutJobId,
    ddmutStatus,
    structure
  };
}
