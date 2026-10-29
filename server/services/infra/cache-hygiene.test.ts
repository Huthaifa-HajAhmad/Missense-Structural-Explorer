/**
 * WP-I2 cache hygiene: only a definitive "not found" is negatively cached (never a 429, a 5xx, a
 * timeout or an empty 200), keys carry no credential, and the expensive remote calls make one upstream
 * call for concurrent callers. The client's notice is tested in
 * `src/hooks/__tests__/useStaleDataNotice.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostStateForTests, setBackoffScaleForTests } from "./http-client.ts";
import { bestPdbCache, popEveOnlineCache, refseqCache } from "./cache.ts";
import { geminiCredentialSegment } from "./cache-keys.ts";
import { getTranscriptsForProtein, transcriptMappingCache } from "../prediction/predictors/transcript-resolver.ts";
import { fetchPopEVEScoreOnline, getRefSeqForProtein } from "../prediction/predictors/popeve-resolver.ts";
import { fetchBestPdbStructure } from "../structure/structure-fetcher.ts";
import { fetchStringInteractionsWithStatus } from "../external-api/string.ts";
import { clearSpliceAiCache, fetchSpliceAiBroadOutcome } from "../external-api/spliceai_broad.ts";
import { fetchDisplayedIsoformId, fetchUniprotSequence } from "../external-api/uniprot.ts";
import { resetBioSigSubmissionsForTests, submitDynaMut2Job } from "../stability/dynamut.ts";
import { clearJapanFoldCache, queryEsmc, querySaProt } from "../external-api/japanfold-client.ts";
import { AnalysisDatabase } from "./analysis-db.ts";
import { newCacheScope, runInCacheScope } from "./cache-scope.ts";
import { persistVariantAnalysisPayload } from "../orchestration/payload-assembler.ts";
import { LRUCache } from "lru-cache";

const respond = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setBackoffScaleForTests(0);
  resetHostStateForTests();
  transcriptMappingCache.clear();
  refseqCache.clear();
  popEveOnlineCache.clear();
  bestPdbCache.clear();
  clearSpliceAiCache();
  clearJapanFoldCache();
  resetBioSigSubmissionsForTests();
});

afterEach(() => {
  fetchSpy?.mockRestore();
  vi.restoreAllMocks();
  setBackoffScaleForTests(1);
});

describe("negative caching only for a definitive not-found", () => {
  it("transcript resolver: a 429 or a 403 is asked again, a 404 is remembered", async () => {
    // The shared client throws after retrying a 429 or 5xx, and returns any other refusal.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("slow down", 429));
    await getTranscriptsForProtein("P04637");
    expect(transcriptMappingCache.has("P04637")).toBe(false);
    fetchSpy.mockResolvedValue(respond("forbidden", 403));
    await getTranscriptsForProtein("P04637");
    expect(transcriptMappingCache.has("P04637")).toBe(false);

    fetchSpy.mockResolvedValue(respond("gone", 404));
    await getTranscriptsForProtein(" P04637 ");
    expect(transcriptMappingCache.get("P04637")).toEqual({ refseqId: null, ensemblId: null });
  });

  it("transcript resolver: a network error is not remembered", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await getTranscriptsForProtein("P04637");
    expect(transcriptMappingCache.has("P04637")).toBe(false);
  });

  it("a UniProt payload of an unexpected shape is asked again, not a thrown parse error", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ uniProtKBCrossReferences: "not an array" }));
    expect(await getRefSeqForProtein("P04637")).toBeNull();
    expect(refseqCache.has("P04637")).toBe(false);
  });

  it("popEVE RefSeq: a 503 is asked again, a 404 is remembered", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("busy", 503));
    expect(await getRefSeqForProtein("P04637")).toBeNull();
    expect(refseqCache.has("P04637")).toBe(false);
    fetchSpy.mockResolvedValue(respond("forbidden", 403));
    expect(await getRefSeqForProtein("P04637")).toBeNull();
    expect(refseqCache.has("P04637")).toBe(false);

    fetchSpy.mockResolvedValue(respond("gone", 404));
    expect(await getRefSeqForProtein("P04637")).toBeNull();
    expect(refseqCache.has("P04637")).toBe(true);
  });

  it("popEVE score: an unanswered RefSeq lookup or a 5xx file fetch is not remembered", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("busy", 503));
    await fetchPopEVEScoreOnline("P04637", "R273H");
    expect(popEveOnlineCache.has("P04637_R273H")).toBe(false);

    refseqCache.set("P04637", "NP_000537.3");
    await fetchPopEVEScoreOnline("P04637", "R273H");
    expect(popEveOnlineCache.has("P04637_R273H")).toBe(false);

    fetchSpy.mockResolvedValue(respond("missing", 404));
    await fetchPopEVEScoreOnline("P04637", "R273H");
    expect(popEveOnlineCache.has("P04637_R273H")).toBe(true);
  });

  it("popEVE score: a thrown error is not remembered", async () => {
    refseqCache.set("P04637", "NP_000537.3");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await fetchPopEVEScoreOnline("P04637", "R273H");
    expect(popEveOnlineCache.has("P04637_R273H")).toBe(false);
  });

  it("PDBe best structures: a 500 is asked again, a 404 is remembered", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("oops", 500));
    await fetchBestPdbStructure("P04637", 273);
    expect(bestPdbCache.has("P04637:273")).toBe(false);
    fetchSpy.mockResolvedValue(respond("forbidden", 403));
    await fetchBestPdbStructure("P04637", 273);
    expect(bestPdbCache.has("P04637:273")).toBe(false);

    fetchSpy.mockResolvedValue(respond({}, 404));
    await fetchBestPdbStructure("P04637", 273);
    expect(bestPdbCache.has("P04637:273")).toBe(true);
  });

  it("STRING: a failure is not written to L1", async () => {
    const l1 = new LRUCache<string, any>({ max: 10 });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("busy", 429));
    const out = await fetchStringInteractionsWithStatus("TP53", { l1Cache: l1, bypassSqlite: true });
    expect(out.status).toBe("failed");
    expect(l1.size).toBe(0);
  });

  it("SpliceAI: a 429 is asked again; a refused coordinate is remembered", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ error: "slow down" }, 429));
    const ask = () => fetchSpliceAiBroadOutcome("1", 25484258, "G", "A");
    expect((await ask()).failure?.kind).toBe("rate-limited");
    expect((await ask()).failure?.kind).toBe("rate-limited");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // An unreadable body is not a fact about the variant either.
    fetchSpy.mockImplementation(async () => respond({ scores: "nonsense" }, 200));
    expect((await ask()).failure?.kind).toBe("unreadable");
    expect((await ask()).failure?.kind).toBe("unreadable");
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    fetchSpy.mockResolvedValue(respond({ error: "REF does not match" }, 400));
    expect((await ask()).failure?.kind).toBe("coordinate-rejected");
    expect((await ask()).failure?.kind).toBe("coordinate-rejected");
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it("UniProt: an empty FASTA body is neither cached nor served", async () => {
    const l1 = new LRUCache<string, any>({ max: 10 });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("", 200));
    expect(await fetchUniprotSequence("Q00000", { l1Cache: l1, bypassSqlite: true })).toBe("");
    expect(l1.size).toBe(0);
  });

  it("UniProt: a 200 that is not an entry is not cached as 'no displayed isoform'", async () => {
    const l1 = new LRUCache<string, any>({ max: 10 });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({}, 200));
    await expect(fetchDisplayedIsoformId("Q00000", { l1Cache: l1, bypassSqlite: true })).rejects.toThrow(/no entry/);
    expect(l1.size).toBe(0);

    fetchSpy.mockResolvedValue(respond({ primaryAccession: "P04637", comments: [] }, 200));
    expect(await fetchDisplayedIsoformId("P04637", { l1Cache: l1, bypassSqlite: true })).toBeUndefined();
    expect(l1.size).toBe(1);
  });
});

describe("no credential in a cache key", () => {
  it("names whether a Gemini key was used, never which", () => {
    expect(geminiCredentialSegment("AIza-one")).toBe("key:any");
    expect(geminiCredentialSegment("AIza-two")).toBe("key:any");
    expect(geminiCredentialSegment(undefined)).toBe("key:none");
    expect(geminiCredentialSegment("")).toBe("key:none");
  });
});

describe("one upstream call for concurrent callers", () => {
  const PDB = "ATOM      1  CA  ALA A   1       1.000   1.000   1.000  1.00 20.00           C\nEND";

  it("DynaMut2: two submits for the same run share one job, and a caller arriving just after joins it", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ job_id: "J1" }));
    const [a, b] = await Promise.all([
      submitDynaMut2Job(PDB, "A", 1, "A", "V"),
      submitDynaMut2Job(PDB, "A", 1, "A", "V"),
    ]);
    expect([a, b]).toEqual(["J1", "J1"]);
    expect(await submitDynaMut2Job(PDB, "A", 1, "A", "V")).toBe("J1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // A different substitution is a different run.
    await submitDynaMut2Job(PDB, "A", 1, "A", "G");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("DynaMut2: a failed submission is not reused", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond("nope", 400));
    expect(await submitDynaMut2Job(PDB, "A", 1, "A", "V")).toBeNull();
    fetchSpy.mockResolvedValue(respond({ job_id: "J2" }));
    expect(await submitDynaMut2Job(PDB, "A", 1, "A", "V")).toBe("J2");
  });

  it("DynaMut2: one caller cancelling does not cancel the submission for another", async () => {
    let release!: (r: Response) => void;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(r => (release = r)));
    const ctrl = new AbortController();
    const quitter = submitDynaMut2Job(PDB, "A", 1, "A", "V", ctrl.signal);
    const stayer = submitDynaMut2Job(PDB, "A", 1, "A", "V");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    ctrl.abort();
    expect(await quitter).toBeNull();
    release(respond({ job_id: "J3" }));
    expect(await stayer).toBe("J3");
  });

  it("JapanFold ESMC: concurrent identical queries make one call", async () => {
    let release!: (r: Response) => void;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(r => (release = r)));
    const p1 = queryEsmc("MKV", 2, "K", "E");
    const p2 = queryEsmc("MKV", 2, "K", "E");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    release(respond({ llr: -2.5 }));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.llr).toBe(-2.5);
    expect(r2).toBe(r1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("SpliceAI: concurrent identical lookups make one call", async () => {
    let release!: (r: Response) => void;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(r => (release = r)));
    const p1 = fetchSpliceAiBroadOutcome("1", 25484258, "G", "A");
    const p2 = fetchSpliceAiBroadOutcome("1", 25484258, "G", "A");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    release(respond({ error: "busy" }, 503));
    await Promise.all([p1, p2]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("review 5 fixes", () => {
  it("popEVE: the bucket's 403 AccessDenied for a missing file is remembered; another 403 is not", async () => {
    refseqCache.set("P04637", "NP_000537.3");
    const s3Missing = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => respond("forbidden for other reasons", 403));
    await fetchPopEVEScoreOnline("P04637", "R273H");
    expect(popEveOnlineCache.has("P04637_R273H")).toBe(false);
    fetchSpy.mockImplementation(async () => respond(s3Missing, 403));
    await fetchPopEVEScoreOnline("P04637", "R273H");
    expect(popEveOnlineCache.has("P04637_R273H")).toBe(true);
  });

  it("SaProt: a different structure is a different answer, not a shared one", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => respond({ llr: -1 }));
    await querySaProt("MKV", 2, "K", "E", "ATOM one");
    await querySaProt("MKV", 2, "K", "E", "ATOM two");
    await querySaProt("MKV", 2, "K", "E", "ATOM one");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("SpliceAI: the request spells the contig the way the cache key does", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => respond({ error: "x" }, 400));
    await fetchSpliceAiBroadOutcome("chrx", 100, "G", "A");
    expect(String(fetchSpy.mock.calls[0][0])).toContain("variant=chrX-100-G-A");
  });

  it("an analysis built from stale data is answered but not saved", async () => {
    AnalysisDatabase.resetInstance(":memory:");
    const save = vi.spyOn(AnalysisDatabase.getInstance(), "saveVariantAnalysisAsync").mockResolvedValue(undefined as any);
    const context = { gene: "TP53", variant: "R273H", uniprotId: "P04637", pos: 273, wildType: "Arg", mutant: "His", acmgWeighting: "standard" } as any;
    const scope = newCacheScope();
    scope.stale.push({ source: "UniProt FASTA", hosts: ["rest.uniprot.org"], busy: false, ageSec: 60 });
    await runInCacheScope(scope, () => persistVariantAnalysisPayload(context, {}, null));
    expect(save).not.toHaveBeenCalled();
    await runInCacheScope(newCacheScope(), () => persistVariantAnalysisPayload(context, {}, null));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("popEVE RefSeq: the displayed isoform, not the first cross-reference", () => {
  // GATA4 lists the alternative NP_001295022.1 before the displayed sequence NP_002043.2.
  const gata4Entry = () => ({
    uniProtKBCrossReferences: [
      { database: "RefSeq", id: "NP_001295022.1", isoformId: "P43694-2" },
      { database: "RefSeq", id: "NP_002043.2", isoformId: "P43694-1" },
    ],
    comments: [{ isoforms: [{ isoformIds: ["P43694-1"], isoformSequenceStatus: "Displayed" }] }],
  });
  const body = (entry: unknown) => () => Promise.resolve(respond(entry));

  it("scores GATA4 p.Ser159Cys on the displayed isoform", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(respond(gata4Entry()))
      .mockResolvedValueOnce(respond("mutant,gap frequency,popEVE\nS159C,0.052,-3.376\n"));
    expect(await fetchPopEVEScoreOnline("P43694", "p.Ser159Cys")).toBe(-3.376);
    expect(String(fetchSpy.mock.calls[1][0])).toContain("NP_002043.2.csv");
  });

  it("resolves the accession path from the same isoform data", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(body(gata4Entry()));
    expect(await getRefSeqForProtein("P43694")).toBe("NP_002043.2");
  });

  it("asks the search for a single full entry, so the isoform comments are present", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(body({ results: [gata4Entry()] }));
    expect(await getRefSeqForProtein("GATA4")).toBe("NP_002043.2");
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("size=1");
    expect(url).not.toContain("fields=");
  });

  it("falls back to the canonical cross-reference when no isoform is marked displayed", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(body({
      uniProtKBCrossReferences: [
        { database: "RefSeq", id: "NP_001295022.1", isoformId: "P43694-2" },
        { database: "RefSeq", id: "NP_002043.2" },
      ],
      comments: [],
    }));
    expect(await getRefSeqForProtein("P43694")).toBe("NP_002043.2");
  });

  it("remembers a gene with no human entry instead of asking again", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(body({ results: [] }));
    expect(await getRefSeqForProtein("NOTAGENE")).toBeNull();
    expect(refseqCache.get("NOTAGENE")).toBeNull();
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });
});
