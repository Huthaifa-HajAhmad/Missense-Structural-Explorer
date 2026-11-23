import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchProtVarConservation } from "./protvar-conservation.ts";
import { clearAllCaches } from "../infra/cache.ts";

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchProtVarConservation (ProtVar / VarSite ScoreCons)", () => {
  let seen: string[];
  beforeEach(() => {
    clearAllCaches(true);
    seen = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  const stub = (response: () => Response) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      return response();
    }));

  it("reads the residue's conservation score on the canonical sequence", async () => {
    stub(() => answer([{ type: "CONSERV", score: 0.945 }]));
    expect(await fetchProtVarConservation("P04637", 175)).toBe(0.945);
    expect(seen[0]).toBe("https://www.ebi.ac.uk/ProtVar/api/score/P04637/175?type=CONSERV");
  });

  it("keeps an isoform suffix, so an isoform position is never read on the canonical sequence", async () => {
    stub(() => answer([]));
    expect(await fetchProtVarConservation("P04637-2", 175)).toBeNull();
    expect(seen[0]).toContain("/score/P04637-2/175?");
  });

  it("returns null when ProtVar has no score for the residue", async () => {
    stub(() => answer([]));
    expect(await fetchProtVarConservation("P04637", 99999)).toBeNull();
  });

  it("throws when ProtVar cannot answer, so an outage is not recorded as a missing score", async () => {
    stub(() => answer({ error: "down" }, 503));
    await expect(fetchProtVarConservation("P04637", 175)).rejects.toThrow(/503/);
  });

  it("throws on a score outside 0 to 1, which ScoreCons cannot produce", async () => {
    stub(() => answer([{ type: "CONSERV", score: 4.2 }]));
    await expect(fetchProtVarConservation("P04637", 175)).rejects.toThrow(/outside 0 to 1/);
  });
});
