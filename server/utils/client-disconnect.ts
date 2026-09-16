/**
 * client-disconnect.ts — Correct client-disconnect detection for route handlers.
 *
 * Why this module exists
 * ----------------------
 * Every cancellable route used to detect a dropped client with:
 *
 *     req.on("close", () => { if (!res.writableEnded) controller.abort(); });
 *
 * That is wrong, and silently cancels work the client is still waiting for.
 *
 * Since Node 16, `IncomingMessage` emits `'close'` when the request has been *completed* —
 * i.e. as soon as its body has been fully read and the stream destroyed — not when the
 * underlying socket closes. (Node docs: "The close event is now emitted when the request has
 * been completed and not when the underlying socket is closed.") Body parsers such as
 * `express.json()` finish reading the body before the handler runs, so the handler's
 * `res.writableEnded` is still `false` when `'close'` fires microseconds later. The guard
 * therefore passes and the route aborts itself on the very next tick.
 *
 * Observed effect in this codebase: `/analyze-variant-narrative` logged
 * `[Gemini Entry] ... signalAborted=true` on every request and returned
 * "Deadline exceeded or request timed out" as a rule-based fallback report, deterministically,
 * regardless of provider health. The same pattern silently aborts the streaming analysis,
 * structure, multimer and biophysics generation routes.
 *
 * The response object is the correct signal: `res` emits `'close'` when its underlying
 * connection is torn down — which also covers a client that goes away mid-stream — so
 * `res.writableEnded` cleanly separates "finished normally" from "client left".
 */

export interface DisconnectListenable {
  on?: (event: string, listener: (...args: any[]) => void) => unknown;
  writableEnded?: boolean;
}

/**
 * Run `onDisconnect` only when the client genuinely disconnects before the response completes.
 *
 * @returns a function that removes the listener, for use in a `finally` block.
 */
export function onClientDisconnect(
  res: DisconnectListenable | null | undefined,
  onDisconnect: () => void
): () => void {
  if (!res || typeof res.on !== "function") {
    return () => {};
  }

  const listener = () => {
    // `writableEnded` is false whenever the response was not fully flushed, including a
    // client disconnect mid-stream.
    if (!res.writableEnded) {
      onDisconnect();
    }
  };

  res.on("close", listener);

  return () => {
    const removable = res as DisconnectListenable & {
      off?: (event: string, listener: (...args: any[]) => void) => unknown;
      removeListener?: (event: string, listener: (...args: any[]) => void) => unknown;
    };
    if (typeof removable.off === "function") {
      removable.off("close", listener);
    } else if (typeof removable.removeListener === "function") {
      removable.removeListener("close", listener);
    }
  };
}
