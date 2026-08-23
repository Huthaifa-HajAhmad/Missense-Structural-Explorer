import { describe, it, expect } from "vitest";
import { fetchClinVarData } from "../services/clinvar.ts";
import { fetchUniprotSequence } from "../services/uniprot.ts";
import { fetchGnomadVariantFrequency } from "../services/gnomad.ts";

/**
 * Live API Smoke Test Suite (Tier 2).
 *
 * Runs against upstream live APIs (NCBI ClinVar, UniProtKB, gnomAD) with known
 * well-characterized clinical reference variants to catch schema changes or deprecations early.
 *
 * Gated by process.env.RUN_SMOKE_TESTS === "true" so offline PR test runs remain fast.
 */
const runSmoke = process.env.RUN_SMOKE_TESTS === "true";
const describeSmoke = runSmoke ? describe : describe.skip;

describeSmoke("Live API Smoke Tests (Tier 2)", () => {
  it("should fetch live UniProt sequence for TP53 (P04637)", async () => {
    const seq = await fetchUniprotSequence("P04637");
    expect(seq).toBeDefined();
    expect(seq.length).toBeGreaterThanOrEqual(390);
    expect(seq.startsWith("MEEPQSDPSV")).toBe(true);
  }, 15000);

  it("should fetch live ClinVar entry for PAH p.Arg408Trp", async () => {
    const res = await fetchClinVarData("PAH", "p.Arg408Trp");
    expect(res).toBeDefined();
    expect(res.classification).toBeDefined();
  }, 15000);

  it("should fetch live gnomAD frequency for TP53 p.Arg273His (17-7577121-G-A)", async () => {
    const res = await fetchGnomadVariantFrequency("17-7577121-G-A");
    expect(res).toBeDefined();
    if (res) {
      expect(res.dataset).toBeDefined();
    }
  }, 15000);
});
