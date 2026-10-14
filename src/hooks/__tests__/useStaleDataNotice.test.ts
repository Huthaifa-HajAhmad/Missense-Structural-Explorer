/**
 * WP-I2: the reader is told when a result used saved data because a provider was limiting requests.
 * The server half (the `X-MSE-Stale` header) is tested in `server/services/infra/stale-on-rate-limit.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { notesToAnnounce, STALE_NOTICE_QUIET_MS } from "../useStaleDataNotice";
import { getStaleData, noteStaleDataHeader, subscribeStaleData } from "../../api/authSession";
import { encodeStaleData } from "../../shared/providerLimits";

describe("client: stale-data notice", () => {
  it("names a provider once per quiet period", () => {
    const shown = new Map<string, number>();
    const notes = [{ data: "UniProt FASTA", provider: "UniProt", ageSec: 60 }];
    expect(notesToAnnounce(notes, shown, 1_000)).toEqual(notes);
    expect(notesToAnnounce(notes, shown, 2_000)).toEqual([]);
    expect(notesToAnnounce([...notes, { data: "VEP", provider: "Ensembl", ageSec: 5 }], shown, 3_000)).toEqual([
      { data: "VEP", provider: "Ensembl", ageSec: 5 },
    ]);
    expect(notesToAnnounce(notes, shown, 1_000 + STALE_NOTICE_QUIET_MS)).toEqual(notes);
  });

  it("publishes the header's notes to subscribers, and ignores a missing header", () => {
    const seen: unknown[] = [];
    const off = subscribeStaleData(r => seen.push(r.notes));
    noteStaleDataHeader(null);
    expect(seen).toEqual([]);
    noteStaleDataHeader(encodeStaleData([{ data: "UniProt FASTA", provider: "UniProt", ageSec: 7200 }]));
    off();
    expect(seen).toEqual([[{ data: "UniProt FASTA", provider: "UniProt", ageSec: 7200 }]]);
    expect(getStaleData()?.notes).toEqual([{ data: "UniProt FASTA", provider: "UniProt", ageSec: 7200 }]);
  });
});
