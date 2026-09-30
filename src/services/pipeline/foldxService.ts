import { BiophysicsConditions, StructureProvenance } from "../../types";
import { generateMutantResponseSchema } from "../../shared/contracts";
import { isFoldxPhase, type FoldxProgress } from "../../shared/foldxPhase";
import {
  CLIENT_FOLDX_POLL_BUDGET_MS,
  CLIENT_FOLDX_POLL_REQUEST_MS,
  CLIENT_FOLDX_QUEUE_BUDGET_MS,
  CLIENT_FOLDX_SUBMIT_BUDGET_MS,
  CLIENT_REMOTE_SUBMISSION_WAIT_MS,
} from "../../shared/timeouts";
import { readJsonWithTimeout } from "../../shared/httpBody";
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
  /**
   * The remote-engine state this variant ALREADY has, as restored from its cached bundle.
   *
   * The settle at the end of a failed run used to reason from the run's own belief alone, which is
   * empty until the POST returns — so (a) an exit that throws before that, such as a non-ok response
   * or a stalled body, settled nothing and left the engines `pending` with no poller, the original
   * stuck-"Running" defect; and (b) it could not see a job id the STORE was holding from a previous
   * attempt, so it marked an engine unavailable that `useJobPoller` was at that moment polling —
   * tearing the live poller down and discarding the result it was about to deliver.
   *
   * Supplied only where it is unambiguously this variant's state (the backfill dispatch, which has the
   * restored bundle in hand). A fresh run passes nothing, which is correct: nothing is pending yet.
   */
  initialRemoteState?: {
    dynamut2Status?: string | null;
    dynamut2JobId?: string | null;
    ddmutStatus?: string | null;
    ddmutJobId?: string | null;
    thermompnnStatus?: string | null;
    thermompnnJobId?: string | null;
  };
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

  /**
   * Progress reporting — declared before the first sink write, because the initial report below
   * has to be able to call it (a `let` used before its initialiser is a TDZ crash).
   */
  let lastProgressSignature = "";

  /**
   * Pushes the server's phase to the store, but only when it CHANGES.
   *
   * The poll loop runs every 2-5 s for the length of a run, and a fresh object each time would
   * re-render every surface that reads progress. The signature is the tuple a reader can see.
   */
  const publishProgress = (progress: FoldxProgress | null) => {
    if (!sink.setFoldingProgress) return;
    const signature = progress
      ? `${progress.phase}|${progress.elapsedMs === null ? "null" : Math.round(progress.elapsedMs / 1000)}|${progress.queuePosition}`
      : "none";
    if (signature === lastProgressSignature) return;
    lastProgressSignature = signature;
    sink.setFoldingProgress(progress);
  };

  /**
   * Reads the progress fields off a job payload.
   *
   * Every field is validated rather than trusted: a phase the shared vocabulary does not know is
   * dropped (so a newer server cannot make this client render a stage it cannot name), and a
   * duration that is not a finite non-negative number is ignored rather than rendered as a
   * nonsensical age.
   */
  const progressFrom = (payload: any): FoldxProgress | null => {
    if (!payload || typeof payload !== "object") return null;
    const phase = isFoldxPhase(payload.phase) ? payload.phase : null;
    const rawElapsed = Number(payload.elapsedMs);
    const elapsedMs = Number.isFinite(rawElapsed) && rawElapsed >= 0 ? rawElapsed : null;
    const queuePosition = Number.isFinite(payload.queuedAhead) ? Number(payload.queuedAhead) : null;
    if (!phase && elapsedMs === null && queuePosition === null) return null;
    return { phase, elapsedMs, queuePosition, receivedAt: Date.now() };
  };

  sink.setIsFolding(true);
  sink.setFoldingError(null);
  sink.setFoldingStatus(null);
  /**
   * No phase yet, and that is the honest report: the submit request is resolving a structure
   * server-side, so nothing has been queued. The UI renders "Running" with an age and no stage
   * claim until the server names one — the alternative (a locally guessed stage) is what produced
   * "Finalizing" for five minutes of structure repair.
   */
  publishProgress(null);

  /**
   * The latest remote-engine state seen — seeded with what this variant ALREADY had, so the error
   * exits can settle from the store's view rather than only from this run's.
   */
  let lastRemoteState: {
    dynamut2Status?: string | null;
    dynamut2JobId?: string | null;
    ddmutStatus?: string | null;
    ddmutJobId?: string | null;
    thermompnnStatus?: string | null;
    thermompnnJobId?: string | null;
  } = { ...(options.initialRemoteState ?? {}) };

  /**
   * Settles remote engines that reported "pending" with no job id.
   *
   * `useJobPoller` requires a job id before it will start, and the SSE channel for these engines is
   * only ever emitted from inside that poller's own handler — so an engine left at "pending" with no
   * id has no route to a result, and the store carries that non-terminal status forever. The FoldX
   * run ending is the last moment anything could resolve it, which is why this is called on the
   * terminal commits AND on every error exit.
   *
   * Defined above the `try` on purpose: it previously lived inside it, so the `catch` could not
   * reach it and the error exits — exactly the paths that leave `pending` with a null id, because
   * the POST seeds that state before its submission race resolves — never settled anything.
   *
   * Engines that DO have a job id are deliberately left alone: their poller is live and will report
   * the real outcome.
   */
  const settleUnreachableRemoteEngines = (payload: {
    dynamut2Status?: string | null;
    dynamut2JobId?: string | null;
    ddmutStatus?: string | null;
    ddmutJobId?: string | null;
    thermompnnStatus?: string | null;
    thermompnnJobId?: string | null;
  }) => {
    /**
     * CLEARS the status rather than writing "unavailable".
     *
     * `unavailable` is not a neutral "no result" — the registry reads it as a property of the
     * DEPLOYMENT, so ThermoMPNN rendered "Not available in this deployment — the local model service
     * is not running" and DynaMut2/DDMut "provider did not answer in time" for what is actually a
     * client-side FoldX or poll failure. That replaced one false statement ("Calculation in
     * progress", forever) with a different false one, which a review caught.
     *
     * A cleared status resolves to `no-result` — "The run ended without returning a value for this
     * engine" — which is exactly what happened, and is verified by executing the registry:
     *
     *   unavailable -> thermompnn=not-installed, dynamut2/ddmut=upstream-busy
     *   null        -> thermompnn/dynamut2/ddmut = no-result
     */
    if (payload.dynamut2Status === "pending" && !payload.dynamut2JobId) {
      sink.setDynamut2Status(null);
    }
    if (payload.ddmutStatus === "pending" && !payload.ddmutJobId) {
      sink.setDdmutStatus(null);
    }
    if (payload.thermompnnStatus === "pending" && !payload.thermompnnJobId) {
      sink.setThermompnnStatus(null);
    }
  };

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
      const errData = await readJsonWithTimeout(res, CLIENT_FOLDX_POLL_REQUEST_MS).catch(() => ({}));
      const serverErr = errData.error;
      const errorMsg = typeof serverErr === "object" && serverErr !== null
        ? (serverErr.message || serverErr.code || JSON.stringify(serverErr))
        : (typeof serverErr === "string" ? serverErr : errData.message || `HTTP ${res.status}`);
      throw new Error(errorMsg);
    }

    const raw = await readJsonWithTimeout(res, CLIENT_FOLDX_SUBMIT_BUDGET_MS);
    const parsed = generateMutantResponseSchema.safeParse(raw);
    type GenerateMutantData = ReturnType<typeof generateMutantResponseSchema.parse>;
    const data: GenerateMutantData = parsed.success ? parsed.data : (raw as GenerateMutantData);

    if (signal.aborted || getActiveRequestId() !== requestId) return;

    /**
     * The submit response says whether the job is queued and how many jobs are ahead of it. It is
     * the first moment the client can describe the wait honestly.
     */
    publishProgress(progressFrom(data));

    // Propagate remote job IDs and statuses immediately from initial /generate-mutant response
    if (data.dynamut2JobId != null) sink.setDynamut2JobId(data.dynamut2JobId);
    if (data.dynamut2Status != null) sink.setDynamut2Status(data.dynamut2Status as any);
    if (data.ddmutJobId != null) sink.setDdmutJobId(data.ddmutJobId);
    if (data.ddmutStatus != null) sink.setDdmutStatus(data.ddmutStatus as any);
    if (data.thermompnnJobId != null) sink.setThermompnnJobId(data.thermompnnJobId);
    if (data.thermompnnStatus != null) sink.setThermompnnStatus(data.thermompnnStatus as any);
    if (data.thermompnnError != null) sink.setThermompnnError(data.thermompnnError);

    // Remember what the run has told us, so a later error exit can settle the engines it left
    // "pending" without a job id. Engines WITH a live id are left alone by the helper.
    //
    // MERGED, not replaced: a POST that omits an id must not erase one this variant already had, or
    // the settle would mark an engine unavailable while its poller is live.
    lastRemoteState = {
      dynamut2Status: data.dynamut2Status ?? lastRemoteState.dynamut2Status ?? null,
      dynamut2JobId: data.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
      ddmutStatus: data.ddmutStatus ?? lastRemoteState.ddmutStatus ?? null,
      ddmutJobId: data.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
      thermompnnStatus: data.thermompnnStatus ?? lastRemoteState.thermompnnStatus ?? null,
      thermompnnJobId: data.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null,
    };

    // Helper to update energetics with structureProvenance
    const applyEnergetics = (energeticsData: any, prov: any): StructureProvenance | undefined => {
      if (!energeticsData) return undefined;
      const rawSource = prov?.source ?? prov?.structureSource;
      const rawPdbId = prov?.pdbId ?? prov?.structurePdbId;

      const rawRes = prov?.resolution ?? prov?.structureResolution;
      const numRes = typeof rawRes === "number" ? rawRes : (rawRes ? parseFloat(String(rawRes)) : undefined);
      const resolution = Number.isFinite(numRes) ? numRes : undefined;

      const rawIdentity = prov?.identity ?? prov?.structureIdentity;
      const numIdentity = typeof rawIdentity === "number" ? rawIdentity : (rawIdentity ? parseFloat(String(rawIdentity)) : undefined);
      const identity = Number.isFinite(numIdentity) ? numIdentity : undefined;

      const structureProvenance: StructureProvenance | undefined = prov
        ? {
            source: rawSource ?? (rawPdbId ? "experimental" : "alphafold"),
            pdbId: rawPdbId ?? undefined,
            chainId: prov.chainId ?? prov.structureChainId ?? undefined,
            resolution,
            method: prov.method ?? prov.structureMethod ?? undefined,
            identity,
            afdbVersion: prov.afdbVersion,
            foldxVersion: prov.foldxVersion,
            foldxRuns: prov.foldxRuns,
            seed: prov.seed,
            raspDatasetSnapshot: prov.raspDatasetSnapshot,
            vesmModel: prov.vesmModel,
            modelSha: prov.modelSha,
            timestamp: prov.timestamp
          }
        : undefined;

      if (structureProvenance && sink.setStructureProvenance) {
        sink.setStructureProvenance(structureProvenance);
      }

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

      return structureProvenance;
    };

    // `settleUnreachableRemoteEngines` is defined above the `try`, so the catch can reach it.
    // It used to live here, inside the try, which is why the error exits never settled anything.

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

      let resolvedProvenance: StructureProvenance | undefined;
      if (data.energetics) {
        resolvedProvenance = applyEnergetics(data.energetics, data.provenance);
      }
      /**
       * A cache hit answers before the remote submissions have returned their job ids, so the server
       * hands back a token to collect them. Without this the engines below were settled to "No
       * result" on every revisit although their jobs had been submitted (see
       * `pendingRemoteSubmissions` in server/routes/biophysics/generation.ts).
       *
       * FoldX is already painted; its spinner is released first so only the waiting engines show
       * "Running" while the ids are collected.
       */
      const token = typeof (data as any).remoteSubmissionToken === "string" ? (data as any).remoteSubmissionToken : null;
      if (token) {
        sink.setIsFolding(false);
        try {
          const subRes = await fetchWithAuth(`/api/v1/remote-submissions/${encodeURIComponent(token)}`, {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal,
            timeout: CLIENT_REMOTE_SUBMISSION_WAIT_MS
          });
          if (signal.aborted || getActiveRequestId() !== requestId) return;
          const sub = subRes.ok ? await readJsonWithTimeout(subRes, CLIENT_FOLDX_POLL_REQUEST_MS) : null;
          if (signal.aborted || getActiveRequestId() !== requestId) return;
          if (sub?.settled) {
            if (sub.dynamut2JobId) sink.setDynamut2JobId(sub.dynamut2JobId);
            if (sub.dynamut2Status) sink.setDynamut2Status(sub.dynamut2Status);
            if (sub.ddmutJobId) sink.setDdmutJobId(sub.ddmutJobId);
            if (sub.ddmutStatus) sink.setDdmutStatus(sub.ddmutStatus);
            if (sub.thermompnnJobId) sink.setThermompnnJobId(sub.thermompnnJobId);
            if (sub.thermompnnStatus) sink.setThermompnnStatus(sub.thermompnnStatus);
            if (sub.thermompnnError) sink.setThermompnnError(sub.thermompnnError);
            if (typeof sub.thermompnnVal === "number") {
              sink.setFoldingEnergetics((prev: any) => ({ ...(prev ?? {}), thermompnn: sub.thermompnnVal }));
            }
            lastRemoteState = {
              dynamut2Status: sub.dynamut2Status ?? lastRemoteState.dynamut2Status ?? null,
              dynamut2JobId: sub.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
              ddmutStatus: sub.ddmutStatus ?? lastRemoteState.ddmutStatus ?? null,
              ddmutJobId: sub.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
              thermompnnStatus: sub.thermompnnStatus ?? lastRemoteState.thermompnnStatus ?? null,
              thermompnnJobId: sub.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null,
            };
          }
        } catch (subErr: any) {
          if (signal.aborted || getActiveRequestId() !== requestId) return;
          console.warn("[FoldxService] Could not collect remote job ids:", subErr?.message ?? subErr);
        }
      }

      // The run is over: nobody will resolve an engine that is still pending without an id.
      //
      // Settled from the MERGED view rather than from this response. `data` alone cannot see an id the
      // store already holds, so a response that omits one — the ordinary submission race — would look
      // like an engine with no id, and the settle would clear its status and tear down the live poller
      // that was about to deliver the result. That is the defect this whole change exists to remove, and
      // this was one of the three sites still feeding the settle a narrower view than the store's.
      settleUnreachableRemoteEngines(lastRemoteState);
      setCachedVariant(cacheGeneKey, variant, uniprotId, {
        mutantPdb: data.pdb ?? null,
        foldedResidueIndex: data.foldedResidueIndex ?? residueIndex,
        foldingDdG: data.ddG ?? null,
        foldingEnergetics: data.energetics
          ? {
              ...data.energetics,
              ...(resolvedProvenance ? { structureProvenance: resolvedProvenance } : {})
            }
          : null,
        foldingStatus: effectiveFoldingStatus,
        dynamut2JobId: data.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
        dynamut2Status: data.dynamut2Status ?? lastRemoteState.dynamut2Status ?? null,
        ddmutJobId: data.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
        ddmutStatus: data.ddmutStatus ?? lastRemoteState.ddmutStatus ?? null,
        thermompnnJobId: data.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null,
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
            const pollErrData = await readJsonWithTimeout(pollRes, CLIENT_FOLDX_POLL_REQUEST_MS).catch(() => ({}));
            throw new Error(pollErrData.error || `Polling failed with status ${pollRes.status}`);
          }
          console.warn(`[FoldxService] Polling HTTP ${pollRes.status} (${consecutiveErrors}/3), retrying...`);
          continue;
        }

        consecutiveErrors = 0;
        const pollData = await readJsonWithTimeout(pollRes, CLIENT_FOLDX_POLL_REQUEST_MS);

        /**
         * Re-checked AFTER the body read, not only before it.
         *
         * The guard above runs before `readJsonWithTimeout`, which awaits; a run aborted inside that
         * window would otherwise publish its own phase into the store after the REPLACEMENT run had
         * already cleared it — the previous variant's stage displayed beside the new variant's
         * spinner. The per-run signature dedup cannot catch that: it is local to this invocation.
         */
        if (signal.aborted || getActiveRequestId() !== requestId) return;

        // The job has left the queue: from here the execution budget applies, not the queue budget.
        if (pollData.status === "running" && executionStart === null) {
          executionStart = Date.now();
        }

        // The worker's own account of what it is doing — rendered verbatim, never guessed at.
        publishProgress(progressFrom(pollData));

        // Update remote job IDs dynamically if newly resolved
        if (pollData.dynamut2JobId != null) sink.setDynamut2JobId(pollData.dynamut2JobId);
        if (pollData.ddmutJobId != null) sink.setDdmutJobId(pollData.ddmutJobId);
        if (pollData.thermompnnJobId != null) sink.setThermompnnJobId(pollData.thermompnnJobId);

        // Keep the error paths' view of the run current: a job id learned from polling must not be
        // forgotten, or a later failure would settle an engine whose poller is live.
        lastRemoteState = {
          dynamut2Status: pollData.dynamut2Status ?? lastRemoteState.dynamut2Status ?? null,
          dynamut2JobId: pollData.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
          ddmutStatus: pollData.ddmutStatus ?? lastRemoteState.ddmutStatus ?? null,
          ddmutJobId: pollData.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
          thermompnnStatus: pollData.thermompnnStatus ?? lastRemoteState.thermompnnStatus ?? null,
          thermompnnJobId: pollData.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null,
        };

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

              let resolvedProvenance: StructureProvenance | undefined;
              if (resResult.energetics) {
                resolvedProvenance = applyEnergetics(resResult.energetics, resResult.provenance);
              }

              const d2Status = resResult.energetics?.dynamut2 != null ? "done" : (pollData.dynamut2Status ?? data.dynamut2Status ?? null);
              const ddmStatus = resResult.energetics?.ddmut != null ? "done" : (pollData.ddmutStatus ?? data.ddmutStatus ?? null);
              const tmStatus = resResult.energetics?.thermompnn != null ? "done" : (pollData.thermompnnStatus ?? data.thermompnnStatus ?? null);

              // The FoldX run has finished, so any engine still pending without a job id is
              // unreachable; one WITH an id is left to its live poller.
              settleUnreachableRemoteEngines({
                dynamut2Status: d2Status,
                dynamut2JobId: pollData.dynamut2JobId ?? data.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
                ddmutStatus: ddmStatus,
                ddmutJobId: pollData.ddmutJobId ?? data.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
                thermompnnStatus: tmStatus,
                thermompnnJobId: pollData.thermompnnJobId ?? data.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null
              });

              setCachedVariant(cacheGeneKey, variant, uniprotId, {
                mutantPdb: resResult.pdb ?? null,
                foldedResidueIndex: resResult.foldedResidueIndex ?? residueIndex,
                foldingDdG: resResult.ddG ?? null,
                foldingEnergetics: resResult.energetics
                  ? {
                      ...resResult.energetics,
                      ...(resolvedProvenance ? { structureProvenance: resolvedProvenance } : {})
                    }
                  : null,
                foldingStatus: effectiveFoldingStatus,
                dynamut2JobId: pollData.dynamut2JobId ?? data.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
                dynamut2Status: d2Status,
                ddmutJobId: pollData.ddmutJobId ?? data.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
                ddmutStatus: ddmStatus,
                thermompnnJobId: pollData.thermompnnJobId ?? data.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null,
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
                dynamut2JobId: pollData.dynamut2JobId ?? data.dynamut2JobId ?? lastRemoteState.dynamut2JobId ?? null,
                ddmutStatus: pollData.ddmutStatus ?? data.ddmutStatus ?? null,
                ddmutJobId: pollData.ddmutJobId ?? data.ddmutJobId ?? lastRemoteState.ddmutJobId ?? null,
                thermompnnStatus: pollData.thermompnnStatus ?? data.thermompnnStatus ?? null,
                thermompnnJobId: pollData.thermompnnJobId ?? data.thermompnnJobId ?? lastRemoteState.thermompnnJobId ?? null
              });
            }
          }

          // Release UI folding state immediately
          sink.setIsFolding(false);
          // The run is over, so there is no phase to report; leaving the last one on screen would
          // keep "Structure repair" visible over a finished result.
          publishProgress(null);

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

    /**
     * Settle on the ERROR exits too.
     *
     * The FoldX run ending is the last moment anything could resolve a remote engine, and these
     * exits are precisely when the POST has already seeded `pending` with a null job id (the
     * submission race resolves later, so the id is genuinely unknown here). Without this the store
     * kept asserting "pending" for engines that have no poller, so the UI read "Calculation in
     * progress" with no route to a result, and `summarizeCoverage` kept counting them as running.
     *
     * Engines that DO have a live job id are left to their poller by the helper.
     */
    settleUnreachableRemoteEngines(lastRemoteState);

    sink.setFoldingError(msg || "FoldX simulation failed.");
    sink.setFoldingStatus("failed");
    // A failed run has no phase; a stale "Structure repair" beside a failure message is a
    // contradiction the reader should never have to reconcile.
    publishProgress(null);
  } finally {
    if (!signal.aborted && getActiveRequestId() === requestId) {
      sink.setIsFolding(false);
    }
  }
}
