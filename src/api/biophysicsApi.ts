import {
  biophysicalAnalysisResponseSchema,
  BiophysicalAnalysisResponse,
  landscapeOverviewResponseSchema,
  landscapeContextResponseSchema,
  type LandscapeContext,
  type LandscapeMeta,
  type LandscapeOverview,
  type LandscapeResidueItem
} from "../shared/contracts";
import { CLIENT_STREAM_IDLE_BUDGET_MS, CLIENT_STRUCTURAL_REQUEST_BUDGET_MS } from "../shared/timeouts";
import type { StructuralModelFrame } from "../shared/structuralStream";
import { extractApiError, extractErrorMessage, FetchWithAuth, noteCredentialHeader, noteStaleDataHeader } from "./authSession";
import { encodeStaleData, parseStaleData } from "../shared/providerLimits";
import { encodeCredentialUse, parseCredentialUse } from "../shared/credentials";

/** A `{type: "credentials"}` frame's uses, validated exactly like the header's (WP-I4). */
function noteCredentialFrame(uses: unknown): void {
  noteCredentialHeader(encodeCredentialUse(parseCredentialUse(JSON.stringify(uses ?? null))));
}

/** A `{type: "stale"}` frame's notes, validated exactly like the header's. */
function noteStaleDataFrame(notes: unknown): void {
  noteStaleDataHeader(encodeStaleData(parseStaleData(JSON.stringify(notes ?? null))));
}

/**
 * Reads an NDJSON response one frame at a time and hands each DATA frame to `onFrame`.
 *
 * Shared by every streaming call, so the rules below cannot drift between them:
 *  - an `error` frame ends the read with that message;
 *  - a `heartbeat` is liveness only, never data: reaching it at all re-arms the stall bound;
 *  - `stale` and `credentials` frames are notices (WP-I2, WP-I4), noted and not passed on;
 *  - a last frame with no trailing newline is still parsed (a cut-off one is reported and dropped).
 */
async function readNdjsonFrames(
  res: Response,
  signal: AbortSignal | undefined,
  abortMessage: string,
  onFrame: (frame: any) => void
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Streaming not supported by browser environment.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  /**
   * How long the stream may be COMPLETELY silent before it is treated as dead.
   *
   * Shared with the server, and related to its heartbeat by construction rather than by
   * careful editing: `server/tests/stream-heartbeat-budget.test.ts` fails if this bound ever
   * comes within a few heartbeats of the server's emission interval. It previously carried its
   * own 30 s literal while the server was allowed 45 s of legitimate silence between data
   * chunks, so a healthy slow run was reported as "Streaming connection stalled" — measured by
   * feeding the real function one chunk and then 31 s of silence.
   */
  const idleBudgetMs = CLIENT_STREAM_IDLE_BUDGET_MS;

  const dispatch = (parsed: any): void => {
    if (parsed.type === "error") {
      throw new Error(parsed.error || "Stream error");
    }
    /**
     * Liveness only — no data, and deliberately nothing to merge. The read resolved, which re-arms
     * the stall bound and proves the body alive; forwarding a heartbeat would spread
     * `{type:"heartbeat"}` into the analysis result.
     */
    if (parsed.type === "heartbeat") {
      return;
    }
    // Saved data past its expiry was used (WP-I2); same notice as the `X-MSE-Stale` header.
    if (parsed.type === "stale") {
      noteStaleDataFrame(parsed.notes);
      return;
    }
    if (parsed.type === "credentials") {
      noteCredentialFrame(parsed.uses);
      return;
    }
    onFrame(parsed);
  };

  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Streaming connection stalled: no data received for ${idleBudgetMs / 1000}s.`));
        }, idleBudgetMs);
      });

      const abortPromise = new Promise<never>((_, reject) => {
        if (signal?.aborted) {
          reject(new Error(abortMessage));
          return;
        }
        if (signal) {
          abortListener = () => reject(new Error(abortMessage));
          signal.addEventListener("abort", abortListener, { once: true });
        }
      });

      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await Promise.race([
          reader.read(),
          timeoutPromise,
          abortPromise
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
      }

      const { done, value } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch (err: any) {
          console.warn("[Stream Parse Warning]:", err);
          continue;
        }
        dispatch(parsed);
      }
    }
  } catch (err) {
    try {
      await reader.cancel();
    } catch (_) {}
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {}
  }

  if (buffer.trim()) {
    let parsed: any;
    try {
      parsed = JSON.parse(buffer);
    } catch (err) {
      // A cut-off final frame can carry the payload; losing it silently leaves a partial result.
      console.warn("[Stream Parse Warning] The final stream frame was not valid JSON and was dropped:", err);
    }
    if (parsed) dispatch(parsed);
  }
}

export function createBiophysicsApi(fetchWithAuth: FetchWithAuth) {
  return {
    async getBiophysicalAnalysis(
      params: {
        gene: string;
        uniprotId: string;
        variant: string;
        wtPdb?: string;
        assembly?: string;
        genomicCoordinates?: string;
        /**
         * Verified canonical-build locus and the build the annotation came from, forwarded beside
         * the submitted pair. The server's predictors query VEP by coordinate, so a coordinate
         * paired with the wrong build is the wrong-locus hazard — the canonical pair is already on
         * the build they need and cannot disagree with the annotation that produced the substitution.
         *
         * There is deliberately no coordinateLift here: the route derives the decision from these
         * facts, so a caller cannot assert a "verified" lift the server never performed.
         */
        liftedGenomicCoordinates?: string;
        resolvedAssembly?: string;
        numberingBasis?: string;
        options?: any;
      },
      signal?: AbortSignal
    ): Promise<BiophysicalAnalysisResponse> {
      const res = await fetchWithAuth("/api/v1/analyze-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 90000,
        signal
      });
      if (!res.ok) {
        // `extractApiError` rather than `extractErrorMessage`: the analysis route refuses a
        // genuinely ambiguous protein notation with `code` + `details.candidates`, and flattening it
        // to a string here is what turned that decision into a dead end.
        throw await extractApiError(res, "Failed to get biophysical analysis");
      }
      const data = await res.json();
      return biophysicalAnalysisResponseSchema.parse(data);
    },

    async streamBiophysicalAnalysis(
      params: {
        gene: string;
        uniprotId: string;
        variant: string;
        acmgWeighting?: string;
        assembly?: string;
        genomicCoordinates?: string;
        /** Same canonical-pair provenance as `getBiophysicalAnalysis` — see the note there. */
        liftedGenomicCoordinates?: string;
        resolvedAssembly?: string;
        numberingBasis?: string;
        options?: any;
      },
      onChunk: (chunk: any) => void,
      signal?: AbortSignal
    ): Promise<BiophysicalAnalysisResponse> {
      const res = await fetchWithAuth("/api/v1/analyze-variant/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 90000,
        signal
      });
      if (!res.ok) {
        // The pipeline PREFERS this method whenever it exists (it always does), so flattening the
        // error here is what made the ambiguity refusal unreachable: `code` and `details.candidates`
        // never survived to a component that could offer the reader a choice.
        throw await extractApiError(res, "Failed to stream biophysical analysis");
      }

      let finalPayload: any = null;
      await readNdjsonFrames(res, signal, "Biophysical analysis stream aborted by client.", parsed => {
        if (parsed.isFinal || parsed.type === "full") {
          finalPayload = parsed.data || parsed.payload;
        }
        onChunk(parsed.data || parsed.payload || parsed);
      });

      return biophysicalAnalysisResponseSchema.parse(finalPayload);
    },

    /** `landscapeWindow` loads a named residue range instead of the default ±25 around the variant. */
    async getLandscapeData(
      params: { gene: string; uniprotId: string; variant: string; landscapeWindow?: { start: number; end: number } },
      signal?: AbortSignal
    ): Promise<{ landscapeData: LandscapeResidueItem[]; landscapeMeta?: LandscapeMeta | null }> {
      const res = await fetchWithAuth("/api/v1/analyze-variant/landscape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 130000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to get landscape data");
        throw new Error(errorMsg);
      }
      return await res.json();
    },

    /** Whole-protein residue summaries. Returns immediately without waiting on external context. */
    async getLandscapeOverview(
      params: { gene: string; uniprotId: string; variant: string },
      signal?: AbortSignal
    ): Promise<LandscapeOverview> {
      const res = await fetchWithAuth("/api/v1/analyze-variant/landscape-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 130000,
        signal
      });
      if (!res.ok) {
        throw new Error(await extractErrorMessage(res, "Failed to get the landscape overview"));
      }
      return landscapeOverviewResponseSchema.parse(await res.json());
    },

    /** Gene-wide ClinVar, gnomAD and regional constraint context for the Landscape overview. */
    async getLandscapeContext(
      params: { gene: string; uniprotId: string; variant: string; transcript?: string | null },
      signal?: AbortSignal
    ): Promise<{ context: LandscapeContext }> {
      const res = await fetchWithAuth("/api/v1/analyze-variant/landscape-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 60000,
        signal
      });
      if (!res.ok) {
        throw new Error(await extractErrorMessage(res, "Failed to get the landscape context"));
      }
      return landscapeContextResponseSchema.parse(await res.json());
    },

    /**
     * The four deep models, streamed: `onModel` is called with each model the moment the server has
     * it, and the promise resolves with the complete result (the `final` frame) once the server is
     * done. A caller that passes no `onModel` still gets the complete result, as before.
     *
     * There is no total time limit here on purpose (see `CLIENT_STRUCTURAL_REQUEST_BUDGET_MS`): the
     * stream stays open while the server heartbeats, so a slow model cannot cost the reader a fast one.
     */
    async getStructuralAssessments(
      params: { gene: string; uniprotId: string; variant: string; acmgWeighting?: string; saprotEngine?: string },
      signal?: AbortSignal,
      onModel?: (frame: StructuralModelFrame) => void
    ): Promise<{
      disruptionPredictor?: import("../shared/contracts").DisruptionPredictorResult;
      esm3Eval: any;
      esmcEval: any;
      esm2Eval: any;
      saprotEval: any;
      ruleBasedInsights: any;
    }> {
      const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/x-ndjson" };
      if (params.saprotEngine) {
        headers["X-SaProt-Engine"] = params.saprotEngine;
      }
      const res = await fetchWithAuth("/api/v1/analyze-variant/structural", {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        timeout: CLIENT_STRUCTURAL_REQUEST_BUDGET_MS,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to get structural assessments");
        throw new Error(errorMsg);
      }
      // A server that still answers with one JSON body (an older build) is understood as before.
      if (!res.headers.get("content-type")?.includes("application/x-ndjson")) {
        return await res.json();
      }

      let finalPayload: any = null;
      await readNdjsonFrames(res, signal, "Structural assessment stream aborted by client.", frame => {
        if (frame.type === "model") onModel?.(frame as StructuralModelFrame);
        else if (frame.type === "final") finalPayload = frame.data;
      });
      if (!finalPayload) {
        throw new Error("The structural stream ended before its final result.");
      }
      return finalPayload;
    }
  };
}
