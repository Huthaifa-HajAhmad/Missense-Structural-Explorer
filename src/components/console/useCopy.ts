import { useCallback, useEffect, useRef, useState } from "react";

/** Clipboard write with visible success/failure — `navigator.clipboard` is absent on insecure origins. */
export function useCopy() {
  const [state, setState] = useState<{ key: string; ok: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, key: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    setState({ key, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), 2000);
  }, []);

  return {
    copy,
    /** "copied" | "failed" | null for the given action key. */
    status: (key: string): "copied" | "failed" | null =>
      state?.key === key ? (state.ok ? "copied" : "failed") : null,
  };
}
