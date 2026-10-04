import { getDeduplicatedPromise } from "../../variantAnalysisUtils";
import type { CoordinateLiftRecord } from "../../shared/contracts";
import { TraceContext } from "./types";
import { getCachedVariant, setCachedVariant, type CachedVariantBundle } from "./variantCache";
import { mergeResultPatch } from "./resultMerge";
import { deepModelEvidenceFor } from "../../shared/deepModelEvidence";

export interface BiophysicalAnalysisParams {
  gene: string;
  variant: string;
  uniprotId: string;
  acmgWeighting?: "standard" | "conservative" | "strict-structural";
  /**
   * Build the user's notation was expressed in, carried from the notation translation
   * step. Most coordinate-based evidence sources on the server are single-build, so this
   * decides which of them can be consulted at all — without it the server assumed GRCh38.
   */
  assembly?: "GRCh37" | "GRCh38";
  /**
   * The genomic coordinate the protein notation was translated from (hyphen form), sent
   * together with `assembly` only. Lets the server's predictor query VEP by position instead
   * of re-deriving the locus from protein HGVS (unmapping defect F-1).
   */
  genomicCoordinates?: string;
  /**
   * Verified canonical-build locus, produced when the submitted GRCh37 coordinate was lifted onto
   * GRCh38 and reverse-verified. Forwarded BESIDE `genomicCoordinates`/`assembly`, never instead of
   * them: the predictors query Ensembl VEP by coordinate, so handing them a GRCh37 position means
   * they lift it a second time (or a GRCh38-only source refuses it), while the verified canonical
   * pair is already on the build they need and cannot disagree with the annotation that produced the
   * protein substitution. A coordinate paired with the wrong build is the wrong-locus hazard.
   */
  liftedGenomicCoordinates?: string;
  /** Build the annotation actually came from; the build that belongs with `liftedGenomicCoordinates`. */
  resolvedAssembly?: "GRCh37" | "GRCh38";
  /** The reader's answer to an ambiguity refusal: these residue numbers ARE canonical. */
  numberingBasis?: string;
  /** Client-only ownership guard for progressive cache writes. */
  pipelineRunId?: string;
}

function ownsCachedAnalysis(cached: CachedVariantBundle | null, params: BiophysicalAnalysisParams): cached is CachedVariantBundle & { analysisResult: any } {
  return Boolean(cached?.analysisResult && (!params.pipelineRunId || cached.analysisResult.metadata?.pipelineRunId === params.pipelineRunId));
}

export async function fetchBiophysicalAnalysis(
  params: BiophysicalAnalysisParams,
  apiClient: any,
  signal: AbortSignal,
  onChunk?: (chunkData: any) => void,
  traceContext?: TraceContext
): Promise<any> {
  const { gene, variant, uniprotId, assembly, genomicCoordinates, numberingBasis } = params;
  const { liftedGenomicCoordinates, resolvedAssembly } = params;
  // Same protein notation can carry different verified loci or interpretation settings.
  const bpKey = `biophysical_${JSON.stringify(params)}`;
  const bpStart = performance.now();

  const requestBody = {
    gene,
    variant,
    uniprotId,
    ...(params.acmgWeighting ? { acmgWeighting: params.acmgWeighting } : {}),
    ...(assembly ? { assembly } : {}),
    ...(genomicCoordinates && assembly ? { genomicCoordinates } : {}),
    /**
     * The canonical pair travels BESIDE the submitted pair, never instead of it: the client states
     * what the reader submitted AND what the server verified it to be, and each is forwarded with its
     * own build. The predictors query Ensembl VEP by coordinate — a GRCh37 position handed over as
     * GRCh38 is the wrong-locus hazard, and one handed over as GRCh37 is re-lifted downstream or
     * refused by every GRCh38-only source. The verified canonical locus is already on the build they
     * need and cannot disagree with the annotation that produced the protein substitution.
     *
     * `coordinateLift` is deliberately NOT sent: the analysis route derives the build decision from
     * these facts itself. A disclosure accepted from a caller would be decoration rather than
     * evidence — anyone could post `{status:"lifted", reverseVerified:true}` and a surface would
     * print "verified" (see `deriveCoordinateLift`).
     */
    ...(liftedGenomicCoordinates ? { liftedGenomicCoordinates } : {}),
    ...(resolvedAssembly ? { resolvedAssembly } : {}),
    ...(numberingBasis ? { numberingBasis } : {})
  };

  /**
   * The run's signal is passed as the request's identity, so a re-query of the same variant
   * cannot be handed the promise the previous run's abort already doomed (see
   * `getDeduplicatedPromise`).
   */
  return getDeduplicatedPromise(bpKey, () => {
    const streamOrPromise = apiClient.streamBiophysicalAnalysis
      ? apiClient.streamBiophysicalAnalysis(
          requestBody,
          (chunkData: any) => {
            if (signal.aborted) return;
            if (onChunk) onChunk(chunkData);
          },
          signal
        )
      : apiClient.getBiophysicalAnalysis(requestBody, signal);

    return streamOrPromise
      .then((res: any) => {
        const durationMs = Math.round(performance.now() - bpStart);
        const offsetMs = traceContext ? Math.max(0, Math.round(bpStart - traceContext.traceStart)) : 0;
        if (traceContext?.activeTraceId) {
          traceContext.addTraceSpan({
            traceId: traceContext.activeTraceId,
            name: "Core evidence sources",
            stage: "biophysics",
            startTime: Date.now() - durationMs,
            offsetMs,
            durationMs,
            status: "success",
            ...(typeof (res?.metadata?.cacheHit ?? res?.cacheHit) === "boolean" ? { cached: res.metadata?.cacheHit ?? res.cacheHit } : {}),
            meta: { gene, variant, cacheLayer: res?.metadata?.cacheLayer ?? res?.cacheLayer ?? null }
          });

          // Feed granular server task sub-spans into the Waterfall
          const timings = res?.serviceTimings || res?.metadata?.serviceTimings;
          const statuses = res?.serviceStatus || res?.metadata?.serviceStatus;
          const timingOffsets = res?.serviceTimingOffsets || res?.metadata?.serviceTimingOffsets;
          if (timings && typeof timings === "object") {
            const serviceLabels: Record<string, { name: string; stage: "structure" | "biophysics" | "clinical" }> = {
              pdbMapping: { name: "3D Structure Homology Search (RCSB PDB / AlphaFold)", stage: "structure" },
              uniprotFeatures: { name: "Functional Domain Annotations (UniProtKB)", stage: "structure" },
              disruptionPredictor: { name: "3D Residue Microenvironment & Disruption Triage", stage: "structure" },
              predictorData: { name: "In-Silico Pathogenicity (dbNSFP / AlphaMissense / CADD)", stage: "biophysics" },
              conservationData: { name: "Evolutionary Conservation (ConSurf / REVEL / GERP++)", stage: "biophysics" },
              esm2: { name: "Zero-Shot ESM-2 Masked Marginal Likelihood", stage: "biophysics" },
              clinvar: { name: "ClinVar Clinical Interpretation (NCBI E-Utilities)", stage: "clinical" },
              gnomadFrequency: { name: "Population Allele Frequency (gnomAD r4 GraphQL)", stage: "clinical" },
              gnomadConstraint: { name: "Gene Constraint & Regional Missense (gnomAD)", stage: "clinical" },
              stringInteractions: { name: "Protein-Protein Interaction Network (STRING DB)", stage: "clinical" }
            };

            Object.entries(timings).forEach(([key, taskDurationMs]) => {
              const labelInfo = serviceLabels[key];
              if (labelInfo && typeof taskDurationMs === "number" && taskDurationMs >= 0) {
                const serviceState = statuses?.[key];
                const isFail = serviceState === "error" || serviceState === "timeout";
                const isUnavailable = serviceState === "unavailable";
                // A source that answered 200 with a failed state is invisible to the fetch interceptor,
                // so say so here — otherwise the span turns red and the Errors tab stays empty.
                if (isFail || isUnavailable) {
                  console.warn(`[Service] ${labelInfo.name}: ${serviceState}`);
                }
                // Server offsets describe SETTLEMENT, not start. Duration recovers the relative start.
                const taskOffset = typeof timingOffsets?.[key] === "number" ? Math.max(0, timingOffsets[key] - taskDurationMs) : 0;
                traceContext.addTraceSpan({
                  traceId: traceContext.activeTraceId,
                  name: `↳ ${labelInfo.name}`,
                  stage: labelInfo.stage,
                  startTime: Date.now() - durationMs + taskOffset,
                  offsetMs: offsetMs + taskOffset,
                  durationMs: taskDurationMs,
                  status: isFail ? "failed" : isUnavailable ? "unavailable" : "success",
                  meta: { serviceKey: key, status: statuses?.[key] || "ok" }
                });
              }
            });
          }
        }
        return res;
      })
      .catch((err: any) => {
        const durationMs = Math.round(performance.now() - bpStart);
        const offsetMs = traceContext ? Math.max(0, Math.round(bpStart - traceContext.traceStart)) : 0;
        if (traceContext?.activeTraceId) {
          traceContext.addTraceSpan({
            traceId: traceContext.activeTraceId,
            name: "Core evidence sources",
            stage: "biophysics",
            startTime: Date.now() - durationMs,
            offsetMs,
            durationMs,
            status: "failed",
            error: err.message || "Biophysical analysis failed"
          });
        }
        if (!signal.aborted && err.name !== "AbortError") {
          console.error("[BiophysicalService] Biophysical analysis failed:", err);
        }
        throw err;
      });
  }, signal);
}

export function fetchProgressiveLandscape(
  params: BiophysicalAnalysisParams,
  apiClient: any,
  signal: AbortSignal,
  setAnalysisState: (fn: any) => void,
  requestId: number,
  getActiveRequestId: () => number
): Promise<void> {
  if (typeof apiClient.getLandscapeData !== "function") {
    setAnalysisState((prev: any) => mergeResultPatch(prev, {}, undefined, "landscape", "skipped"));
    return Promise.resolve();
  }
  return apiClient
    .getLandscapeData(params, signal)
    .then((landscapeRes: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return;
      if (!Array.isArray(landscapeRes?.landscapeData)) throw new Error("Landscape response did not contain a residue array");
      setAnalysisState((prev: any) => mergeResultPatch(prev, {
        landscapeData: landscapeRes.landscapeData,
        landscapeMeta: landscapeRes.landscapeMeta ?? null
      }, undefined, "landscape", "complete"));
      const cached = getCachedVariant(params.gene, params.variant);
      if (ownsCachedAnalysis(cached, params)) {
        setCachedVariant(params.gene, params.variant, params.uniprotId, {
          analysisResult: mergeResultPatch({ result: cached.analysisResult }, {
            landscapeData: landscapeRes.landscapeData,
            landscapeMeta: landscapeRes.landscapeMeta ?? null
          }, undefined, "landscape", "complete").result
        });
      }
    })
    .catch((landErr: any) => {
      if (!signal.aborted && getActiveRequestId() === requestId) {
        setAnalysisState((prev: any) => mergeResultPatch(prev, {}, undefined, "landscape", "error"));
        console.warn("[BiophysicalService Warning] Progressive landscape fetch failed:", landErr);
      }
    });
}

export function fetchProgressiveMultimer(
  params: BiophysicalAnalysisParams,
  fetchWithAuth: (url: string, options?: any) => Promise<Response>,
  signal: AbortSignal,
  setAnalysisState: (fn: any) => void,
  requestId: number,
  getActiveRequestId: () => number
): Promise<any> {
  const { gene, variant, uniprotId } = params;
  if (!gene || !variant || !uniprotId) return Promise.resolve(null);

  const multimerKey = `multimer_${gene}_${variant}_${uniprotId}`;
  // Same identity rule as the analysis stream: an aborted run's request must never be inherited by
  // the run that replaced it.
  return getDeduplicatedPromise(multimerKey, async () => {
    const response = await fetchWithAuth("/api/v1/structure/multimer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gene, variant, uniprotId }),
      signal
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch multimer data (${response.status})`);
    }
    return response.json();
  }, signal)
    .then((data: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return data;
      if (data) {
        setAnalysisState((prev: any) => mergeResultPatch(prev, { multimerData: data }, undefined, "multimer", "complete"));
        const cached = getCachedVariant(gene, variant);
        if (ownsCachedAnalysis(cached, params)) {
          setCachedVariant(gene, variant, uniprotId, {
            analysisResult: mergeResultPatch({ result: cached.analysisResult }, { multimerData: data }, undefined, "multimer", "complete").result
          });
        }
      }
      return data;
    })
    .catch((err: any) => {
      if (!signal.aborted && err.name !== "AbortError" && getActiveRequestId() === requestId) {
        setAnalysisState((prev: any) => mergeResultPatch(prev, {}, undefined, "multimer", "error"));
        console.warn("[BiophysicalService Warning] Progressive multimer fetch failed:", err);
      }
      return null;
    });
}

/**
 * The partner lookups (UniProt curated partners, IntAct methods and studies, STRING's physical and
 * functional networks, mapped sites) are prefetched with the assembly, exactly like
 * `fetchProgressiveMultimer`. Before this, the Interfaces & PPI tab alone issued the request on
 * mount, so a reader who opened the tab long after the run finished watched "Partners / STRING /
 * Curation" spin up cold against RCSB, UniProt, IntAct and STRING — the defect this fixes.
 *
 * The dedupe key is shared with `useInterfacesData`'s `fetchLookups`, so a tab opened while the
 * prefetch is still in flight joins the same request instead of issuing a second one. DDMut-PPI and
 * the Boltz-2 model stay on request: only the lookups are prefetched.
 */
export function fetchProgressivePpi(
  params: BiophysicalAnalysisParams,
  fetchWithAuth: (url: string, options?: any) => Promise<Response>,
  signal: AbortSignal,
  setAnalysisState: (fn: any) => void,
  requestId: number,
  getActiveRequestId: () => number
): Promise<any> {
  const { gene, variant, uniprotId } = params;
  if (!gene || !variant || !uniprotId) return Promise.resolve(null);

  const ppiKey = `ppi_${gene}_${variant}_${uniprotId}`;
  return getDeduplicatedPromise(ppiKey, async () => {
    const response = await fetchWithAuth("/api/v1/ppi/binding-affinity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gene, variant, uniprotId }),
      signal
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch interaction lookups (${response.status})`);
    }
    return response.json();
  }, signal)
    .then((data: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return data;
      if (data) {
        setAnalysisState((prev: any) => mergeResultPatch(prev, { ppiBindingData: data }, undefined, "ppi", "complete"));
        const cached = getCachedVariant(gene, variant);
        if (ownsCachedAnalysis(cached, params)) {
          setCachedVariant(gene, variant, uniprotId, {
            analysisResult: mergeResultPatch({ result: cached.analysisResult }, { ppiBindingData: data }, undefined, "ppi", "complete").result
          });
        }
      }
      return data;
    })
    .catch((err: any) => {
      if (!signal.aborted && err.name !== "AbortError" && getActiveRequestId() === requestId) {
        setAnalysisState((prev: any) => mergeResultPatch(prev, {}, undefined, "ppi", "error"));
        console.warn("[BiophysicalService Warning] Progressive PPI lookup fetch failed:", err);
      }
      return null;
    });
}

export function fetchProgressiveStructuralAssessments(
  params: BiophysicalAnalysisParams & { acmgWeighting?: any; saprotEngine?: string },
  apiClient: any,
  signal: AbortSignal,
  setAnalysisState: (fn: any) => void,
  requestId: number,
  getActiveRequestId: () => number,
  traceContext?: TraceContext,
  setIsStructuralLoading?: (loading: boolean) => void
): Promise<void> {
  if (typeof apiClient.getStructuralAssessments !== "function") {
    setIsStructuralLoading?.(false);
    setAnalysisState((prev: any) => mergeResultPatch(prev, {}, undefined, "structural", "skipped"));
    return Promise.resolve();
  }
  setIsStructuralLoading?.(true);
  const structuralStart = performance.now();
  const addStructuralSpan = (status: "success" | "failed" | "unavailable", error?: string) => {
    if (!traceContext?.activeTraceId) return;
    const durationMs = Math.round(performance.now() - structuralStart);
    traceContext.addTraceSpan({
      traceId: traceContext.activeTraceId, name: "Deep Language Models (ESM3, ESMC, ESM-2, SaProt)",
      stage: "biophysics", startTime: Date.now() - durationMs,
      offsetMs: Math.max(0, Math.round(structuralStart - traceContext.traceStart)), durationMs, status, ...(error ? { error } : {})
    });
  };
  return apiClient
    .getStructuralAssessments(params, signal)
    .then((structRes: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return;
      if (!structRes || typeof structRes !== "object") throw new Error("Structural evaluation returned no result");
      setIsStructuralLoading?.(false);

      // Reuse the scientific projection's actual computed/absent outcome, not HTTP 200 or a token placeholder.
      const observations = deepModelEvidenceFor(structRes, { saprotEngine: params.saprotEngine }).observations;
      const modelEntries = [
        ["saprot", "saprot", structRes.saprotEval], ["esm2Eval", "esm2", structRes.esm2Eval],
        ["esmc", "esmc", structRes.esmcEval], ["esm3", "esm3", structRes.esm3Eval]
      ] as const;
      const failedModels: string[] = [];
      const timings = structRes.structuralTimings ?? structRes.metadata?.structuralTimings;
      const offsets = structRes.structuralTimingOffsets ?? structRes.metadata?.structuralTimingOffsets;
      for (const [key, id, evaluation] of modelEntries) {
        const observation = observations.find(item => item.id === id)!;
        const computed = observation.state === "computed";
        const outcome = structRes.serviceStatus?.[key] ?? evaluation?.status ?? observation.state;
        if (!computed) {
          failedModels.push(`${observation.source} (${outcome})`);
          console.warn(`[StructuralModel] ${observation.source}: ${evaluation?.error || outcome}`);
        }
        const durationMs = timings?.[key];
        if (traceContext?.activeTraceId && Number.isFinite(durationMs) && durationMs >= 0) {
          const startOffset = Number.isFinite(offsets?.[key]) ? Math.max(0, offsets[key] - durationMs) : 0;
          const clientOffset = Math.max(0, structuralStart - traceContext.traceStart);
          traceContext.addTraceSpan({
            traceId: traceContext.activeTraceId, name: `↳ ${observation.source}`, stage: "biophysics",
            startTime: Date.now() - (performance.now() - structuralStart) + startOffset,
            offsetMs: Math.round(clientOffset + startOffset), durationMs,
            status: computed ? "success" : outcome === "error" || outcome === "timeout" ? "failed" : "unavailable",
            meta: { serviceKey: key, status: outcome, modelProvenance: observation.provenance }
          });
        }
      }
      addStructuralSpan(failedModels.length === modelEntries.length ? "unavailable" : "success");

      if (failedModels.length === modelEntries.length) {
        console.error(
          `[StructuralAnalysis] All deep language model evaluations failed or timed out.\n` +
          `Failed models: ${failedModels.join(", ")}\n` +
          `Remedy (Local): Run 'python -m uv run --project tools python tools/model_server.py'\n` +
          `Remedy (OCI): Set SIDECAR_URL=http://<oci-private-or-public-ip>:8000 in your .env or system environment.`
        );
      }

      setAnalysisState((prev: any) => mergeResultPatch(prev, {
        esm3Eval: structRes.esm3Eval, esmcEval: structRes.esmcEval,
        esm2Eval: structRes.esm2Eval, saprotEval: structRes.saprotEval,
        metadata: { structuralTimings: timings, structuralTimingOffsets: offsets },
        serviceStatus: structRes.serviceStatus ?? {},
        ...(structRes.ruleBasedInsights ? { ruleBasedInsights: structRes.ruleBasedInsights } : {})
      }, undefined, "structural", failedModels.length ? "degraded" : "complete"));

      const cached = getCachedVariant(params.gene, params.variant);
      if (ownsCachedAnalysis(cached, params)) {
        setCachedVariant(params.gene, params.variant, params.uniprotId, {
          analysisResult: mergeResultPatch({ result: cached.analysisResult }, {
            esm3Eval: structRes.esm3Eval, esmcEval: structRes.esmcEval,
            esm2Eval: structRes.esm2Eval, saprotEval: structRes.saprotEval,
            metadata: { structuralTimings: timings, structuralTimingOffsets: offsets },
        serviceStatus: structRes.serviceStatus ?? {},
            ...(structRes.ruleBasedInsights ? { ruleBasedInsights: structRes.ruleBasedInsights } : {})
          }, undefined, "structural", failedModels.length ? "degraded" : "complete").result
        });
      }
    })
    .catch((structErr: any) => {
      if (
        getActiveRequestId() !== requestId ||
        signal.aborted ||
        structErr.name === "AbortError"
      ) {
        return;
      }
      setIsStructuralLoading?.(false);

      const isTimeout = structErr.name === "TimeoutError" || structErr.message?.includes("timed out");
      const errMessage = isTimeout
        ? "Structural evaluation timed out (server busy) — click Check & Retry to resume."
        : (structErr.message || "Failed");

      addStructuralSpan("failed", errMessage);
      console.error("[BiophysicalService Error] Progressive structural assessments fetch failed:", structErr);
      setAnalysisState((prev: any) => {
        if (!prev.result) return prev;
        const failureStatus: Record<string, string> = {
          esm3: isTimeout ? "timeout" : "error",
          esmc: isTimeout ? "timeout" : "error",
          esm2Eval: isTimeout ? "timeout" : "error",
          saprot: isTimeout ? "timeout" : "error"
        };
        const mergedServiceStatus = {
          ...(prev.result.serviceStatus || prev.result.metadata?.serviceStatus || {}),
          ...failureStatus
        };
        return {
          ...prev,
          result: {
            ...prev.result,
            esm3Eval: { error: errMessage, status: isTimeout ? "timeout" : "error" },
            esmcEval: { error: errMessage, status: isTimeout ? "timeout" : "error" },
            esm2Eval: { error: errMessage, status: isTimeout ? "timeout" : "error" },
            saprotEval: { error: errMessage, status: isTimeout ? "timeout" : "error" },
            serviceStatus: mergedServiceStatus,
            metadata: {
              ...(prev.result.metadata || {}),
              serviceStatus: mergedServiceStatus,
              pipelineStages: { ...prev.result.metadata?.pipelineStages, structural: "error" }
            }
          }
        };
      });
    });
}
