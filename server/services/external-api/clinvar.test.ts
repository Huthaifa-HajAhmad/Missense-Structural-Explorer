import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchClinVarData } from "./clinvar.ts";
import { clearAllCaches } from "../infra/cache.ts";
import { VCV_CNNM2_E357K } from "./clinvar-vcv.fixture.ts";

/** ClinVar's full variant record is a third request; most tests here do not exercise it. */
const noVariantRecord = (spy: { mockResolvedValue: (v: any) => unknown }) => spy.mockResolvedValue({ ok: false, status: 404 });

describe("fetchClinVarData", () => {
  beforeEach(() => {
    // Some tests below leave their fetch spy in place; start each one clean.
    vi.restoreAllMocks();
    clearAllCaches(true);
  });

  it("should return parsed results if variant title matches (exact or mapped AA codes)", async () => {
    const mockSearchResponse = {
      esearchresult: {
        idlist: ["12345"]
      }
    };

    const mockSummaryResponse = {
      result: {
        uids: ["12345"],
        "12345": {
          title: "NM_000277.3(PAH):c.1224C>T (p.Arg408Trp)",
          germline_classification: {
            description: "Pathogenic",
            last_evaluated: "2023-01-01",
            review_status: "practice guideline",
            trait_set: [{ trait_name: "Phenylketonuria", trait_xrefs: [
              { db_source: 'MONDO', db_id: 'MONDO:0009861' },
              { db_source: 'OMIM', db_id: '261600' },
              { db_source: 'UnknownSource', db_id: 'raw-identifier' }
            ] }]
          },
          allele_freq_set: [
            { source: "gnomAD", value: "0.0005" }
          ]
        }
      }
    };

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResponse
    } as any);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummaryResponse
    } as any);

    noVariantRecord(fetchSpy);

    const res = await fetchClinVarData("PAH", "p.Arg408Trp");
    expect(res.classification).toBe("Pathogenic");
    expect(res.conditionsRead).toBe("summary-only");
    expect(res.trait).toBe("Phenylketonuria");
    expect(res.conditions).toEqual([{ label: 'Phenylketonuria', xrefs: [
      { source: 'MONDO', id: 'MONDO:0009861' },
      { source: 'OMIM', id: '261600' },
      { source: 'UnknownSource', id: 'raw-identifier' }
    ] }]);
    expect(res.uid).toBe("12345");
    expect(res.alleleFrequencies[0].value).toBe("0.0005");

    fetchSpy.mockRestore();
  });

  it("should not match and return default response if title doesn't match clean variant", async () => {
    const mockSearchResponse = {
      esearchresult: {
        idlist: ["67890"]
      }
    };

    const mockSummaryResponse = {
      result: {
        uids: ["67890"],
        "67890": {
          title: "NM_000277.3(PAH):c.1000G>A (p.Ala123Val)",
          germline_classification: {
            description: "Benign"
          }
        }
      }
    };

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResponse
    } as any);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummaryResponse
    } as any);

    const res = await fetchClinVarData("PAH", "p.Arg408Trp");
    expect(res.classification).toBe("Not found in ClinVar");
    expect(res.uid).toBeNull();

    fetchSpy.mockRestore();
  });

  it("should support direct search by Variation ID or VCV ID", async () => {
    const mockSearchResponse = {
      esearchresult: {
        idlist: ["98765"]
      }
    };

    const mockSummaryResponse = {
      result: {
        uids: ["98765"],
        "98765": {
          title: "NM_000277.3(PAH):c.1224C>T (p.Arg408Trp)",
          germline_classification: {
            description: "Pathogenic",
            last_evaluated: "2023-01-01",
            review_status: "practice guideline",
            trait_set: [{ trait_name: "Phenylketonuria" }]
          },
          allele_freq_set: []
        }
      }
    };

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSearchResponse
    } as any);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummaryResponse
    } as any);

    noVariantRecord(fetchSpy);

    const res = await fetchClinVarData("PAH", "VCV000098765");
    expect(res.classification).toBe("Pathogenic");
    expect(res.uid).toBe("98765");

    // Verify search term is structured for Variation ID
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("term=98765%5BVariation%20ID%5D"),
      expect.any(Object)
    );

    fetchSpy.mockRestore();
  });
  describe("PS1 support (another record with the same amino-acid change)", () => {
    const entry = (cdna: string, description: string) => ({
      title: `NM_000277.3(PAH):${cdna} (p.Arg408Trp)`,
      germline_classification: { description, last_evaluated: "2023-01-01", review_status: "criteria provided, single submitter", trait_set: [] },
      allele_freq_set: [],
    });
    const run = async (otherDescription: string) => {
      const fetchSpy = vi.spyOn(global, "fetch");
      fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ esearchresult: { idlist: ["1", "2"] } }) } as any);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { uids: ["1", "2"], "1": entry("c.1222C>T", "Uncertain significance"), "2": entry("c.1224C>T", otherDescription) } }),
      } as any);
      noVariantRecord(fetchSpy);
      return fetchClinVarData("PAH", "p.Arg408Trp");
    };

    it("a Conflicting record is not an established pathogenic one", async () => {
      const res = await run("Conflicting interpretations of pathogenicity");
      expect(res.hasOtherPathogenicVariantSameAA).toBe(false);
    });

    it("a Pathogenic / Likely pathogenic record at a different nucleotide change is", async () => {
      const res = await run("Pathogenic/Likely pathogenic");
      expect(res.hasOtherPathogenicVariantSameAA).toBe(true);
    });
  });

  describe("conditions from the full variant record", () => {
    const search = { esearchresult: { idlist: ["192324"] } };
    // The summary lists only the condition behind the aggregate classification: "not provided".
    const summary = { result: { uids: ["192324"], "192324": {
      title: "NM_017649.5(CNNM2):c.1069G>A (p.Glu357Lys)",
      germline_classification: { description: "Pathogenic", last_evaluated: "2026-06-28", review_status: "criteria provided, multiple submitters, no conflicts",
        trait_set: [{ trait_name: "not provided", trait_xrefs: [{ db_source: "MedGen", db_id: "C3661900" }] }] },
      allele_freq_set: [],
    } } };
    const mock = (vcv: unknown) => {
      const spy = vi.spyOn(global, "fetch");
      spy.mockResolvedValueOnce({ ok: true, json: async () => search } as any);
      spy.mockResolvedValueOnce({ ok: true, json: async () => summary } as any);
      spy.mockResolvedValueOnce(vcv as any);
      return spy;
    };

    it("lists every condition, with its own record, when the variant record is read", async () => {
      const spy = mock({ ok: true, text: async () => VCV_CNNM2_E357K });
      const res = await fetchClinVarData("CNNM2", "p.Glu357Lys");
      expect(res.conditionsRead).toBe("full-record");
      expect(res.conditions?.map(c => c.label)).toEqual(["Hypomagnesemia, seizures, and intellectual disability 1", "not provided"]);
      expect(res.conditions?.[0].record).toMatchObject({ accession: "RCV000172914", classification: "Pathogenic", inAggregate: false });
      expect(spy.mock.calls[2][0]).toContain("efetch.fcgi?db=clinvar&rettype=vcv&is_variationid=true&from_esearch=true&id=192324");
      spy.mockRestore();
    });

    it("falls back to the summary conditions and says so when the variant record cannot be read", async () => {
      const spy = mock({ ok: false, status: 404 });
      const res = await fetchClinVarData("CNNM2", "p.Glu357Lys");
      expect(res.classification).toBe("Pathogenic");
      expect(res.conditionsRead).toBe("summary-only");
      expect(res.conditions).toEqual([{ label: "not provided", xrefs: [{ source: "MedGen", id: "C3661900" }] }]);
      spy.mockRestore();
    });

    it("falls back the same way when the variant record request throws, is cut off, or is not XML we can read", async () => {
      const cutOff = VCV_CNNM2_E357K.slice(0, VCV_CNNM2_E357K.indexOf("</VariationArchive>"));
      for (const vcv of [
        { ok: true, text: async () => "<html>maintenance</html>" },
        { ok: true, text: async () => cutOff },
        { ok: true, text: async () => { throw new Error("socket closed"); } },
      ]) {
        clearAllCaches(true);
        const spy = mock(vcv);
        expect((await fetchClinVarData("CNNM2", "p.Glu357Lys")).conditionsRead).toBe("summary-only");
        spy.mockRestore();
      }
    });

    it("counts a complete record with no conditions as read, not as a failure", async () => {
      const spy = mock({ ok: true, text: async () => "<ClinVarResult-Set><VariationArchive><ClassifiedRecord><ConditionList></ConditionList></ClassifiedRecord></VariationArchive></ClinVarResult-Set>" });
      const res = await fetchClinVarData("CNNM2", "p.Glu357Lys");
      expect(res.conditionsRead).toBe("full-record");
      expect(res.conditions).toEqual([]);
      spy.mockRestore();
    });

    it("makes one short attempt at the variant record and does not retry it, so a failing endpoint cannot stall ClinVar", async () => {
      const spy = mock({ ok: false, status: 500 });
      const res = await fetchClinVarData("CNNM2", "p.Glu357Lys");
      expect(res.conditionsRead).toBe("summary-only");
      expect(spy).toHaveBeenCalledTimes(3);
      spy.mockRestore();
    });

    it("keeps a full answer in the cache, and a summary-only one only briefly", async () => {
      const full = mock({ ok: true, text: async () => VCV_CNNM2_E357K });
      await fetchClinVarData("CNNM2", "p.Glu357Lys");
      const calls = full.mock.calls.length;
      await fetchClinVarData("CNNM2", "p.Glu357Lys");
      expect(full.mock.calls.length).toBe(calls);
      full.mockRestore();

      // Summary-only: held in memory for a few minutes (a burst does not repeat the failing request), but
      // never written to the week-long store, so a later process tries the full record again.
      clearAllCaches(true);
      const partial = mock({ ok: false, status: 404 });
      await fetchClinVarData("CNNM2", "p.Glu357Lys");
      const before = partial.mock.calls.length;
      expect((await fetchClinVarData("CNNM2", "p.Glu357Lys")).conditionsRead).toBe("summary-only");
      expect(partial.mock.calls.length).toBe(before);
      clearAllCaches(false);
      partial.mockResolvedValueOnce({ ok: true, json: async () => search } as any);
      partial.mockResolvedValueOnce({ ok: true, json: async () => summary } as any);
      partial.mockResolvedValueOnce({ ok: true, text: async () => VCV_CNNM2_E357K } as any);
      expect((await fetchClinVarData("CNNM2", "p.Glu357Lys")).conditionsRead).toBe("full-record");
      partial.mockRestore();
    });
  });
});
