import { describe, expect, it } from "vitest";
import { decidePrimaryInsilico } from "../insilico/primaryPredictor.ts";
import {
  ALL_VCEP_RULES,
  VCEP_REGISTRY_SNAPSHOT,
  lookupVcepInsilicoRule,
} from "../insilico/vcepRules.ts";

const cleanSplice = {
  maxDs: 0.01,
  status: "settled" as const,
  failure: null,
  coordinateBlocked: false,
  coordinateReason: null,
};

describe("ClinGen CSpec VCEP registry table (113 Active Released specs / 110 genes)", () => {
  it("pins all 110 unique genes and accounts for all 113 active Released CSpec records", () => {
    expect(VCEP_REGISTRY_SNAPSHOT.activeReleasedSpecs).toBe(113);
    expect(VCEP_REGISTRY_SNAPSHOT.uniqueGenes).toBe(110);
    expect(ALL_VCEP_RULES).toHaveLength(110);

    const genes = ALL_VCEP_RULES.map(r => r.gene);
    expect(new Set(genes).size).toBe(110);
    for (const g of genes) expect(g).toBe(g.toUpperCase());

    const specIds = new Set<string>(VCEP_REGISTRY_SNAPSHOT.geneLessSpecs.map(s => s.cspecId));
    for (const r of ALL_VCEP_RULES) {
      specIds.add(r.cspecId);
      for (const alt of r.alternateSpecs ?? []) specIds.add(alt.cspecId);
    }
    expect(specIds.size).toBe(113);
  });

  it("performs case-insensitive lookup and returns null for uncovered genes", () => {
    expect(lookupVcepInsilicoRule("pah")).toEqual(lookupVcepInsilicoRule("PAH"));
    expect(lookupVcepInsilicoRule("  pten ")).toEqual(lookupVcepInsilicoRule("PTEN"));
    expect(lookupVcepInsilicoRule("GBA1")).toBeNull();
    expect(lookupVcepInsilicoRule("GZF1")).toBeNull();
    expect(lookupVcepInsilicoRule("NAE1")).toBeNull();
    expect(lookupVcepInsilicoRule("FGFR3")).toBeNull();
    expect(lookupVcepInsilicoRule(null)).toBeNull();
  });
});

describe("VCEP rules — Group A: REVEL single-cutoff Supporting-only (62 genes)", () => {
  it("applies PTEN strict >0.7 / <0.5 capped at Supporting even at REVEL 0.95", () => {
    expect(decidePrimaryInsilico({ gene: "PTEN", scores: { revel: 0.70 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null, vcepApplied: true });
    expect(decidePrimaryInsilico({ gene: "PTEN", scores: { revel: 0.701 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", strength: "Supporting", criterionSource: "vcep", vcepApplied: true });
    expect(decidePrimaryInsilico({ gene: "PTEN", scores: { revel: 0.95 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", strength: "Supporting", criterionSource: "vcep" });
    expect(decidePrimaryInsilico({ gene: "PTEN", scores: { revel: 0.50 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null });
    expect(decidePrimaryInsilico({ gene: "PTEN", scores: { revel: 0.499 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4", strength: "Supporting", criterionSource: "vcep" });
  });

  it("applies MYH7 (>=0.70 / <=0.40), RUNX1 (>=0.88 / <0.50 + splice >=0.38), and RASopathy 16 genes", () => {
    expect(decidePrimaryInsilico({ gene: "MYH7", scores: { revel: 0.70 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", vcepApplied: true });
    expect(decidePrimaryInsilico({ gene: "MYH7", scores: { revel: 0.69 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null });
    expect(decidePrimaryInsilico({ gene: "MYH7", scores: { revel: 0.40 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4", strength: "Supporting" });

    expect(decidePrimaryInsilico({ gene: "RUNX1", scores: { revel: 0.88 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3" });
    expect(decidePrimaryInsilico({ gene: "RUNX1", scores: { revel: 0.87 }, spliceAi: { ...cleanSplice, maxDs: 0.38 } }))
      .toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai", activeTool: "spliceai" });

    expect(decidePrimaryInsilico({ gene: "PTPN11", scores: { revel: 0.70 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", strength: "Supporting" });
  });

  it("excludes missense BP4 for VHL and DDC", () => {
    expect(decidePrimaryInsilico({ gene: "VHL", scores: { revel: 0.01 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null, vcepApplied: true });
    expect(decidePrimaryInsilico({ gene: "VHL", scores: { revel: 0.664 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3" });
    expect(decidePrimaryInsilico({ gene: "DDC", scores: { revel: 0.05 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null });
    expect(decidePrimaryInsilico({ gene: "DDC", scores: { revel: 0.55 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3" });
  });

  it("applies NF1 paired/threshold splicing, ACTA1 alternateSpecs, ITGA2B/ITGB3 shared GN011, DYSF >0.05 block, and SLC9A6 typo fix", () => {
    expect(decidePrimaryInsilico({
      gene: "NF1",
      scores: { revel: 0.50 },
      spliceAi: { ...cleanSplice, maxDs: 0.40, channels: { ds_ag: 0.40, ds_al: 0.10, ds_dg: 0.0, ds_dl: 0.40 } },
    })).toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai" });
    expect(decidePrimaryInsilico({ gene: "NF1", scores: { revel: 0.10 }, spliceAi: { ...cleanSplice, maxDs: 0.18 } }))
      .toMatchObject({ outcome: "blocked-spliceai", code: null });

    const acta1 = lookupVcepInsilicoRule("ACTA1")!;
    expect(acta1.cspecId).toBe("GN147");
    expect(acta1.alternateSpecs?.map(s => s.cspecId)).toEqual(["GN169"]);

    expect(lookupVcepInsilicoRule("ITGA2B")?.cspecId).toBe("GN011");
    expect(lookupVcepInsilicoRule("ITGB3")?.cspecId).toBe("GN011");

    expect(decidePrimaryInsilico({ gene: "DYSF", scores: { revel: 0.05 }, spliceAi: { ...cleanSplice, maxDs: 0.06 } }))
      .toMatchObject({ outcome: "blocked-spliceai", code: null });

    // SLC9A6: audited 0.644 (not raw typo 0.664)
    const slc9a6 = decidePrimaryInsilico({ gene: "SLC9A6", scores: { revel: 0.644 }, spliceAi: cleanSplice });
    expect(slc9a6).toMatchObject({ outcome: "met", code: "PP3", vcepApplied: true });
    expect(slc9a6.vcepNotes.join(" ")).toContain("0.664");
  });
});

describe("VCEP rules — Group B: REVEL multi-strength (23 genes)", () => {
  it("applies PAH multi-strength with 0.644-0.772 typo correction, BP4_Strong cap, and custom splice bounds", () => {
    expect(decidePrimaryInsilico({ gene: "PAH", scores: { revel: 0.932 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3_Strong", criterionSource: "vcep" });
    expect(decidePrimaryInsilico({ gene: "PAH", scores: { revel: 0.773 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3_Moderate" });
    const pahSup = decidePrimaryInsilico({ gene: "PAH", scores: { revel: 0.750 }, spliceAi: cleanSplice });
    expect(pahSup).toMatchObject({ outcome: "met", code: "PP3", strength: "Supporting" });
    expect(pahSup.vcepNotes.join(" ")).toContain("0.733");
    // BP4 capped at Strong even at REVEL 0.002
    expect(decidePrimaryInsilico({ gene: "PAH", scores: { revel: 0.002 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4_Strong" });
    // SpliceAI 0.25 blocks PAH BP4 (bp4Block >= 0.1) without emitting splicing PP3 (needs > 0.5)
    expect(decidePrimaryInsilico({ gene: "PAH", scores: { revel: 0.002 }, spliceAi: { ...cleanSplice, maxDs: 0.25 } }))
      .toMatchObject({ outcome: "blocked-spliceai", code: null });
    expect(decidePrimaryInsilico({ gene: "PAH", scores: { revel: 0.002 }, spliceAi: { ...cleanSplice, maxDs: 0.55 } }))
      .toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai" });
  });

  it("applies caps and special bands for SCN1A, RPGR/RS1, FOXN1, AIPL1, GP1BA, ABCA4, DNAH5", () => {
    expect(decidePrimaryInsilico({ gene: "SCN1A", scores: { revel: 0.95 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3_Moderate" });
    expect(decidePrimaryInsilico({ gene: "SCN1A", scores: { revel: 0.001 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4_Moderate" });

    const rpgr = decidePrimaryInsilico({ gene: "RPGR", scores: { revel: 0.003 }, spliceAi: cleanSplice });
    expect(rpgr).toMatchObject({ outcome: "met", code: "BP4_VeryStrong" });
    expect(rpgr.vcepNotes.join(" ")).toContain("never BA1");
    expect(decidePrimaryInsilico({ gene: "RS1", scores: { revel: 0.003 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4_VeryStrong" });

    expect(decidePrimaryInsilico({ gene: "FOXN1", scores: { revel: 0.95 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3_Moderate" });

    // AIPL1: audited 0.932 Strong / 0.774 Moderate (rejects typo 0.093!)
    const aipl1 = decidePrimaryInsilico({ gene: "AIPL1", scores: { revel: 0.10 }, spliceAi: cleanSplice });
    expect(aipl1).toMatchObject({ outcome: "met", code: "BP4_Moderate" });
    expect(decidePrimaryInsilico({ gene: "AIPL1", scores: { revel: 0.932 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3_Strong" });
    expect(aipl1.vcepNotes.join(" ")).toContain("0.093");

    expect(decidePrimaryInsilico({ gene: "GP1BA", scores: { revel: 0.10 }, spliceAi: { ...cleanSplice, maxDs: 0.02 } }))
      .toMatchObject({ outcome: "blocked-spliceai", code: null });

    expect(decidePrimaryInsilico({ gene: "ABCA4", scores: { revel: 0.70 }, spliceAi: { ...cleanSplice, maxDs: 0.80 } }))
      .toMatchObject({ outcome: "met", code: "PP3_Moderate", criterionSource: "spliceai" });

    expect(decidePrimaryInsilico({ gene: "DNAH5", scores: { revel: 0.932 }, spliceAi: cleanSplice }).vcepNotes.join(" "))
      .toContain("PM5");
  });
});

describe("VCEP rules — Group C: fallbacks, combos, non-REVEL, advisories, excluded, no unauthorized fallback", () => {
  it("handles ordered fallbacks for CYP1B1 (REVEL -> AM) and HBB/HBA2 (REVEL -> CADD)", () => {
    expect(decidePrimaryInsilico({ gene: "CYP1B1", scores: { revel: null, bayesdel: 0.8, alphaMissense: 0.85 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", activeTool: "alphaMissense", criterionSource: "vcep", skippedBefore: ["revel"] });
    // No unauthorized fallback when neither REVEL nor AM exists
    expect(decidePrimaryInsilico({ gene: "CYP1B1", scores: { revel: null, bayesdel: 0.8, alphaMissense: null }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "no-score", code: null });

    expect(decidePrimaryInsilico({ gene: "HBB", scores: { revel: null, cadd: 24.0 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", activeTool: "cadd", criterionSource: "vcep" });
    // Walker >= 0.20 still blocks HBA2 BP4 even though HBA2 splicing PP3 requires > 0.30
    expect(decidePrimaryInsilico({ gene: "HBA2", scores: { revel: 0.20 }, spliceAi: { ...cleanSplice, maxDs: 0.25 } }))
      .toMatchObject({ outcome: "blocked-spliceai", code: null });
  });

  it("handles all-of combos (CTLA4, PIK3CD, PIK3R1) and k-of-n combo (BMPR2)", () => {
    expect(decidePrimaryInsilico({ gene: "CTLA4", scores: { revel: 0.70, cadd: 26.0 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", criterionSource: "vcep" });
    expect(decidePrimaryInsilico({ gene: "CTLA4", scores: { revel: 0.70, cadd: 20.0 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null });
    expect(decidePrimaryInsilico({ gene: "CTLA4", scores: { revel: 0.70, cadd: null }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "no-score", code: null });

    // PIK3CD disables splicing PP3 for missense variants + notes AD GoF vs AR LoF
    const pik3cd = decidePrimaryInsilico({ gene: "PIK3CD", scores: { revel: 0.10, cadd: 15.0 }, spliceAi: { ...cleanSplice, maxDs: 0.85 } });
    expect(pik3cd).toMatchObject({ outcome: "blocked-spliceai", code: null });
    expect(pik3cd.vcepNotes.join(" ")).toContain("gain-of-function");

    expect(decidePrimaryInsilico({ gene: "PIK3R1", scores: { revel: 0.20, cadd: 21.5 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4", criterionSource: "vcep" });

    // BMPR2: 2 of 3 agree
    expect(decidePrimaryInsilico({ gene: "BMPR2", scores: { revel: 0.70, alphaMissense: 0.50, cadd: 26.0 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", criterionSource: "vcep" });
    expect(decidePrimaryInsilico({ gene: "BMPR2", scores: { revel: 0.70, alphaMissense: 0.10, cadd: 24.0 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "indeterminate", code: null });
    expect(decidePrimaryInsilico({ gene: "BMPR2", scores: { revel: 0.70, alphaMissense: null, cadd: null }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "no-score", code: null });
  });

  it("handles non-REVEL single tools (DDX41, CEP290) independent of dbNSFP baseStatus", () => {
    expect(decidePrimaryInsilico({ gene: "DDX41", scores: { revel: 0.99, alphaMissense: null }, baseStatus: "timeout", spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "no-score", code: null, vcepApplied: true });
    expect(decidePrimaryInsilico({ gene: "DDX41", scores: { alphaMissense: 0.80 }, baseStatus: "timeout", spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "PP3", activeTool: "alphaMissense", criterionSource: "vcep" });

    const cep = decidePrimaryInsilico({ gene: "CEP290", scores: { cadd: 28.1 }, baseStatus: "timeout", spliceAi: cleanSplice });
    expect(cep).toMatchObject({ outcome: "met", code: "PP3_Moderate", activeTool: "cadd", criterionSource: "vcep" });
    expect(decidePrimaryInsilico({ gene: "CEP290", scores: { cadd: 0.15 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "met", code: "BP4_Moderate", activeTool: "cadd" });
    expect(cep.vcepNotes.join(" ")).toContain("BP4_Strong");
  });

  it("keeps default chain for advisory genes (TP53, BRCA1, BRCA2, RYR1) while surfacing curator notes", () => {
    for (const gene of ["TP53", "BRCA1", "BRCA2", "RYR1"] as const) {
      const dec = decidePrimaryInsilico({ gene, scores: { revel: 0.95 }, spliceAi: cleanSplice });
      expect(dec).toMatchObject({ outcome: "met", code: "PP3_Strong", criterionSource: "chain", vcepApplied: false });
      expect(dec.vcepNotes.length).toBeGreaterThan(0);
    }
    expect(lookupVcepInsilicoRule("RYR1")?.alternateSpecs?.map(s => s.cspecId)).toEqual(["GN150", "GN179"]);
  });

  it("excludes missense predictors for 12 excluded genes while allowing Walker 2023 splicing PP3 on PALB2/APC/CDH1 only", () => {
    for (const gene of ["PALB2", "APC", "CDH1"] as const) {
      expect(decidePrimaryInsilico({ gene, scores: { revel: 0.95 }, baseStatus: "timeout", spliceAi: cleanSplice }))
        .toMatchObject({ outcome: "vcep-excluded", code: null, vcepApplied: true });
      expect(decidePrimaryInsilico({ gene, scores: { revel: 0.95 }, spliceAi: { ...cleanSplice, maxDs: 0.35 } }))
        .toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai", activeTool: "spliceai" });
    }
    expect(lookupVcepInsilicoRule("CDH1")?.notes?.join(" ")).toContain("3");

    for (const gene of ["ADA", "DCLRE1C", "IL7R", "JAK3", "RAG1", "RAG2", "IL2RG", "GFAP", "RMRP"] as const) {
      expect(decidePrimaryInsilico({ gene, scores: { revel: 0.95 }, spliceAi: { ...cleanSplice, maxDs: 0.85 } }))
        .toMatchObject({ outcome: "vcep-excluded", code: null, vcepApplied: true });
    }
  });

  it("never falls back beyond a VCEP's specified tool list", () => {
    expect(decidePrimaryInsilico({ gene: "PTEN", scores: { revel: null, bayesdel: 0.9, alphaMissense: 0.99 }, spliceAi: cleanSplice }))
      .toMatchObject({ outcome: "no-score", code: null, vcepApplied: true });
  });
});