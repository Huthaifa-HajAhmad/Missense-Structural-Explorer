import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStringInteractionsWithStatus, fetchStringPartnerLists } from "./string.ts";
import { clearAllCaches } from "../infra/cache.ts";

/** STRING still calls GBA1 "GBA" in the names it returns, whichever symbol it was asked about. */
const ROWS = [
  { preferredName_A: "GBA", preferredName_B: "PSAP", score: 0.99 },
  { preferredName_A: "SCARB2", preferredName_B: "GBA", score: 0.98 },
];

describe("STRING partners of a gene STRING names by its retired symbol", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists the partners of GBA1, and never the gene itself", async () => {
    clearAllCaches(true);
    vi.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify(ROWS)));
    const top = await fetchStringInteractionsWithStatus("GBA1", { bypassSqlite: true });
    expect(top.partners.map((p) => p.partner)).toEqual(["PSAP", "SCARB2"]);
    const lists = await fetchStringPartnerLists("GBA1");
    expect(lists.physical?.map((p) => p.partner)).toEqual(["PSAP", "SCARB2"]);
    expect(lists.functional?.map((p) => p.partner)).toEqual(["PSAP", "SCARB2"]);
  });
});
