import { describe, expect, it, vi } from "vitest";
import { createStructureApi, parseProvenanceFromHeaders } from "./structureApi";
import { SEQUENCE_LOOKUP_BUDGET_MS, HOMOLOG_DISCOVERY_BUDGET_MS } from "../shared/structureLookupBudgets";

it("lets sequence and homolog requests outlast their server work", async () => {
  const fetchWithAuth = vi.fn()
    .mockResolvedValueOnce(Response.json({ sequence: "MPEPTIDE" }))
    .mockResolvedValueOnce(Response.json({ homologs: [] }));
  const api = createStructureApi(fetchWithAuth);
  const signal = new AbortController().signal;
  expect(await api.getSequence("Q9H8M5", signal)).toBe("MPEPTIDE");
  expect(await api.getHomologs("Q9H8M5", 357, signal)).toEqual([]);
  expect(fetchWithAuth.mock.calls[0][1].timeout).toBeGreaterThan(SEQUENCE_LOOKUP_BUDGET_MS);
  expect(fetchWithAuth.mock.calls[1][1].timeout).toBeGreaterThan(SEQUENCE_LOOKUP_BUDGET_MS + HOMOLOG_DISCOVERY_BUDGET_MS);
  expect(fetchWithAuth.mock.calls[1]).toEqual(["/api/v1/homologs/Q9H8M5?pos=357", expect.objectContaining({ signal })]);
});

/**
 * The viewer's disclosure travels in response headers. The server side is pinned by
 * `server/routes/structure.test.ts`; this is the client half of the round-trip, including the
 * malformed-header policy (degrade to no note, never fail the structure).
 */

const response = (headers: Record<string, string>) => new Response("", { status: 200, headers });

describe("parseProvenanceFromHeaders", () => {
  it("reads the AlphaFold version and the disclosed sequence differences", () => {
    const provenance = parseProvenanceFromHeaders(
      response({
        "X-Template-Source": "experimental",
        "X-Template-PdbId": "1R3S",
        "X-Template-ChainId": "A",
        "X-Template-Resolution": "1.65",
        "X-Template-AfdbVersion": "v6",
        "X-Template-Sequence-Differences": encodeURIComponent(JSON.stringify(["D86G (engineered mutation)"])),
      })
    );

    expect(provenance).toMatchObject({
      source: "experimental",
      pdbId: "1R3S",
      chainId: "A",
      resolution: 1.65,
      afdbVersion: "v6",
      sequenceDifferences: ["D86G (engineered mutation)"],
    });
  });

  it("keeps a valid structure when the differences header is malformed or empty", () => {
    for (const header of ["%7Bnot-json", encodeURIComponent(JSON.stringify([])), encodeURIComponent(JSON.stringify([1, 2]))]) {
      const provenance = parseProvenanceFromHeaders(
        response({ "X-Template-Source": "experimental", "X-Template-PdbId": "1R3S", "X-Template-Sequence-Differences": header })
      );
      expect(provenance.source).toBe("experimental");
      expect(provenance.pdbId).toBe("1R3S");
      expect(provenance.sequenceDifferences).toBeUndefined();
    }
  });

  it("omits the fields an older server does not send", () => {
    const provenance = parseProvenanceFromHeaders(response({ "X-Template-Source": "alphafold" }));
    expect(provenance.source).toBe("alphafold");
    expect(provenance.afdbVersion).toBeUndefined();
    expect(provenance.sequenceDifferences).toBeUndefined();
  });
});
