import { getDeduplicatedPromise } from "../../variantAnalysisUtils";
import { TraceContext } from "./types";
import { setCachedVariant } from "./variantCache";

export interface BiophysicalAnalysisParams {
  gene: string;
  variant: string;
  uniprotId: string;
}

export async function fetchBiophysicalAnalysis(
  params: BiophysicalAnalysisParams,
  apiClient: any,
  signal: AbortSignal,
  onChunk?: (chunkData: any) => void,
  traceContext?: TraceContext
): Promise<any> {
  const { gene, variant, uniprotId } = params;
  const bpKey = `biophysical_${gene}_${variant}_${uniprotId}`;
  const bpStart = performance.now();

  return getDeduplicatedPromise(bpKey, () => {
    const streamOrPromise = apiClient.streamBiophysicalAnalysis
      ? apiClient.streamBiophysicalAnalysis(
          { gene, variant, uniprotId },
          (chunkData: any) => {
            if (signal.aborted) return;
            if (onChunk) onChunk(chunkData);
          },
          signal
        )
      : apiClient.getBiophysicalAnalysis({ gene, variant, uniprotId }, signal);

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
              gnomadFrequency: { name: "Population Allele Frequency (gnomAD v4.0 GraphQL)", stage: "clinical" },
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
  console.log("[BiophysicalService] Starting progressive fetch for Landscape data...");
  apiClient
    .getLandscapeData(params, signal)
    .then((landscapeRes: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return;
      console.log("[BiophysicalService] Progressive Landscape data loaded successfully");
      setAnalysisState((prev: any) => {
        if (!prev.result) return prev;
        const updatedResult = {
          ...prev.result,
          landscapeData: landscapeRes.landscapeData
        };
        setCachedVariant(params.gene, params.variant, params.uniprotId, { analysisResult: updatedResult });
        return {
          ...prev,
          result: updatedResult
        };
      });
    })
    .catch((landErr: any) => {
      if (!signal.aborted) {
        console.warn("[BiophysicalService Warning] Progressive landscape fetch failed:", landErr);
      }
    });
}

export function fetchProgressiveStructuralAssessments(
  params: BiophysicalAnalysisParams & { acmgWeighting?: any; saprotEngine?: string },
  apiClient: any,
  signal: AbortSignal,
  setAnalysisState: (fn: any) => void,
  requestId: number,
  getActiveRequestId: () => number,
  traceContext?: TraceContext
): void {
  console.log("[BiophysicalService] Starting progressive fetch for heavy structural models...");
  apiClient
    .getStructuralAssessments(params, signal)
    .then((structRes: any) => {
      if (getActiveRequestId() !== requestId || signal.aborted) return;
      console.log("[BiophysicalService] Progressive heavy structural models response received:", structRes);

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
        } else {
          console.log(`[StructuralModel] ${modelName}: Successfully loaded.`);
        }
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
        const updatedResult = {
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
        };
        setCachedVariant(params.gene, params.variant, params.uniprotId, { analysisResult: updatedResult });
        return {
          ...prev,
          result: updatedResult
        };
      });
    })
    .catch((structErr: any) => {
      if (!signal.aborted) {
        console.error("[BiophysicalService Error] Progressive structural assessments fetch failed:", structErr);
        setAnalysisState((prev: any) => {
          if (!prev.result) return prev;
          const failureStatus: Record<string, string> = {
            esm3: "error",
            esmc: "error",
            esm2: "error",
            saprot: "error"
          };
          const mergedServiceStatus = {
            ...(prev.result.serviceStatus || prev.result.metadata?.serviceStatus || {}),
            ...failureStatus
          };
          return {
            ...prev,
            result: {
              ...prev.result,
              esm3Eval: { error: structErr.message || "Failed", status: "error" },
              esmcEval: { error: structErr.message || "Failed", status: "error" },
              esm2Eval: { error: structErr.message || "Failed", status: "error" },
              saprotEval: { error: structErr.message || "Failed", status: "error" },
              serviceStatus: mergedServiceStatus,
              metadata: {
                ...(prev.result.metadata || {}),
                serviceStatus: mergedServiceStatus
              }
            }
          };
        });
      }
    });
}
