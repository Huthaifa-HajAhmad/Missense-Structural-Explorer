import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiteraturePage } from "./literature-rag";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("bounded Europe PMC pages", () => {
  it("passes the opaque cursor and preserves metadata without changing first-page membership", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hitCount: 70, nextCursorMark: "next/opaque+", resultList: { result: Array.from({ length: 25 }, (_, i) => ({ id: String(123 + i), source: "MED", title: "RGS9 study", abstractText: "Patients with RGS9 variants.", pubYear: "2004", pubTypeList: { pubType: ["Case Reports"] } })) } })));
    vi.stubGlobal("fetch", fetcher);
    const page = await fetchLiteraturePage("RGS9", 'RGS9 AND "case report"', "opaque+/=");
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("cursorMark")).toBe("opaque+/=");
    expect(url.searchParams.get("pageSize")).toBe("25");
    expect(page.nextCursor).toBe("next/opaque+");
    expect(page.citations[0].publicationTypes).toEqual(["Case Reports"]);
  });
  it("stops an exhausted cursor instead of looping on the same page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ hitCount: 0, nextCursorMark: "same", resultList: { result: [] } }))));
    expect((await fetchLiteraturePage("RGS9", undefined, "same")).nextCursor).toBeNull();
  });
  it("stops on a partial final page even when the provider advances its cursor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ hitCount: 26, nextCursorMark: "advanced", resultList: { result: [{ id: "123", source: "MED", title: "RGS9 clinical report", abstractText: "RGS9 patients." }] } }))));
    const page = await fetchLiteraturePage("RGS9", undefined, "last-page");
    expect(page.citations).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
  it("keeps the deadline active through the response-body read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, options) => ({ ok: true, json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true })) })));
    const work = fetchLiteraturePage("RGS9", undefined, "cursor");
    const assertion = expect(work).rejects.toThrow("body aborted");
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
  });
});
