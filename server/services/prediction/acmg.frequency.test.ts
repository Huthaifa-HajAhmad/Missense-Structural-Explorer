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
  it("records BS1 from gnomAD's FAF95 (1.62%, afr), and names the statistic in the reason", () => {
    const res = computeRuleBasedACMG({ ...base, gnomadFrequency: UROD_REMOTE, curatedInheritance: UROD_INHERITANCE });
    const bs1 = res.acmgCriteria.find(c => c.code === "BS1");
    expect(bs1?.reason).toMatch(/filtering allele frequency \(FAF95\) 1\.618%/);
    expect(codes({ ...base, gnomadFrequency: UROD_REMOTE })).not.toContain("PM2");
  });

  it("reads the local combined figure as 'between the cut-points', and says what it lacks", () => {
    const res = computeRuleBasedACMG({ ...base, gnomadFrequency: UROD_LOCAL, curatedInheritance: UROD_INHERITANCE });
    expect(res.acmgCriteria.map(c => c.code)).not.toContain("BS1");
    expect(res.acmgCriteria.map(c => c.code)).not.toContain("PM2");
  });

  it("records BS2 from 15 autosomal homozygotes, and not from homozygotes on chromosome X", () => {
    expect(codes({ ...base, gnomadFrequency: UROD_REMOTE })).toContain("BS2");
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
