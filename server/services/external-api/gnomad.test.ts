import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchGnomadGeneConstraint } from "./gnomad.ts";
import { clearAllCaches } from "../infra/cache.ts";

// Build the GraphQL envelope the fetcher parses. The RMC gate under test reads
// exactly three inputs: the window's p_value, the track's passed_qc, and the
// residue's containment in the window — everything else is held constant.
function mockResponse({
  passedQc = true,
  pValue = 1e-6,
  obsExp = 0.5,
}: { passedQc?: boolean | null; pValue?: number | null; obsExp?: number } = {}) {
  return {
    data: {
      gene: {
        gnomad_constraint: { mis_z: 3.13, oe_mis: 0.26, pLI: 0.98, oe_lof_upper: 0.26 },
        gnomad_v2_regional_missense_constraint: {
          passed_qc: passedQc,
          regions: [
            { aa_start: "100", aa_stop: "200", obs_exp: obsExp, p_value: pValue },
            { aa_start: "400", aa_stop: "500", obs_exp: 0.6, p_value: 1e-8 },
          ],
        },
      },
    },
  };
}

function mockFetch(response: object) {
  const fetchSpy = vi.spyOn(global, "fetch");
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: async () => response,
  } as any);
  return fetchSpy;
}

describe("fetchGnomadGeneConstraint regional verdict gating", () => {
  beforeEach(() => {
    clearAllCaches(true);
  });

  it("marks a residue inside a significant, QC-passed window as constrained", async () => {
    const spy = mockFetch(mockResponse({ passedQc: true, pValue: 1e-6 }));
    const res = await fetchGnomadGeneConstraint("MACO1", 150, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint).toMatchObject({
      isConstrained: true,
      oeRatio: 0.5,
      pValue: 1e-6,
      regionText: "100 to 200",
    });
  });

  it("refuses the constrained call when the window's p-value does not clear 0.05, but keeps the span", async () => {
    const spy = mockFetch(mockResponse({ passedQc: true, pValue: 0.4 }));
    const res = await fetchGnomadGeneConstraint("MACO1", 150, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint?.isConstrained).toBe(false);
    // The client distinguishes "matched, not significant" from "outside every
    // window" by these still being present.
    expect(res?.regionalConstraint?.regionText).toBe("100 to 200");
    expect(res?.regionalConstraint?.pValue).toBe(0.4);
  });

  it("refuses the constrained call when the RMC track failed QC, however significant the window", async () => {
    const spy = mockFetch(mockResponse({ passedQc: false, pValue: 1e-6 }));
    const res = await fetchGnomadGeneConstraint("MACO1", 150, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint?.isConstrained).toBe(false);
    expect(res?.regionalConstraint?.regionText).toBe("100 to 200");
  });

  it("treats an omitted passed_qc (null) as unblocking — only an explicit failure gates", async () => {
    const spy = mockFetch(mockResponse({ passedQc: null, pValue: 1e-6 }));
    const res = await fetchGnomadGeneConstraint("MACO1", 150, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint?.isConstrained).toBe(true);
  });

  it("refuses the constrained call when the window's p-value is missing", async () => {
    const spy = mockFetch(mockResponse({ passedQc: true, pValue: null }));
    const res = await fetchGnomadGeneConstraint("MACO1", 150, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint?.isConstrained).toBe(false);
  });

  it("accepts a string-encoded p_value (GraphQL Float tolerance) as significant", async () => {
    const spy = mockFetch(mockResponse({ passedQc: true, pValue: "6.6e-6" as any }));
    const res = await fetchGnomadGeneConstraint("MACO1", 150, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint?.isConstrained).toBe(true);
  });

  it("reports a residue outside every window as unconstrained with no span", async () => {
    const spy = mockFetch(mockResponse());
    const res = await fetchGnomadGeneConstraint("MACO1", 300, { bypassSqlite: true });
    spy.mockRestore();

    expect(res?.regionalConstraint).toMatchObject({
      isConstrained: false,
      regionText: null,
      pValue: null,
    });
  });
});
