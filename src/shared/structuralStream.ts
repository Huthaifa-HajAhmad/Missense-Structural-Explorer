/**
 * structuralStream.ts — the frames of `POST /api/v1/analyze-variant/structural` when it streams.
 *
 * The route streams only when the request says `Accept: application/x-ndjson`; any other caller still
 * gets the one buffered JSON body, unchanged. Each line of the stream is one JSON object:
 *
 *   { type: "model", key, evaluation, status, durationMs }   one deep model settled
 *   { type: "heartbeat" }                                     liveness only, no data
 *   { type: "final", data }                                   the same object the buffered body carries
 *   { type: "error", error }                                  the run itself failed (not one model)
 *
 * A `model` frame carries the value the final payload will hold under `<field>`, so a reader may
 * show it at once and the `final` frame stays the authority. This file is shared by the server (which
 * writes the frames) and the client (which reads them), so the two cannot disagree about a key name.
 */

/** The keys `serviceStatus` uses for the four deep models. */
export type StructuralModelKey = "esm3" | "esmc" | "esm2Eval" | "saprot";

export type StructuralModelStatus = "ok" | "error" | "timeout" | "offline";

/** Which field of the structural payload each model's result lives in. */
export const STRUCTURAL_MODEL_FIELDS = {
  esm3: "esm3Eval",
  esmc: "esmcEval",
  esm2Eval: "esm2Eval",
  saprot: "saprotEval"
} as const satisfies Record<StructuralModelKey, string>;

export const STRUCTURAL_MODEL_KEYS = Object.keys(STRUCTURAL_MODEL_FIELDS) as StructuralModelKey[];

export interface StructuralModelFrame {
  type: "model";
  key: StructuralModelKey;
  /** The model's result, or its `{ error, status }` object when it failed or timed out. */
  evaluation: unknown;
  status: StructuralModelStatus;
  /** How long the run waited for this model (never more than the model budget). */
  durationMs: number;
}

/** What the server writes. (`error` frames are written by the route, which owns the transport.) */
export type StructuralStreamFrame =
  | StructuralModelFrame
  | { type: "heartbeat" }
  | { type: "final"; data: unknown };
