import { getDeduplicatedPromise } from "../../variantAnalysisUtils";
import { TraceContext } from "./types";
import { getCachedVariant, setCachedVariant } from "./variantCache";

export interface BiophysicalAnalysisParams {
  gene: string;
  variant: string;
  uniprotId: string;
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
  /** The reader's answer to an ambiguity refusal: these residue numbers ARE canonical. */
  numberingBasis?: string;
}

export async function fetchBiophysicalAnalysis(
  params: BiophysicalAnalysisParams,
  apiClient: any,
  signal: AbortSignal,
  onChunk?: (chunkData: any) => void,
  traceContext?: TraceContext
): Promise<any> {
  const { gene, variant, uniprotId, assembly, genomicCoordinates, numberingBasis } = params;
  const bpKey = `biophysical_${gene}_${variant}_${uniprotId}`;
  const bpStart = performance.now();

  const requestBody = {
    gene,
    variant,
    uniprotId,
    ...(assembly ? { assembly } : {}),
    ...(genomicCoordinates && assembly ? { genomicCoordinates } : {}),
    ...(numberingBasis ? { numberingBasis } : {})
  };

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
            name: "Multi-Model Biophysics Suite (ESM-2, SaProt, ClinVar, gnomAD)",
            stage: "biophysics",
            startTime: Date.now() - durationMs,
            offsetMs,
            durationMs,
            status: "success",
            meta: { gene, variant }
          });

          // Feed granular server task sub-spans into the Waterfall
          const timings = res?.serviceTimings || res?.metadata?.serviceTimings;
          const statuses = res?.serviceStatus || res?.metadata?.serviceStatus;
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
                const isFail = statuses?.[key] === "error" || statuses?.[key] === "timeout";
                traceContext.addTraceSpan({
                  traceId: traceContext.activeTraceId,
                  name: `↳ ${labelInfo.name}`,
                  stage: labelInfo.stage,
                  startTime: Date.now() - durationMs,
                  offsetMs,
                  durationMs: taskDurationMs,
                  status: isFail ? "failed" : "success",
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
            name: "Multi-Model Biophysics Suite (ESM-2, SaProt, ClinVar, gnomAD)",
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
  });
}

export function fetchProgressiveLandscape(
  params: BiophysicalAnalysisParams,
  apiClient: any,
  signal: AbortSignal,
  setAnalysisState: (fn: any) => void,
  requestId: number,
  getActiveRequestId: () => number
): void {
  apiClient
    .getLandscapeData(params, signal)
    .then((landscapeRes: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return;
      setAnalysisState((prev: any) => {
        if (!prev.result) return prev;
        return {
          ...prev,
          result: {
            ...prev.result,
            landscapeData: landscapeRes.landscapeData
          }
        };
      });
      const cached = getCachedVariant(params.gene, params.variant);
      if (cached?.analysisResult) {
        setCachedVariant(params.gene, params.variant, params.uniprotId, {
          analysisResult: {
            ...cached.analysisResult,
            landscapeData: landscapeRes.landscapeData
          }
        });
      }
    })
    .catch((landErr: any) => {
      if (!signal.aborted) {
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
  })
    .then((data: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return data;
      if (data) {
        setAnalysisState((prev: any) => {
          if (!prev.result) return prev;
          return {
            ...prev,
            result: {
              ...prev.result,
              multimerData: data
            }
          };
        });
        const cached = getCachedVariant(gene, variant);
        if (cached?.analysisResult) {
          setCachedVariant(gene, variant, uniprotId, {
            analysisResult: {
              ...cached.analysisResult,
              multimerData: data
            }
          });
        }
      }
      return data;
    })
    .catch((err: any) => {
      if (!signal.aborted && err.name !== "AbortError") {
        console.warn("[BiophysicalService Warning] Progressive multimer fetch failed:", err);
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
  setIsStructuralLoading?.(true);
  return apiClient
    .getStructuralAssessments(params, signal)
    .then((structRes: any) => {
      if (
        getActiveRequestId() !== requestId ||
        signal.aborted ||
        !structRes ||
        typeof structRes !== "object"
      ) {
        return;
      }
      setIsStructuralLoading?.(false);

      if (traceContext?.activeTraceId) {
        traceContext.addTraceSpan({
          traceId: traceContext.activeTraceId,
          name: "Deep Language Models (ESM3, ESMC, SaProt)",
          stage: "biophysics",
          startTime: Date.now() - 50,
          offsetMs: 0,
          durationMs: 50,
          status: "success"
        });
      }

      // DevConsole diagnostics: inspect each structural model and emit clear diagnostic warnings/errors
      const modelEntries: [string, any][] = [
        ["SaProt 650M AF2", structRes.saprotEval],
        ["ESM-2 3B", structRes.esm2Eval],
        ["ESMC-6B / VESM-150M", structRes.esmcEval],
        ["ESM3", structRes.esm3Eval]
      ];

      const failedModels: string[] = [];
      for (const [modelName, evalResult] of modelEntries) {
        if (!evalResult) {
          failedModels.push(`${modelName} (no data returned)`);
          console.warn(`[StructuralModel] ${modelName}: No evaluation data returned (likely offline).`);
        } else if ("error" in evalResult && evalResult.error) {
          failedModels.push(`${modelName} (${evalResult.status || "error"}: ${evalResult.error})`);
          console.warn(`[StructuralModel] ${modelName} failed (${evalResult.status || "error"}): ${evalResult.error}`);
        }
        // Successes need no log line: the payload is rendered by the structure panel.
      }

      if (failedModels.length === modelEntries.length) {
        console.error(
          `[StructuralAnalysis] All deep language model evaluations failed or timed out.\n` +
          `Failed models: ${failedModels.join(", ")}\n` +
          `Remedy (Local): Run 'python -m uv run --project tools python tools/model_server.py'\n` +
          `Remedy (OCI): Set SIDECAR_URL=http://<oci-private-or-public-ip>:8000 in your .env or system environment.`
        );
      }

      setAnalysisState((prev: any) => {
        if (!prev.result) return prev;
        const mergedServiceStatus = {
          ...(prev.result.serviceStatus || prev.result.metadata?.serviceStatus || {}),
          ...(structRes.serviceStatus || {})
        };
        return {
          ...prev,
          result: {
            ...prev.result,
            esm3Eval: structRes.esm3Eval,
            esmcEval: structRes.esmcEval,
            esm2Eval: structRes.esm2Eval,
            saprotEval: structRes.saprotEval,
            serviceStatus: mergedServiceStatus,
            metadata: {
              ...(prev.result.metadata || {}),
              serviceStatus: mergedServiceStatus
            },
            ruleBasedInsights: structRes.ruleBasedInsights || prev.result.ruleBasedInsights
          }
        };
      });

      const cached = getCachedVariant(params.gene, params.variant);
      if (cached?.analysisResult) {
        const mergedServiceStatus = {
          ...(cached.analysisResult.serviceStatus || cached.analysisResult.metadata?.serviceStatus || {}),
          ...(structRes.serviceStatus || {})
        };
        setCachedVariant(params.gene, params.variant, params.uniprotId, {
          analysisResult: {
            ...cached.analysisResult,
            esm3Eval: structRes.esm3Eval,
            esmcEval: structRes.esmcEval,
            esm2Eval: structRes.esm2Eval,
            saprotEval: structRes.saprotEval,
            serviceStatus: mergedServiceStatus,
            metadata: {
              ...(cached.analysisResult.metadata || {}),
              serviceStatus: mergedServiceStatus
            },
            ruleBasedInsights: structRes.ruleBasedInsights || cached.analysisResult.ruleBasedInsights
          }
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

      console.error("[BiophysicalService Error] Progressive structural assessments fetch failed:", structErr);
      setAnalysisState((prev: any) => {
        if (!prev.result) return prev;
        const failureStatus: Record<string, string> = {
          esm3: isTimeout ? "timeout" : "error",
          esmc: isTimeout ? "timeout" : "error",
          esm2: isTimeout ? "timeout" : "error",
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
              serviceStatus: mergedServiceStatus
            }
          }
        };
      });
    });
}
