/**
 * structuralStream.ts — the frames of `POST /api/v1/analyze-variant/structural` when it streams.
 *
 * The route streams only when the request says `Accept: application/x-ndjson`; any other caller still
 * gets the one buffered JSON body, unchanged. Each line of the stream is one JSON object:
 *
 *   { type: "heartbeat" }                                     liveness only, no data
 *   { type: "final", data }                                   the same object the buffered body carries
 *   { type: "error", error }                                  the run itself failed (not one model)
 *
 * This file is shared by the server (which writes the frames) and the client (which reads them), so
 * the two cannot disagree about a frame shape. Runs before 2026-11-18 also streamed one `model` frame
 * per protein language model; those models were retired and a reader ignores unknown frames.
 */

/** What the server writes. (`error` frames are written by the route, which owns the transport.) */
export type StructuralStreamFrame =
  | { type: "heartbeat" }
  | { type: "final"; data: unknown };
