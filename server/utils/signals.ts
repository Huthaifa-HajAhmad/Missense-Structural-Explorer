/**
 * Composes multiple optional AbortSignals into a single AbortSignal.
 * Cleans up attached event listeners when aborted or completed.
 */
export function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const activeSignals = signals.filter((s): s is AbortSignal => !!s);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
    cleanup();
  };
  const cleanup = () => {
    for (const signal of activeSignals) {
      signal.removeEventListener("abort", onAbort);
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", onAbort);
  }
  return controller.signal;
}
