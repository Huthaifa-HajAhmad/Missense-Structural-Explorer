import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), ranked: vi.fn(), curated: vi.fn(), cursor: vi.fn(), page: vi.fn(), count: vi.fn() }));
vi.mock("./literature-rag.ts", () => ({searchGeneLiterature:mocks.search,retrieveRelevantLiterature:mocks.ranked, literatureCacheKey:()=>"key", getLiteratureHitCount:mocks.count, getLiteratureNextCursor:mocks.cursor, fetchLiteraturePage:mocks.page}));
vi.mock("./curated-literature.ts", () => ({getCuratedVariantCitations:mocks.curated}));
import { selectSummaryCitations, boundedLiterature, literatureSummaryDigest } from "./literature-summary";
const paper = (id:string,abstract:string) => ({id,title:"PAH",abstract,authors:"A",journal:"J",year:2026});
beforeEach(() => { mocks.cursor.mockReset().mockReturnValue(null); mocks.page.mockReset(); mocks.count.mockReset().mockReturnValue(null); mocks.search.mockReset(); mocks.ranked.mockReset().mockResolvedValue([]); mocks.curated.mockReset().mockResolvedValue({citations:[],state:"complete"}); });
afterEach(() => vi.useRealTimers());
describe("summary retrieval snapshot", () => {
  it("probes a cold variant scope and admits its unembedded exact-variant paper", async () => {
    mocks.search.mockImplementation(async (_g,_k,_s,query) => ({citations:[query?paper("variant","PAH p.Arg408Trp activity was reduced."):paper("gene","PAH activity.")],degraded:false}));
    const result=await selectSummaryCitations("PAH","p.Arg408Trp","P00439");
    expect(mocks.search).toHaveBeenCalledWith("PAH",undefined,expect.any(AbortSignal),expect.stringContaining("R408W"));
    expect(result.citations.map(c=>c.id)).toEqual(["variant","gene"]);
    expect(result.scopes).toEqual({gene:"complete",variant:"complete",curated:"complete"});
    expect(mocks.ranked.mock.calls[0][4]).toBe(Infinity);
  });
  it("never presents a degraded gene fallback as a successful variant query", async () => {
    mocks.search.mockImplementation(async (_g,_k,_s,query)=>({citations:[paper("gene","PAH activity.")],degraded:!!query}));
    const result=await selectSummaryCitations("PAH","p.Arg408Trp","P00439");
    expect(result.scopes.variant).toBe("error");
    expect(result.citations).toHaveLength(1);
  });
  it("enforces five seconds when an optional provider ignores abort and freezes completed scopes", async () => {
    vi.useFakeTimers();
    mocks.search.mockResolvedValue({citations:[paper("gene","PAH activity.")],degraded:false});
    let finish:(value:any)=>void=()=>{};
    mocks.curated.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const work=selectSummaryCitations("PAH","p.Arg408Trp","P00439");
    await vi.advanceTimersByTimeAsync(5001);
    const selected=await work;
    expect(selected.scopes.curated).toBe("error");
    const digest=literatureSummaryDigest(selected);
    finish({citations:[paper("late","PAH p.Arg408Trp activity.")],state:"complete"});
    await Promise.resolve();
    expect(literatureSummaryDigest(selected)).toBe(digest);
    expect(selected.citations.map(c=>c.id)).toEqual(["gene"]);
  });
  it("stops waiting immediately for an already cancelled caller", async () => {
    const signal=AbortSignal.abort(new Error("cancelled"));
    await expect(boundedLiterature(new Promise(()=>{}),signal)).rejects.toThrow("cancelled");
  });
});

it("retains the first page and marks coverage incomplete when a later page hangs", async () => {
  vi.useFakeTimers();
  mocks.search.mockResolvedValue({ citations: [paper("gene", "PAH activity.")], degraded: false });
  mocks.cursor.mockReturnValue("next"); mocks.count.mockReturnValue(200);
  mocks.page.mockImplementation(() => new Promise(() => {}));
  const work = selectSummaryCitations("PAH", "p.Arg408Trp", "");
  await vi.advanceTimersByTimeAsync(5001);
  const selected = await work;
  expect(selected.citations.map(c => c.id)).toEqual(["gene"]);
  expect(selected.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ loaded: 1, matched: 200, truncated: true, state: "error" })]));
});


it("marks a failed later page incomplete without dropping its first-page citations", async () => {
  mocks.search.mockResolvedValue({ citations: [paper("gene", "PAH activity.")], degraded: false });
  mocks.cursor.mockReturnValue("next"); mocks.count.mockReturnValue(200);
  mocks.page.mockRejectedValue(new Error("provider page failed"));
  const selected = await selectSummaryCitations("PAH", "p.Arg408Trp", "");
  expect(selected.citations.map(c => c.id)).toEqual(["gene"]);
  expect(selected.scopes).toMatchObject({ gene: "error", variant: "error" });
  expect(selected.coverage?.every(row => row.state === "error")).toBe(true);
});
