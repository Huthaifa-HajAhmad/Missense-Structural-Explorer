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
  const cleanup = () => {
    for (const signal of activeSignals) {
      signal.removeEventListener("abort", onAbort);
    }
  };
  const onAbort = (event: Event) => {
    const source = event.target as AbortSignal | null;
    controller.abort(source?.reason);
    cleanup();
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      cleanup();
      return controller.signal;
    }
    signal.addEventListener("abort", onAbort);
  }
  return controller.signal;
}
