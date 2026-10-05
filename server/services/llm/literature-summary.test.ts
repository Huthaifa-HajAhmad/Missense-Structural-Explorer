import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), ranked: vi.fn(), curated: vi.fn() }));
vi.mock("./literature-rag.ts", () => ({searchGeneLiterature:mocks.search,retrieveRelevantLiterature:mocks.ranked}));
vi.mock("./curated-literature.ts", () => ({getCuratedVariantCitations:mocks.curated}));
import { selectSummaryCitations, boundedLiterature, literatureSummaryDigest } from "./literature-summary";
const paper = (id:string,abstract:string) => ({id,title:"PAH",abstract,authors:"A",journal:"J",year:2026});
beforeEach(() => { mocks.search.mockReset(); mocks.ranked.mockReset().mockResolvedValue([]); mocks.curated.mockReset().mockResolvedValue({citations:[],state:"complete"}); });
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
