/**
 * acmg.frequency.test.ts — the engine's population rules on the reference variant UROD p.Gly318Arg.
 *
 * Pins the corrections of the Evidence audit (doc/EVIDENCE_TABS_FULL_AUDIT.md):
 *   • BA1/BS1 read FAF95 when gnomAD reports it; PM2 reads the raw grouped maximum;
 *   • PM2's ceiling comes from curated GenCC inheritance before pLI;
 *   • BS2 is not read from homozygotes on a sex chromosome.
 */
import { describe, expect, it } from "vitest";
import { computeRuleBasedACMG } from "./acmg.ts";

const base = {
  gene: "UROD",
  variant: "p.Gly318Arg",
  clinvar: null,
  predictorData: { available: true, gnomadVariantId: "1-45015346-G-A" },
  conservationData: null,
  gnomadConstraint: { missense_z: 1.78, oe_mis: 0.8, pli: 0, isPP2Constrained: false },
  serviceStatus: { gnomadFrequency: "ok" },
} as any;

const UROD_REMOTE = {
  maxAF: 0.004872, groupMaxAF: 1272 / 75018, genomeAF: 0.004872, exomeAF: 0.000638,
  nHomozygous: 15, dataset: "gnomad_r4", groupMaxPopulation: "afr", faf95: 0.01618, faf95Population: "afr",
};
const UROD_LOCAL = { maxAF: 1674 / 1613998, groupMaxAF: 1674 / 1613998, genomeAF: 1674 / 1613998, exomeAF: null, nHomozygous: 15, dataset: "gnomad_r4_local" };
const UROD_INHERITANCE = { source: "GenCC", modes: ["Autosomal dominant", "Autosomal recessive", "Semidominant"], recessiveOnly: false, sexOrMitoOnly: false, records: 3 } as const;

const codes = (input: any) => computeRuleBasedACMG(input).acmgCriteria.map(c => c.code);

describe("ACMG frequency rules — UROD p.Gly318Arg", () => {
  it("withholds BS1 above 1% FAF95 (1.62%, afr) because the app-wide cut-point is not disease-specific", () => {
    const res = computeRuleBasedACMG({ ...base, gnomadFrequency: UROD_REMOTE, curatedInheritance: UROD_INHERITANCE });
    expect(codes({ ...base, gnomadFrequency: UROD_REMOTE })).not.toContain("BS1");
    expect(codes({ ...base, gnomadFrequency: UROD_REMOTE })).not.toContain("PM2");
    expect(res.partialEvidence.unavailable.some(u => /^BS1 \(not applied:.*filtering allele frequency \(FAF95\) 1\.618%/.test(u))).toBe(true);
  });

  it("reads the local combined figure as 'between the cut-points', and says what it lacks", () => {
    const res = computeRuleBasedACMG({ ...base, gnomadFrequency: UROD_LOCAL, curatedInheritance: UROD_INHERITANCE });
    expect(res.acmgCriteria.map(c => c.code)).not.toContain("BS1");
    expect(res.acmgCriteria.map(c => c.code)).not.toContain("PM2");
  });

  it("withholds BS2 from 15 autosomal homozygotes (gnomAD lacks unaffected phenotype) as well as on chromosome X", () => {
    const auto = computeRuleBasedACMG({ ...base, gnomadFrequency: UROD_REMOTE });
    expect(auto.acmgCriteria.map(c => c.code)).not.toContain("BS2");
    expect(auto.partialEvidence.unavailable.some(u => /^BS2 \(not applied:/.test(u))).toBe(true);
    const onX = computeRuleBasedACMG({ ...base, predictorData: { available: true, gnomadVariantId: "X-1000-G-A" }, gnomadFrequency: UROD_REMOTE });
    expect(onX.acmgCriteria.map(c => c.code)).not.toContain("BS2");
    expect(onX.partialEvidence.unavailable.some(u => /^BS2 \(homozygote count not applied: the variant is on chromosome X/.test(u))).toBe(true);
  });

  it("withholds BS2 on chromosome Y and the mitochondrion at engine level too — chr-prefixed and MT forms included", () => {
    for (const variantId of ["Y-1000-G-A", "chrY-1000-G-A", "chrMT-5700-G-A", "M-5700-G-A"]) {
      const res = computeRuleBasedACMG({ ...base, predictorData: { available: true, gnomadVariantId: variantId }, gnomadFrequency: UROD_REMOTE });
      expect(res.acmgCriteria.map(c => c.code), `${variantId} must not record BS2`).not.toContain("BS2");
      expect(res.partialEvidence.unavailable.some(u => u.startsWith("BS2 (homozygote count not applied")), `${variantId} records why`).toBe(true);
    }
  });
});

describe("ACMG frequency rules — PM2 ceiling basis", () => {
  // 0.05%: above the lower 0.01% ceiling, below the higher 0.1% ceiling.
  const rare = { maxAF: 0.0005, groupMaxAF: 0.0005, genomeAF: 0.0005, exomeAF: 0.0005, nHomozygous: 0, dataset: "gnomad_r4", groupMaxPopulation: "nfe" };

  it("uses the lower ceiling when curated inheritance includes a dominant mode, even with pLI 0", () => {
    expect(codes({ ...base, gnomadFrequency: rare, curatedInheritance: UROD_INHERITANCE })).not.toContain("PM2");
  });

  it("uses the higher ceiling when every curated record is autosomal recessive, even with pLI 1", () => {
    const res = computeRuleBasedACMG({
      ...base, gnomadConstraint: { ...base.gnomadConstraint, pli: 1 }, gnomadFrequency: rare,
      curatedInheritance: { source: "GenCC", modes: ["Autosomal recessive"], recessiveOnly: true, sexOrMitoOnly: false, records: 2 },
    });
    expect(res.acmgCriteria.find(c => c.code === "PM2")?.reason).toMatch(/every curated GenCC record is autosomal recessive/);
  });

  it("falls back to pLI without curated inheritance, and says so", () => {
    const res = computeRuleBasedACMG({ ...base, gnomadFrequency: rare, curatedInheritance: null });
    expect(res.acmgCriteria.find(c => c.code === "PM2")?.reason).toMatch(/no curated inheritance; pLI 0\.00 < 0\.9/);
  });
});

describe("ACMG frequency rules — protein change with several candidate alleles", () => {
  /** FGFR3 p.Gly380Arg on protein-only input: G>A or G>C at one GRCh38 base. */
  const multi = {
    ...base, gene: "FGFR3", variant: "p.Gly380Arg",
    predictorData: { available: true, gnomadVariantId: null, locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [] } },
  };
  const found = (alt: string, af: number, extra: Record<string, unknown> = {}) => ({
    id: `4-1804392-G-${alt}`, grch37Id: `4-1806119-G-${alt}`, outcome: "found",
    frequency: { maxAF: af, groupMaxAF: af, genomeAF: af, exomeAF: null, nHomozygous: 0, dataset: "gnomad_r4", ...extra },
  });
  const absent = (alt: string) => ({ id: `4-1804392-G-${alt}`, grch37Id: `4-1806119-G-${alt}`, outcome: "not-found", frequency: null });
  const run = (candidates: unknown[]) => computeRuleBasedACMG({
    ...multi, gnomadFrequency: { maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, nHomozygous: null, dataset: "gnomad_r4", candidates },
  });
  const frequencyCodes = (res: ReturnType<typeof computeRuleBasedACMG>) =>
    res.acmgCriteria.map(c => c.code).filter(code => ["BA1", "BS1", "PM2", "BS2"].includes(code));

  it("applies PM2 when every candidate is at or below the ceiling, and says so", () => {
    const res = run([absent("A"), found("C", 0.000001)]);
    expect(frequencyCodes(res)).toEqual(["PM2"]);
    expect(res.acmgCriteria.find(c => c.code === "PM2")?.reason).toMatch(/every candidate allele \(2: 4-1804392-G-A, 4-1804392-G-C\)/);
  });

  it("withholds BS1 even when every candidate is above the 1% reference cut-point on its own FAF95", () => {
    const res = run([found("A", 0.03, { faf95: 0.02 }), found("C", 0.04, { faf95: 0.015 })]);
    expect(frequencyCodes(res)).toEqual([]);
    expect(res.partialEvidence.unavailable.some(u => u.startsWith("BS1 (not applied:"))).toBe(true);
  });

  it("withholds BS1 and BA1 when every candidate is above 1% but only one is above BA1", () => {
    expect(frequencyCodes(run([found("A", 0.07, { faf95: 0.06 }), found("C", 0.04, { faf95: 0.03 })]))).toEqual([]);
  });

  it("applies no frequency criterion when the candidates disagree, and records why", () => {
    const res = run([found("A", 0.03, { faf95: 0.02 }), absent("C")]);
    expect(frequencyCodes(res)).toEqual([]);
    expect(res.partialEvidence.unavailable.some(u => /candidate alleles disagree/.test(u))).toBe(true);
  });

  it("withholds every frequency criterion and names the candidate whose query failed", () => {
    const res = run([absent("A"), { ...absent("C"), outcome: "failed", detail: "the gnomAD query failed" }]);
    expect(frequencyCodes(res)).toEqual([]);
    expect(res.partialEvidence.unavailable.some(u => u.includes("4-1804392-G-C"))).toBe(true);
  });

  it("withholds BS2 even when every candidate has two or more homozygotes without unaffected phenotype", () => {
    const res = run([found("A", 0.006, { nHomozygous: 3 }), found("C", 0.006, { nHomozygous: 2 })]);
    expect(frequencyCodes(res)).not.toContain("BS2");
    expect(res.partialEvidence.unavailable.some(u => u.startsWith("BS2 (not applied:"))).toBe(true);
    expect(frequencyCodes(run([found("A", 0.006, { nHomozygous: 3 }), found("C", 0.006, { nHomozygous: 1 })]))).not.toContain("BS2");
  });

  it("HbS regression (missense#13): HBB p.Glu7Val (4.82% FAF95, 40 homozygotes, ClinVar Pathogenic) is NOT classified Benign", () => {
    const hbs = computeRuleBasedACMG({
      gene: "HBB",
      variant: "p.Glu7Val",
      clinvar: { classification: "Pathogenic", uid: "15333", reviewStatus: "reviewed by expert panel", trait: "Sickle cell disease" },
      predictorData: { available: true, gnomadVariantId: "11-5227002-T-A", amPathogenicity: 0.25, caddPhred: 12 },
      conservationData: { available: true, revel: 0.2, metarnn: 0.1, clinpred: 0.1 },
      gnomadConstraint: { pli: 0.0, missense_z: 0.67, oe_mis: 0.88, isPP2Constrained: false },
      gnomadFrequency: {
        maxAF: 0.0495, groupMaxAF: 0.0495, genomeAF: 0.01272, exomeAF: 0.001601,
        nHomozygous: 40, dataset: "gnomad_r4", groupMaxPopulation: "afr",
        faf95: 0.04816, faf95Population: "afr",
      },
      acmgWeighting: "standard",
    });
    expect(hbs.acmgCriteria.map(c => c.code)).not.toContain("BS1");
    expect(hbs.acmgCriteria.map(c => c.code)).not.toContain("BS2");
    expect(hbs.acmgVerdict).not.toBe("Benign");
    expect(hbs.acmgVerdict).not.toBe("Likely Benign");
    expect(hbs.acmgVerdict).toBe("Variant of Uncertain Significance (VUS)");
  });
});
