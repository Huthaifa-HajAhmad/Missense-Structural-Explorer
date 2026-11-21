import { describe, it, expect, afterEach } from "vitest";
import { anySignal } from "./signals.ts";

describe("anySignal", () => {
  const originalAny = AbortSignal.any;

  afterEach(() => {
    (AbortSignal as any).any = originalAny;
  });

  it("preserves the source abort reason in both native and fallback paths", () => {
    for (const useFallback of [false, true]) {
      if (useFallback) {
        (AbortSignal as any).any = undefined;
      } else {
        (AbortSignal as any).any = originalAny;
      }

      const a = new AbortController();
      const b = new AbortController();
      const combined = anySignal([a.signal, b.signal])!;
      const reason = new DOMException("budget exceeded", "TimeoutError");

      b.abort(reason);

      expect(combined.aborted).toBe(true);
      expect(combined.reason).toBe(reason);
    }
  });

  it("preserves the reason when one input signal is already aborted in the fallback path", () => {
    (AbortSignal as any).any = undefined;
    const a = new AbortController();
    const b = new AbortController();
    const reason = new DOMException("already timed out", "TimeoutError");
    b.abort(reason);

    const combined = anySignal([a.signal, b.signal])!;
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);

    // Ensure listener on `a` was cleaned up and does not throw or leak.
    a.abort(new DOMException("later", "AbortError"));
    expect(combined.reason).toBe(reason);
  });
});
