import { PdbHomolog, NearestResidue } from "../../types";
import { getDeduplicatedPromise } from "../../variantAnalysisUtils";
import { TraceContext, PipelineStructureSink } from "./types";

export async function fetchPdbCoordinates(
  targetGene: string,
  targetVariant: string,
  targetUniprot: string,
  residueIndex: number | undefined,
  apiClient: any,
  signal: AbortSignal,
  traceContext?: TraceContext
): Promise<string | null> {
  const pdbKey = `warmup_${targetGene}_${targetVariant}_${targetUniprot}`;
  const pdbStart = performance.now();

  return getDeduplicatedPromise(pdbKey, () =>
    apiClient
      .getPdb(targetUniprot, residueIndex, signal)
      .then((res: any) => {
        const durationMs = Math.round(performance.now() - pdbStart);
        const offsetMs = traceContext ? Math.max(0, Math.round(pdbStart - traceContext.traceStart)) : 0;
        if (traceContext?.activeTraceId) {
          traceContext.addTraceSpan({
            traceId: traceContext.activeTraceId,
            name: "PDB / AlphaFold 3D Coordinates Fetch",
            stage: "structure",
            startTime: Date.now() - durationMs,
            offsetMs,
            durationMs,
            status: "success",
            cached: durationMs < 40
          });
        }
        return res;
      })
      .catch((err: any) => {
        if (!signal.aborted) {
          console.error("[StructureService] PDB warmup failed:", err);
        }
        const durationMs = Math.round(performance.now() - pdbStart);
        const offsetMs = traceContext ? Math.max(0, Math.round(pdbStart - traceContext.traceStart)) : 0;
        if (traceContext?.activeTraceId) {
          traceContext.addTraceSpan({
            traceId: traceContext.activeTraceId,
            name: "PDB / AlphaFold 3D Coordinates Fetch",
            stage: "structure",
            startTime: Date.now() - durationMs,
            offsetMs,
            durationMs,
            status: "failed",
            error: err.message || "Failed to fetch 3D structure"
          });
        }
        return null;
      })
  );
}

export async function fetchHomologStructures(
  targetUniprot: string,
  apiClient: any,
  sink: Pick<PipelineStructureSink, "setHomologs" | "setIsHomologsLoading">,
  posOrSignal?: number | AbortSignal,
  signalOrTrace?: AbortSignal | TraceContext,
  traceContextArg?: TraceContext
): Promise<void> {
  const pos = typeof posOrSignal === "number" ? posOrSignal : undefined;
  const signal = posOrSignal instanceof AbortSignal ? posOrSignal : (signalOrTrace instanceof AbortSignal ? signalOrTrace : undefined);
  const traceContext = traceContextArg || (signalOrTrace && !(signalOrTrace instanceof AbortSignal) ? (signalOrTrace as TraceContext) : undefined);

  if (!targetUniprot || !targetUniprot.trim()) {
    sink.setIsHomologsLoading(false);
    sink.setHomologs([]);
    return;
  }
  sink.setIsHomologsLoading(true);
  sink.setHomologs([]);
  const startTime = performance.now();

  try {
    const homologsList = await apiClient.getHomologs(targetUniprot.trim(), pos, signal);
    const durationMs = Math.round(performance.now() - startTime);
    const offsetMs = traceContext ? Math.max(0, Math.round(startTime - traceContext.traceStart)) : 0;

    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "UniProt Homologous Structures Fetch",
        stage: "structure",
        startTime: Date.now() - durationMs,
        offsetMs,
        durationMs,
        status: "success",
        meta: { count: Array.isArray(homologsList) ? homologsList.length : 0 }
      });
    }

    if (!signal?.aborted && Array.isArray(homologsList)) {
      sink.setHomologs(homologsList);
    }
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    const offsetMs = traceContext ? Math.max(0, Math.round(startTime - traceContext.traceStart)) : 0;

    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "UniProt Homologous Structures Fetch",
        stage: "structure",
        startTime: Date.now() - durationMs,
        offsetMs,
        durationMs,
        status: "failed",
        error: err.message || "Failed to fetch homologs"
      });
    }
    if (!signal?.aborted && err.name !== "AbortError") {
      console.warn("[Homologs] Notice: Unable to retrieve homologous structures:", err.message || err);
      sink.setHomologs([]);
    }
  } finally {
    if (!signal?.aborted) {
      sink.setIsHomologsLoading(false);
    }
  }
}

export async function fetchBindingPocket(
  targetUniprot: string,
  residueIndex: number,
  pdbText: string,
  apiClient: any,
  sink: Pick<PipelineStructureSink, "setIsPocketLoading" | "setPocketError" | "setComputedPocket">,
  signal?: AbortSignal,
  traceContext?: TraceContext
): Promise<void> {
  const uniprotNorm = (targetUniprot || "").trim();
  const pdbNorm = (pdbText || "").trim();
  const hasValidPdb = pdbNorm.includes("ATOM") || pdbNorm.includes("HETATM");

  if ((!uniprotNorm && !hasValidPdb) || !residueIndex || isNaN(residueIndex) || residueIndex <= 0) {
    sink.setIsPocketLoading(false);
    sink.setComputedPocket(null);
    return;
  }

  sink.setIsPocketLoading(true);
  sink.setPocketError(null);
  const pocketStart = performance.now();

  try {
    const pocketParams: any = { mutIndex: residueIndex };
    if (uniprotNorm) {
      pocketParams.pdbRef = uniprotNorm;
      pocketParams.uniprotId = uniprotNorm;
    }
    if (hasValidPdb) {
      pocketParams.pdbText = pdbNorm;
    }
    const validatedData = await apiClient.findPocket(pocketParams, signal);
    const durationMs = Math.round(performance.now() - pocketStart);
    const offsetMs = traceContext ? Math.max(0, Math.round(pocketStart - traceContext.traceStart)) : 0;

    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "Binding Pocket & Cavity Detection",
        stage: "structure",
        startTime: Date.now() - durationMs,
        offsetMs,
        durationMs,
        status: "success",
        meta: { pocketCount: validatedData?.pocketResidues?.length ?? validatedData?.pockets?.length ?? 0 }
      });
    }
    if (!signal?.aborted) {
      sink.setComputedPocket(validatedData);
    }
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - pocketStart);
    const offsetMs = traceContext ? Math.max(0, Math.round(pocketStart - traceContext.traceStart)) : 0;

    if (traceContext?.activeTraceId) {
      traceContext.addTraceSpan({
        traceId: traceContext.activeTraceId,
        name: "Binding Pocket & Cavity Detection",
        stage: "structure",
        startTime: Date.now() - durationMs,
        offsetMs,
        durationMs,
        status: "failed",
        error: err.message || "Failed to find pocket"
      });
    }
    if (signal?.aborted) return;
    console.warn("[Pocket Finder] Pocket detection notice:", err.message || err);
    sink.setPocketError(err.message || "Failed to load pocket coordinates.");
  } finally {
    if (!signal?.aborted) {
      sink.setIsPocketLoading(false);
    }
  }
}

export async function fetchNearestResidues(
  targetUniprot: string,
  targetVariant: string,
  residueIndex: number,
  pdbText: string,
  apiClient: any,
  computedResiduesCache: Record<string, NearestResidue[]>,
  setComputedResiduesCache: React.Dispatch<React.SetStateAction<Record<string, NearestResidue[]>>>,
  pendingResiduesSet: Set<string>,
  signal?: AbortSignal
): Promise<void> {
  const cacheKey = `${targetUniprot}_${residueIndex}`;

  if (computedResiduesCache[cacheKey]) return;
  if (pendingResiduesSet.has(cacheKey)) return;

  pendingResiduesSet.add(cacheKey);
  try {
    const residuesParams: any = {
      targetIndex: residueIndex,
      distanceThreshold: 5
    };
    if (targetUniprot) {
      residuesParams.pdbRef = targetUniprot;
    } else {
      residuesParams.pdbText = pdbText;
    }
    const validatedData = await apiClient.getNearestResidues(residuesParams, signal);

    const mapped: NearestResidue[] = (validatedData.residues || []).map((r: any) => ({
      name: `${r.name}${r.index}`,
      distance: `${r.distance} Å`,
      properties: r.properties,
      role: r.role,
      classBadge: r.classBadge,
      source: "computed" as const
    }));

    if (!signal?.aborted) {
      setComputedResiduesCache(prev => {
        const next = { ...prev, [cacheKey]: mapped };
        const keys = Object.keys(next);
        if (keys.length > 200) {
          const oldestKey = keys[0];
          delete next[oldestKey];
        }
        return next;
      });
    }
  } catch (err: any) {
    if (!signal?.aborted) {
      console.error("Error fetching nearest residues:", err);
    }
  } finally {
    pendingResiduesSet.delete(cacheKey);
  }
}
