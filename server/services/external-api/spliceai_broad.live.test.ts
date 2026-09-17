import { describe, it, expect } from "vitest";
import { fetchSpliceAiBroad } from "./spliceai_broad.ts";

/**
 * Live smoke test against the Broad Institute SpliceAI Lookup API.
 *
 * Skipped by default: it makes a real network call to a third-party academic service
 * that is explicitly rate-limited to a handful of queries per user per minute, so it
 * must not run in CI or on every `npm test`.
 *
 * Run deliberately with:
 *   SPLICEAI_LIVE=1 npx vitest run server/services/external-api/spliceai_broad.live.test.ts
 *
 * The variant is the one that motivated this integration: MACO1 p.Glu433Lys, 16 bp from
 * the exon 7 donor. dbNSFP's precomputed columns carry no SpliceAI value for it, which
 * made the app report "Unavailable / Unmapped" for a position SpliceAI does score.
 */
describe.runIf(process.env.SPLICEAI_LIVE === "1")("fetchSpliceAiBroad — live API", () => {
  it("scores MACO1 p.Glu433Lys, which the precomputed tables could not", async () => {
    const score = await fetchSpliceAiBroad("1", 25484258, "G", "A", { skipCache: true });

    expect(score).not.toBeNull();
    expect(score!.geneSymbol).toBe("MACO1");
    // MANE Select is preferred so the score matches the transcript the app reports.
    expect(score!.isManeSelect).toBe(true);
    expect(score!.transcriptId).toMatch(/^ENST/);

    // The four channels must be present and bounded; max_ds must equal the largest.
    const channels = [score!.ds_ag, score!.ds_al, score!.ds_dg, score!.ds_dl];
    for (const c of channels) {
      if (c !== null) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    expect(score!.max_ds).toBe(Math.max(...channels.map(c => c ?? 0)));

    // The reporting window and masking are recorded so the number is reproducible.
    expect(score!.distance).toBe(500);
    expect(score!.mask).toBe(1);

    // Delta positions localise the shift; this variant sits ~123 bp from the affected donor.
    expect(score!.dp).toHaveProperty("ds_dl");
  }, 60_000);

  it("returns null rather than throwing for an unscoreable position", async () => {
    // Chromosome 1 position 1 is outside any gene; the API cannot score it.
    const score = await fetchSpliceAiBroad("1", 1, "A", "G", { skipCache: true });
    expect(score).toBeNull();
  }, 60_000);
});
