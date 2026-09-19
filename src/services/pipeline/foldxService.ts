import { BiophysicsConditions, StructureProvenance } from "../../types";
import { generateMutantResponseSchema } from "../../shared/contracts";
import {
  CLIENT_FOLDX_POLL_BUDGET_MS,
  CLIENT_FOLDX_POLL_REQUEST_MS,
  CLIENT_FOLDX_QUEUE_BUDGET_MS,
  CLIENT_FOLDX_SUBMIT_BUDGET_MS,
} from "../../shared/timeouts";
import { toFoldxMutation } from "./notationService";
import { PipelineBiophysicalSink } from "./types";
import { setCachedVariant } from "./variantCache";

export interface FoldxExecutionOptions {
  gene?: string;
  uniprotId: string;
  variant: string;
  residueIndex: number | null;
  /** Environmental simulation conditions from user settings (pH, temp, ionic strength). */
  conditions?: BiophysicsConditions;
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  sink: PipelineBiophysicalSink;
  signal: AbortSignal;
  requestId: number;
  getActiveRequestId: () => number;
}

export async function executeFoldxPipeline(options: FoldxExecutionOptions): Promise<void> {
  const { gene, uniprotId, variant, residueIndex, conditions, fetchWithAuth, sink, signal, requestId, getActiveRequestId } = options;
  const cacheGeneKey = gene || uniprotId;

  if (!uniprotId || !uniprotId.trim()) {
    sink.setIsFolding(false);
    return;
  }

  const foldxMutation = toFoldxMutation(variant);
  if (!foldxMutation) {
    console.error("[FoldxService Error] Could not convert protein variant to FoldX mutation format:", variant);
    sink.setFoldingError("Invalid mutation format for FoldX simulation.");
    sink.setFoldingStatus("failed");
    sink.setIsFolding(false);
    return;
  }

  if (signal.aborted || getActiveRequestId() !== requestId) {
    sink.setIsFolding(false);
    return;
  }

  sink.setIsFolding(true);
  sink.setFoldingError(null);
  sink.setFoldingStatus(null);

  try {
    const res = await fetchWithAuth("/api/v1/generate-mutant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uniprotId,
        mutation: foldxMutation,
        ...(conditions
          ? {
              pH: conditions.ph,
              temperature: conditions.temperature,
              ionicStrength: conditions.ionicStrength
            }
          : {})
      }),
      signal,
      // This request may resolve a structure from PDBe and fall back to AlphaFold; without a ceiling
      // a stalled connection left the spinner up indefinitely.
      timeout: CLIENT_FOLDX_SUBMIT_BUDGET_MS
    });

    if (signal.aborted || getActiveRequestId() !== requestId) return;

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const serverErr = errData.error;
      const errorMsg = typeof serverErr === "object" && serverErr !== null
        ? (serverErr.message || serverErr.code || JSON.stringify(serverErr))
        : (typeof serverErr === "string" ? serverErr : errData.message || `HTTP ${res.status}`);
      throw new Error(errorMsg);
    }

    const raw = await res.json();
    const parsed = generateMutantResponseSchema.safeParse(raw);
    type GenerateMutantData = ReturnType<typeof generateMutantResponseSchema.parse>;
    const data: GenerateMutantData = parsed.success ? parsed.data : (raw as GenerateMutantData);

    if (signal.aborted || getActiveRequestId() !== requestId) return;

    // Propagate remote job IDs and statuses immediately from initial /generate-mutant response
    if (data.dynamut2JobId != null) sink.setDynamut2JobId(data.dynamut2JobId);
    if (data.dynamut2Status != null) sink.setDynamut2Status(data.dynamut2Status as any);
    if (data.ddmutJobId != null) sink.setDdmutJobId(data.ddmutJobId);
    if (data.ddmutStatus != null) sink.setDdmutStatus(data.ddmutStatus as any);
    if (data.thermompnnJobId != null) sink.setThermompnnJobId(data.thermompnnJobId);
    if (data.thermompnnStatus != null) sink.setThermompnnStatus(data.thermompnnStatus as any);
    if (data.thermompnnError != null) sink.setThermompnnError(data.thermompnnError);

    // Helper to update energetics with structure provenance
    const applyEnergetics = (energeticsData: any, prov: any) => {
      if (!energeticsData) return;
      const structureProvenance: StructureProvenance | undefined = prov
        ? {
            source: prov.structureSource ?? "alphafold",
            pdbId: prov.structurePdbId ?? undefined,
            chainId: prov.structureChainId ?? undefined,
            resolution: prov.structureResolution ?? undefined,
            method: prov.structureMethod ?? undefined,
            identity: prov.structureIdentity ?? undefined,
            foldxVersion: prov.foldxVersion,
            foldxRuns: prov.foldxRuns,
            seed: prov.seed,
            raspDatasetSnapshot: prov.raspDatasetSnapshot,
            vesmModel: prov.vesmModel,
            timestamp: prov.timestamp
          }
        : undefined;

      sink.setFoldingEnergetics((prev: any) => {
        const base = (prev && typeof prev === "object") ? prev : {};
        return {
          ...base,
          ...energeticsData,
          dynamut2: energeticsData?.dynamut2 ?? base?.dynamut2 ?? null,
          ddmut: energeticsData?.ddmut ?? base?.ddmut ?? null,
          thermompnn: energeticsData?.thermompnn ?? base?.thermompnn ?? null,
          stabilityoracle: energeticsData?.stabilityoracle ?? base?.stabilityoracle ?? null,
          structureProvenance: structureProvenance ?? base?.structureProvenance
        };
      });
    };

    /**
     * Settles remote engines that reported "pending" with no job id.
     *
     * `useJobPoller` requires a job id before it will start, and the SSE channel for these engines
     * is only ever emitted from inside that poller's own handler — so an engine left at "pending"
     * with no id has no route to a result, and the store carries that non-terminal status forever.
     * The FoldX run ending is the last moment anything could resolve it.
     *
     * Engines that DO have a job id are deliberately left alone: their poller is live and will
     * report the real outcome.
     */
    const settleUnreachableRemoteEngines = (payload: {
      dynamut2Status?: string | null;
      dynamut2JobId?: string | null;
      ddmutStatus?: string | null;
      ddmutJobId?: string | null;
      thermompnnStatus?: string | null;
      thermompnnJobId?: string | null;
    }) => {
      if (payload.dynamut2Status === "pending" && !payload.dynamut2JobId) {
        sink.setDynamut2Status("unavailable");
      }
      if (payload.ddmutStatus === "pending" && !payload.ddmutJobId) {
        sink.setDdmutStatus("unavailable");
      }
      if (payload.thermompnnStatus === "pending" && !payload.thermompnnJobId) {
        sink.setThermompnnStatus("unavailable");
      }
    };

    if (data.status !== "queued" && data.status !== "running") {
      const isFoldxSuccess = (data.status === "success" || data.status === "completed") && data.ddG !== null;
      const effectiveFoldingStatus = isFoldxSuccess ? "success" : (data.status === "unavailable" ? "unavailable" : "failed");

      sink.setMutantPdb(data.pdb ?? null);
      sink.setFoldedResidueIndex(data.foldedResidueIndex ?? residueIndex);
      sink.setFoldingDdG(data.ddG ?? null);
      sink.setFoldingStatus(effectiveFoldingStatus);
      if (!isFoldxSuccess && (data.error || data.energetics?.foldxError)) {
        sink.setFoldingError(data.error || data.energetics?.foldxError || "FoldX simulation failed");
      }

      if (data.energetics) {
        applyEnergetics(data.energetics, data.provenance);
      }
      // The run is over: nobody will resolve an engine that is still pending without an id.
      settleUnreachableRemoteEngines(data);
      setCachedVariant(cacheGeneKey, variant, uniprotId, {
        mutantPdb: data.pdb ?? null,
        foldedResidueIndex: data.foldedResidueIndex ?? residueIndex,
        foldingDdG: data.ddG ?? null,
        foldingEnergetics: data.energetics ?? null,
        foldingStatus: effectiveFoldingStatus,
        dynamut2JobId: data.dynamut2JobId ?? null,
        dynamut2Status: data.dynamut2Status ?? null,
        ddmutJobId: data.ddmutJobId ?? null,
        ddmutStatus: data.ddmutStatus ?? null,
        thermompnnJobId: data.thermompnnJobId ?? null,
        thermompnnStatus: data.thermompnnStatus ?? null,
        thermompnnError: data.thermompnnError ?? null
      });
    } else if (data.status === "queued" || data.status === "running") {
      const jobId = data.foldxJobId;
      if (!jobId) {
        throw new Error("No foldxJobId returned for queued biophysical simulation.");
      }

      let delay = 2000;
      let foldxCommitted = false;
      const submitStart = Date.now();
      /**
       * When the server first reported this job as `running`, or null while it is still queued.
       *
       * The submitted-at timestamp is deliberately NOT used for the execution budget: a queued job is
       * waiting for a concurrency slot, not spending its own budget, and conflating the two is what
       * made the client abandon jobs the server completed.
       */
      let executionStart: number | null = null;
      let consecutiveErrors = 0;

      while (true) {
        if (signal.aborted || getActiveRequestId() !== requestId) return;

        // Phase-aware deadline: queue wait and execution are budgeted separately.
        const phaseStart = executionStart ?? submitStart;
        const phaseBudget = executionStart !== null
          ? CLIENT_FOLDX_POLL_BUDGET_MS
          : CLIENT_FOLDX_QUEUE_BUDGET_MS;
        if (Date.now() - phaseStart > phaseBudget) {
          throw new Error(
            executionStart !== null
              ? `FoldX simulation timed out after ${Math.round(CLIENT_FOLDX_POLL_BUDGET_MS / 60000)} minutes of execution.`
              : `FoldX job waited more than ${Math.round(CLIENT_FOLDX_QUEUE_BUDGET_MS / 60000)} minutes in the queue.`
          );
        }

        // Wait with progressive backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(5000, delay + 500);

        if (signal.aborted || getActiveRequestId() !== requestId) return;

        let pollRes: Response;
        try {
          pollRes = await fetchWithAuth(`/api/v1/foldx-job/${jobId}`, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal,
            // Bound a single stalled poll so the loop's own deadline is always reachable.
            timeout: CLIENT_FOLDX_POLL_REQUEST_MS
          });
        } catch (fetchErr: any) {
          consecutiveErrors++;
          if (consecutiveErrors >= 3 || signal.aborted) {
            throw fetchErr;
          }
          console.warn(`[FoldxService] Polling network glitch (${consecutiveErrors}/3):`, fetchErr.message);
          continue;
        }

        if (signal.aborted || getActiveRequestId() !== requestId) return;

        if (!pollRes.ok) {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            const pollErrData = await pollRes.json().catch(() => ({}));
            throw new Error(pollErrData.error || `Polling failed with status ${pollRes.status}`);
          }
          console.warn(`[FoldxService] Polling HTTP ${pollRes.status} (${consecutiveErrors}/3), retrying...`);
          continue;
        }

        consecutiveErrors = 0;
        const pollData = await pollRes.json();

        // The job has left the queue: from here the execution budget applies, not the queue budget.
        if (pollData.status === "running" && executionStart === null) {
          executionStart = Date.now();
        }

        // Update remote job IDs dynamically if newly resolved
        if (pollData.dynamut2JobId != null) sink.setDynamut2JobId(pollData.dynamut2JobId);
        if (pollData.ddmutJobId != null) sink.setDdmutJobId(pollData.ddmutJobId);
        if (pollData.thermompnnJobId != null) sink.setThermompnnJobId(pollData.thermompnnJobId);

        // Only propagate terminal failures/errors from backend snapshot; never clobber client's terminal status back to pending
        if (pollData.dynamut2Status === "unavailable" || pollData.dynamut2Status === "error") {
          sink.setDynamut2Status(pollData.dynamut2Status as any);
        }
        if (pollData.ddmutStatus === "unavailable" || pollData.ddmutStatus === "error") {
          sink.setDdmutStatus(pollData.ddmutStatus as any);
        }
        if (pollData.thermompnnStatus === "unavailable" || pollData.thermompnnStatus === "error") {
          sink.setThermompnnStatus(pollData.thermompnnStatus as any);
        }
        if (pollData.thermompnnError != null) sink.setThermompnnError(pollData.thermompnnError);

        if (pollData.status === "completed" || pollData.status === "failed") {
          if (!foldxCommitted) {
            foldxCommitted = true;
            const rawResult = pollData.result;
            const parsedRes = generateMutantResponseSchema.safeParse(rawResult);
            const resResult: GenerateMutantData = parsedRes.success ? parsedRes.data : (rawResult as GenerateMutantData);

            if (pollData.status === "completed") {
              const isFoldxSuccess = (resResult.status === "success" || resResult.status === "completed") && resResult.ddG !== null;
              const effectiveFoldingStatus = isFoldxSuccess ? "success" : (resResult.status === "unavailable" ? "unavailable" : "failed");

              sink.setMutantPdb(resResult.pdb ?? null);
              sink.setFoldedResidueIndex(resResult.foldedResidueIndex ?? residueIndex);
              sink.setFoldingDdG(resResult.ddG ?? null);
              sink.setFoldingStatus(effectiveFoldingStatus);
              if (!isFoldxSuccess && (resResult.error || resResult.energetics?.foldxError)) {
                sink.setFoldingError(resResult.error || resResult.energetics?.foldxError || "FoldX simulation failed");
              }

              if (resResult.energetics) {
                applyEnergetics(resResult.energetics, resResult.provenance);
              }

              const d2Status = resResult.energetics?.dynamut2 != null ? "done" : (pollData.dynamut2Status ?? data.dynamut2Status ?? null);
              const ddmStatus = resResult.energetics?.ddmut != null ? "done" : (pollData.ddmutStatus ?? data.ddmutStatus ?? null);
              const tmStatus = resResult.energetics?.thermompnn != null ? "done" : (pollData.thermompnnStatus ?? data.thermompnnStatus ?? null);

              // The FoldX run has finished, so any engine still pending without a job id is
              // unreachable; one WITH an id is left to its live poller.
              settleUnreachableRemoteEngines({
                dynamut2Status: d2Status,
                dynamut2JobId: pollData.dynamut2JobId ?? data.dynamut2JobId ?? null,
                ddmutStatus: ddmStatus,
                ddmutJobId: pollData.ddmutJobId ?? data.ddmutJobId ?? null,
                thermompnnStatus: tmStatus,
                thermompnnJobId: pollData.thermompnnJobId ?? data.thermompnnJobId ?? null
              });

              setCachedVariant(cacheGeneKey, variant, uniprotId, {
                mutantPdb: resResult.pdb ?? null,
                foldedResidueIndex: resResult.foldedResidueIndex ?? residueIndex,
                foldingDdG: resResult.ddG ?? null,
                foldingEnergetics: resResult.energetics ?? null,
                foldingStatus: effectiveFoldingStatus,
                dynamut2JobId: pollData.dynamut2JobId ?? data.dynamut2JobId ?? null,
                dynamut2Status: d2Status,
                ddmutJobId: pollData.ddmutJobId ?? data.ddmutJobId ?? null,
                ddmutStatus: ddmStatus,
                thermompnnJobId: pollData.thermompnnJobId ?? data.thermompnnJobId ?? null,
                thermompnnStatus: tmStatus,
                thermompnnError: pollData.thermompnnError ?? data.thermompnnError ?? null
              });
            } else {
              // Failed status
              if (resResult?.energetics) {
                applyEnergetics(resResult.energetics, resResult.provenance);
              }
              // The job failed, so nothing will resolve a still-pending remote engine.
              settleUnreachableRemoteEngines({
                dynamut2Status: pollData.dynamut2Status ?? data.dynamut2Status ?? null,
                dynamut2JobId: pollData.dynamut2JobId ?? data.dynamut2JobId ?? null,
                ddmutStatus: pollData.ddmutStatus ?? data.ddmutStatus ?? null,
                ddmutJobId: pollData.ddmutJobId ?? data.ddmutJobId ?? null,
                thermompnnStatus: pollData.thermompnnStatus ?? data.thermompnnStatus ?? null,
                thermompnnJobId: pollData.thermompnnJobId ?? data.thermompnnJobId ?? null
              });
            }
          }

          // Release UI folding state immediately
          sink.setIsFolding(false);

          if (pollData.status === "failed") {
            throw new Error(pollData.error || "Background FoldX execution failed.");
          }
          break;
        }
      }
    }

  } catch (err: any) {
    if (signal.aborted || err.name === "AbortError" || getActiveRequestId() !== requestId) return;
    const msg = typeof err === "object" && err !== null ? (err.message || (typeof err.error === "object" ? err.error?.message : err.error) || JSON.stringify(err)) : String(err);
    console.error("[FoldxService Error] FoldX pipeline failed:", msg);
    sink.setFoldingError(msg || "FoldX simulation failed.");
    sink.setFoldingStatus("failed");
  } finally {
    if (!signal.aborted && getActiveRequestId() === requestId) {
      sink.setIsFolding(false);
    }
  }
}
