import { BiophysicsConditions, StructureProvenance } from "../../types";
import { generateMutantResponseSchema } from "../../shared/contracts";
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
      signal
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
      setCachedVariant(cacheGeneKey, variant, uniprotId, {
        mutantPdb: data.pdb ?? null,
        foldedResidueIndex: data.foldedResidueIndex ?? residueIndex,
        foldingDdG: data.ddG ?? null,
        foldingEnergetics: data.energetics ?? null,
        foldingStatus: effectiveFoldingStatus
      });
    } else if (data.status === "queued" || data.status === "running") {
      const jobId = data.foldxJobId;
      if (!jobId) {
        throw new Error("No foldxJobId returned for queued biophysical simulation.");
      }

      let delay = 2000;
      while (true) {
        if (signal.aborted || getActiveRequestId() !== requestId) return;

        // Wait with progressive backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(5000, delay + 500);

        if (signal.aborted || getActiveRequestId() !== requestId) return;

        const pollRes = await fetchWithAuth(`/api/v1/foldx-job/${jobId}`, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal
        });

        if (signal.aborted || getActiveRequestId() !== requestId) return;

        if (!pollRes.ok) {
          const pollErrData = await pollRes.json().catch(() => ({}));
          throw new Error(pollErrData.error || `Polling failed with status ${pollRes.status}`);
        }

        const pollData = await pollRes.json();

        // Update remote job IDs and statuses dynamically
        if (pollData.dynamut2JobId != null) sink.setDynamut2JobId(pollData.dynamut2JobId);
        if (pollData.dynamut2Status != null) sink.setDynamut2Status(pollData.dynamut2Status as any);
        if (pollData.ddmutJobId != null) sink.setDdmutJobId(pollData.ddmutJobId);
        if (pollData.ddmutStatus != null) sink.setDdmutStatus(pollData.ddmutStatus as any);
        if (pollData.thermompnnJobId != null) sink.setThermompnnJobId(pollData.thermompnnJobId);
        if (pollData.thermompnnStatus != null) sink.setThermompnnStatus(pollData.thermompnnStatus as any);
        if (pollData.thermompnnError != null) sink.setThermompnnError(pollData.thermompnnError);

        if (pollData.status === "completed") {
          const rawResult = pollData.result;
          const parsedRes = generateMutantResponseSchema.safeParse(rawResult);
          const resResult: GenerateMutantData = parsedRes.success ? parsedRes.data : (rawResult as GenerateMutantData);

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
          setCachedVariant(cacheGeneKey, variant, uniprotId, {
            mutantPdb: resResult.pdb ?? null,
            foldedResidueIndex: resResult.foldedResidueIndex ?? residueIndex,
            foldingDdG: resResult.ddG ?? null,
            foldingEnergetics: resResult.energetics ?? null,
            foldingStatus: effectiveFoldingStatus
          });
          break;
        } else if (pollData.status === "failed") {
          if (pollData.result) {
            const rawResult = pollData.result;
            const parsedRes = generateMutantResponseSchema.safeParse(rawResult);
            const resResult: GenerateMutantData = parsedRes.success ? parsedRes.data : (rawResult as GenerateMutantData);
            if (resResult.energetics) {
              applyEnergetics(resResult.energetics, resResult.provenance);
            }
          }
          throw new Error(pollData.error || "Background FoldX execution failed.");
        }
      }
    }

    if (data.dynamut2JobId != null) sink.setDynamut2JobId(data.dynamut2JobId);
    if (data.dynamut2Status != null) sink.setDynamut2Status(data.dynamut2Status as any);
    if (data.ddmutJobId != null) sink.setDdmutJobId(data.ddmutJobId);
    if (data.ddmutStatus != null) sink.setDdmutStatus(data.ddmutStatus as any);
    if (data.thermompnnJobId != null) sink.setThermompnnJobId(data.thermompnnJobId);
    if (data.thermompnnStatus != null) sink.setThermompnnStatus(data.thermompnnStatus as any);
    if (data.thermompnnError != null) sink.setThermompnnError(data.thermompnnError);

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
