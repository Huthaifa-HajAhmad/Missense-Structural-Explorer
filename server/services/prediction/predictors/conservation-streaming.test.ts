import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  alphagenome: vi.fn(),
  gpnByCoordinate: vi.fn(),
  spliceai: vi.fn(),
}));
vi.mock("../../external-api/genos_web.ts", () => ({ queryGenosWebservice: vi.fn(async () => null) }));
vi.mock("./dbnsfp-query.ts", () => ({ queryDbnsfpOrg: vi.fn(async () => null) }));
vi.mock("../dbnsfp_local.ts", () => ({
  isLocalDbnsfpAvailable: () => true,
  queryLocalDbnsfpVariant: mocks.local,
  readLocalDbnsfpVersion: () => "dbNSFP 5.3a",
}));
vi.mock("./popeve-resolver.ts", () => ({
  fetchPopEVEScore: vi.fn(async () => null),
  fetchPopEVEScoreOnline: vi.fn(async () => null),
}));
vi.mock("../../external-api/alphagenome-bridge.ts", () => ({ fetchAlphaGenome: mocks.alphagenome }));
vi.mock("../../external-api/spliceai_broad.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../external-api/spliceai_broad.ts")>()),
  fetchSpliceAiBroadOutcome: mocks.spliceai,
}));
vi.mock("../../external-api/gpn.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../external-api/gpn.ts")>()),
  fetchGpnStarByCoordinate: mocks.gpnByCoordinate,
  fetchGpnStarScore: vi.fn(async () => ({ score: null, status: "unavailable" })),
}));

import {
  fetchConservationDataProgressive,
  expireConservationSnapshot,
  conservationFullySettled,
} from "./conservation-orchestrator.ts";
import { clearAllCaches } from "../../infra/cache.ts";
import type { ConservationData } from "../../../../src/shared/contracts.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const flush = () => new Promise(r => setTimeout(r, 0));

const liveRecord = {
  ds_ag: 0.02, ds_al: 0.71, ds_dg: 0, ds_dl: 0.01, max_ds: 0.71,
  dp: { ag: 3, al: -2, dg: 0, dl: 9 },
  transcriptId: "ENST00000269305", transcriptRefSeqIds: [], isManeSelect: true, geneSymbol: "TP53",
  distance: 500, mask: 0, computedLive: false,
};

/**
 * The conservation composite used to join dbNSFP, ConSurf, PopEVE, GPN-Star, AlphaGenome and live
 * SpliceAI with `Promise.all`, so a SpliceAI answer in two seconds waited for the slowest of them.
 */
describe("conservation models stream independently", () => {
  beforeEach(() => {
    clearAllCaches(true);
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    mocks.gpnByCoordinate.mockResolvedValue({ score: null, status: "unavailable" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (onPartial: (s: ConservationData) => void) =>
    fetchConservationDataProgressive({
      gene: "TP53",
      variant: "p.Arg273His",
      pos: 273,
      predictorPromise: Promise.resolve({ gnomadVariantId: "17-7673802-C-T", gnomadVariantAssembly: "GRCh38" }) as any,
      genosPromise: Promise.resolve(null),
      alphagenomeApiKey: "key",
      onPartial,
    });

  it("publishes SpliceAI and AlphaGenome while dbNSFP is still running, then returns a status-free final", async () => {
    const base = deferred<any>();
    mocks.local.mockReturnValue(base.promise);
    mocks.spliceai.mockResolvedValue({ record: liveRecord, failure: null });
    mocks.alphagenome.mockResolvedValue({ status: "live", aviPhred: 31.2 });

    const snapshots: ConservationData[] = [];
    const final = run(s => snapshots.push(s));
    await vi.waitFor(() => {
      const last = snapshots.at(-1);
      expect(last?.modelStatus?.spliceai).toBe("settled");
      expect(last?.modelStatus?.alphagenome).toBe("settled");
    });

    const early = snapshots.at(-1)!;
    expect(early.modelStatus?.base).toBe("pending");
    expect(early.spliceai?.max_ds).toBe(0.71);
    expect(early.alphagenome?.aviPhred).toBe(31.2);
    // dbNSFP has not answered: not assessed, so no value and no claim of availability.
    expect(early.revel).toBeNull();
    expect(early.available).toBe(false);

    base.resolve({ revel: 0.9, gerp: 5, phylop: 7, popeve: null });
    const result = await final;
    expect(result.revel).toBe(0.9);
    expect(result.spliceai?.max_ds).toBe(0.71);
    expect(result.modelStatus).toBeUndefined();
    expect(snapshots.every(s => !conservationFullySettled(s))).toBe(true);
  });

  it("withholds the frozen dbNSFP SpliceAI score until the live lookup has answered", async () => {
    const live = deferred<any>();
    mocks.spliceai.mockReturnValue(live.promise);
    mocks.alphagenome.mockResolvedValue(null);
    mocks.local.mockResolvedValue({
      revel: 0.9, gerp: 5, phylop: 7, popeve: null,
      SpliceAI_pred_DS_AG: 0.1, SpliceAI_pred_DS_AL: 0.05, SpliceAI_pred_DS_DG: 0, SpliceAI_pred_DS_DL: 0,
    });

    const snapshots: ConservationData[] = [];
    const final = run(s => snapshots.push(s));
    await vi.waitFor(() => expect(snapshots.at(-1)?.modelStatus?.base).toBe("settled"));
    await flush();

    const beforeLive = snapshots.at(-1)!;
    expect(beforeLive.revel).toBe(0.9);
    // The live answer would REPLACE this number, so showing it now would be a contradiction later.
    expect(beforeLive.spliceai).toBeNull();
    expect(beforeLive.modelStatus?.spliceai).toBe("pending");

    live.resolve({ record: liveRecord, failure: null });
    const result = await final;
    expect(result.spliceai?.max_ds).toBe(0.71);
    expect(result.spliceai?.provenance?.source).toBe("broad-lookup");
  });

  it("relabels unsettled models as timed out when a budget keeps a snapshot", () => {
    const expired = expireConservationSnapshot({
      revel: 0.9, gerp: 5, phylop: 7,
      modelStatus: { base: "settled", spliceai: "pending", alphagenome: "pending" },
    } as ConservationData);
    expect(expired.modelStatus).toEqual({ base: "settled", spliceai: "timeout", alphagenome: "timeout" });
    expect(expired.revel).toBe(0.9);
  });
});
