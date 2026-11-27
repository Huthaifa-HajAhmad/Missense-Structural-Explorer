import { describe, expect, it } from "vitest";
import { classifyAcmgFrequency, type FrequencyEvidenceInput } from "../frequencyEvidence.ts";
import { pm2Hold, pm2HoldReason } from "../frequencyRule.ts";

/**
 * The Population tab explains the engine's PM2 holds with the same shared rule (`pm2Hold`), so the
 * tab cannot say "Extremely rare · PM2" where the engine withheld it. Case: ABCG1 p.Gly358Arg,
 * local combined gnomAD 651 / 1,613,518 with 6 homozygotes, All of Us 0.078%, recessive 0.10% ceiling.
 */
const abcg1: FrequencyEvidenceInput = {
  gnomadFrequency: {
    maxAF: 651 / 1613518, groupMaxAF: 651 / 1613518, genomeAF: null, exomeAF: null, nHomozygous: 6,
    dataset: "gnomad_r4_local", standIn: "grace",
  } as any,
  aouFrequency: { aouAC: 156, aouAN: 200000, aouHet: 156, aouHom: 0 },
  serviceStatus: { gnomadFrequency: "stand-in" },
  assembly: "GRCh38",
  pli: 0,
  locus: { predictorData: { gnomadVariantId: "21-42287987-G-A", gnomadVariantAssembly: "GRCh38" } } as any,
};

describe("Population tab PM2 holds", () => {
  it("says PM2 is withheld for six homozygotes, not that the allele is extremely rare", () => {
    const criterion = classifyAcmgFrequency(abcg1);
    expect(criterion.code).toBe("none");
    expect(criterion.headline).toBe("PM2 withheld");
    expect(criterion.statement).toContain("6 homozygotes");
  });

  it("names the All of Us reading when it is above the ceiling", () => {
    const criterion = classifyAcmgFrequency({
      ...abcg1,
      gnomadFrequency: { ...abcg1.gnomadFrequency!, nHomozygous: 0, dataset: "gnomad_r4", groupMaxPopulation: "nfe", standIn: null } as any,
      aouFrequency: { aouAC: 300, aouAN: 200000, aouHet: 300, aouHom: 0 },
      serviceStatus: { gnomadFrequency: "ok" },
    });
    expect(criterion.code).toBe("none");
    expect(criterion.statement).toContain("All of Us");
  });
});

describe("Population tab PM2 holds — several candidate alleles", () => {
  it("says PM2 is withheld when one candidate has homozygotes", () => {
    const criterion = classifyAcmgFrequency({
      gnomadFrequency: {
        maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, nHomozygous: null, dataset: "gnomad_r4",
        candidates: [
          { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "not-found", frequency: null },
          { id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "found",
            frequency: { maxAF: 0.0004, groupMaxAF: 0.0004, genomeAF: 0.0004, exomeAF: null, nHomozygous: 3, dataset: "gnomad_r4" } },
        ],
      } as any,
      serviceStatus: { gnomadFrequency: "ok" },
      assembly: "GRCh38",
      pli: 0,
      locus: { predictorData: { gnomadVariantId: null, locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [] } } } as any,
    });
    expect(criterion.code).toBe("none");
    expect(criterion.headline).toBe("PM2 withheld");
    expect(criterion.statement).toContain("3 homozygotes");
  });
});

describe("pm2Hold", () => {
  const combined = { pm2Af: 0.0004, pm2Statistic: "combined", benignAf: 0.0004, benignStatistic: "combined" } as const;
  const grouped = { ...combined, pm2Statistic: "group-max", benignStatistic: "group-max" } as const;

  it("puts homozygotes first, then All of Us, then the missing ancestry groups", () => {
    expect(pm2Hold(combined, { ceiling: 0.001, nHomozygous: 6, homozygotesInform: true, aouAf: 0.002 })?.kind).toBe("homozygotes");
    expect(pm2Hold(combined, { ceiling: 0.001, nHomozygous: 1, homozygotesInform: true, aouAf: 0.002 })?.kind).toBe("all-of-us");
    expect(pm2Hold(combined, { ceiling: 0.001, nHomozygous: 1, homozygotesInform: true })?.kind).toBe("ancestry-unmeasured");
  });

  it("holds nothing for grouped gnomAD below the ceiling with fewer than two homozygotes", () => {
    expect(pm2Hold(grouped, { ceiling: 0.001, nHomozygous: 1, homozygotesInform: true, aouAf: 0.0008 })).toBeNull();
    expect(pm2Hold(grouped, { ceiling: 0.001, nHomozygous: 6, homozygotesInform: false })).toBeNull();
  });

  it("words the ancestry hold with the figures it used", () => {
    expect(pm2HoldReason({ kind: "ancestry-unmeasured", af: 651 / 1613518, floor: 0.0001 })).toContain("0.040%");
    expect(pm2HoldReason({ kind: "ancestry-unmeasured", af: 651 / 1613518, floor: 0.0001 })).toContain("0.01%");
  });
});
