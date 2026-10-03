import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRouter } from "../../routes.ts";

// The route's job is to turn a coordinate + window into the fields the analysis would carry, and to
// refuse what is not a coordinate. The Broad client is mocked so no test reaches the rate-limited service.
vi.mock("../../services/external-api/spliceai_broad.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/external-api/spliceai_broad.ts")>();
  return { ...actual, fetchSpliceAiBroadOutcome: vi.fn() };
});
import { fetchSpliceAiBroadOutcome } from "../../services/external-api/spliceai_broad.ts";

function handler(): any {
  const route: any = (apiRouter as any).stack.find((l: any) => l.route && l.route.path === "/spliceai/score");
  expect(route).toBeDefined();
  return route.route.stack[route.route.stack.length - 1].handle;
}
function harness(body: any) {
  const req: any = { body, headers: {}, on: () => req };
  const res: any = {
    body: undefined as any,
    statusCode: 200,
    json(p: any) { this.body = p; return this; },
    status(c: number) { this.statusCode = c; return this; },
    getHeader: () => undefined,
    on: () => res,
  };
  return { req, res };
}
const record = (distance: number) => ({
  ds_ag: 0, ds_al: 0.2, ds_dg: 0, ds_dl: 0, max_ds: 0.2,
  dp: { ds_ag: 0, ds_al: -12, ds_dg: 0, ds_dl: 0 },
  transcriptId: "ENST1", transcriptRefSeqIds: [], isManeSelect: true, geneSymbol: "G",
  distance, mask: 1, computedLive: true, source: "spliceai:model",
});

describe("POST /spliceai/score", () => {
  beforeEach(() => vi.mocked(fetchSpliceAiBroadOutcome).mockReset());

  it("re-scores under the requested window and shapes the score like the analysis does", async () => {
    vi.mocked(fetchSpliceAiBroadOutcome).mockResolvedValue({ record: record(1000), failure: null });
    const { req, res } = harness({ coordinates: "16-67946177-C-G", assembly: "GRCh38", distance: 1000 });
    await handler()(req, res);
    expect(vi.mocked(fetchSpliceAiBroadOutcome).mock.calls[0][4]).toMatchObject({ distance: 1000, assembly: "GRCh38" });
    expect(res.body.attempted).toBe(true);
    expect(res.body.spliceai.provenance).toMatchObject({ source: "broad-lookup", distanceBp: 1000, computedLive: true, annotationSet: "MANE Select" });
    expect(res.body.spliceaiFailure).toBeNull();
  });

  it("returns the reason, not a bare null, when the service refuses the variant", async () => {
    vi.mocked(fetchSpliceAiBroadOutcome).mockResolvedValue({ record: null, failure: { kind: "coordinate-rejected", httpStatus: 400, detail: "REF" } });
    const { req, res } = harness({ coordinates: "16-67946177-C-G", distance: 500 });
    await handler()(req, res);
    expect(res.body.spliceai).toBeNull();
    expect(res.body.spliceaiFailure).toMatchObject({ kind: "coordinate-rejected" });
  });

  it("refuses a malformed coordinate and an out-of-range window before asking the service", async () => {
    for (const body of [{ coordinates: "not-a-coordinate", distance: 500 }, { coordinates: "16-67946177-C-G", distance: 10 }, { coordinates: "16-67946177-C-G" }]) {
      const { req, res } = harness(body);
      await handler()(req, res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetchSpliceAiBroadOutcome).not.toHaveBeenCalled();
  });
});
