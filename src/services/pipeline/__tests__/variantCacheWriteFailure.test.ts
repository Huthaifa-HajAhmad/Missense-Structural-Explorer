// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * A sessionStorage write that fails (quota, private mode) used to vanish. It costs the user a
 * multi-minute FoldX re-run on the next visit, so it is reported once per session — not once per
 * write, which would bury the Console in identical lines.
 */
describe("variantCache write failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reports a failed cache write exactly once per session and keeps serving from memory", async () => {
    vi.resetModules();
    const { setCachedVariant, getCachedVariant } = await import("../variantCache");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    setCachedVariant("QUOTA1", "p.Ala1Val", "P00001", { foldingDdG: 1.2, mutantPdb: "ATOM" });
    setCachedVariant("QUOTA2", "p.Ala1Val", "P00001", { foldingDdG: 0.4, mutantPdb: "ATOM" });

    const cacheWarnings = warn.mock.calls.filter((c) => String(c[0]).startsWith("[Cache]"));
    expect(cacheWarnings).toHaveLength(1);
    expect(String(cacheWarnings[0][0])).toMatch(/recompute/);
    // The in-memory copy still serves the session.
    expect(getCachedVariant("QUOTA1", "p.Ala1Val")?.foldingDdG).toBe(1.2);
  });

  it("stays quiet when writes succeed", async () => {
    vi.resetModules();
    const { setCachedVariant } = await import("../variantCache");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setCachedVariant("OKAY", "p.Ala1Val", "P00001", { foldingDdG: 1.2, mutantPdb: "ATOM" });
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith("[Cache]"))).toHaveLength(0);
  });
});
