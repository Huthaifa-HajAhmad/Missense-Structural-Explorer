/**
 * What the Population tab and its rail read for a protein-only input that several nucleotide alleles
 * can produce (FGFR3 p.Gly380Arg): one row per candidate allele, and a criterion only when every
 * candidate supports it.
 */
import { describe, expect, it } from "vitest";
import { buildFrequencyEvidence, frequencySourceLabel } from "../frequencyEvidence";
import type { GnomadCandidateReading } from "../contracts";
import type { AlleleCandidate } from "../locusResolution";

const lifted = (alt: string): AlleleCandidate => ({ grch37Id: `4-1806119-G-${alt}`, id: `4-1804392-G-${alt}`, canonicalBy: "ensembl-lift", retryable: false });
const found = (alt: string, af: number, extra: Record<string, unknown> = {}): GnomadCandidateReading => ({
  id: `4-1804392-G-${alt}`, grch37Id: `4-1806119-G-${alt}`, outcome: "found",
  frequency: { maxAF: af, groupMaxAF: af, genomeAF: null, exomeAF: af, genomeAC: null, exomeAC: 3, genomeAN: null, exomeAN: 1_000_000, nHomozygous: 0, dataset: "gnomad_r4", ...extra },
});
const absent = (alt: string): GnomadCandidateReading => ({ id: `4-1804392-G-${alt}`, grch37Id: `4-1806119-G-${alt}`, outcome: "not-found", frequency: null });

const evidence = (readings: GnomadCandidateReading[] | null, trail: AlleleCandidate[] = [lifted("A"), lifted("C")], status = "ok") => buildFrequencyEvidence({
  gnomadFrequency: readings === null ? null : { maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, genomeAC: null, exomeAC: null, genomeAN: null, exomeAN: null, nHomozygous: null, dataset: "gnomad_r4", candidates: readings },
  serviceStatus: { gnomadFrequency: status },
  pli: 0.99,
  engineCriteria: [],
  locus: {
    predictorData: {
      gnomadVariantId: null, gnomadVariantAssembly: null,
      locusResolution: { route: "fallback", canonicalBy: null, retryable: trail.some(c => c.retryable), failureKind: "multiple-candidates", steps: [], candidates: trail },
    },
  },
});

describe("frequency evidence for several candidate alleles", () => {
  it("supports PM2 when every candidate is absent, and offers no 'provide allele' action", () => {
    const reading = evidence([absent("A"), absent("C")]);
    expect(reading.criterion.code).toBe("PM2");
    expect(reading.criterion.absent).toBe(true);
    expect(reading.criterion.predicate).toMatch(/every candidate allele/);
    expect(reading.recoveryAction).toBeNull();
    expect(frequencySourceLabel(reading)).toBe("gnomAD, read for each of 2 candidate alleles");
  });

  it("lists one row per allele with its GRCh38 id, nucleotide change and own verdict", () => {
    const reading = evidence([found("A", 0.000003), absent("C")]);
    expect(reading.candidates?.map(r => [r.id, r.change, r.decision])).toEqual([
      ["4-1804392-G-A", "G>A", "PM2"],
      ["4-1804392-G-C", "G>C", "PM2"],
    ]);
    expect(reading.candidates?.[0]).toMatchObject({ af: 0.000003, counts: "3 / 1,000,000" });
    expect(reading.candidates?.[1].note).toMatch(/no record/);
    // The single-allele gnomAD rows would be empty and misleading: the candidate rows replace them.
    expect(reading.observations.some(o => o.id.startsWith("gnomad"))).toBe(false);
  });

  it("applies no criterion when the candidates disagree, and says so", () => {
    const reading = evidence([found("A", 0.03, { faf95: 0.02 }), absent("C")]);
    expect(reading.criterion.code).toBe("none");
    expect(reading.criterion.headline).toBe("Candidate alleles disagree");
    expect(reading.candidates?.map(r => r.decision)).toEqual(["BS1", "PM2"]);
  });

  it("withholds, names the failed candidate, and offers a re-run for a failed query", () => {
    const reading = evidence([absent("A"), { ...absent("C"), outcome: "failed", detail: "the gnomAD query failed (timeout)" }]);
    expect(reading.criterion.code).toBe("withheld");
    expect(reading.criterion.statement).toContain("4-1804392-G-C");
    expect(reading.recoveryAction).toBe("retry");
    expect(reading.candidates?.[1].note).toMatch(/query failed/);
  });

  it("asks for the allele when a candidate could not be placed on GRCh38", () => {
    const unlifted: AlleleCandidate = { grch37Id: "4-1806119-G-C", id: null, canonicalBy: null, retryable: false };
    const reading = evidence([absent("A"), { id: null, grch37Id: "4-1806119-G-C", outcome: "not-lifted", frequency: null }], [lifted("A"), unlifted]);
    expect(reading.criterion.code).toBe("withheld");
    expect(reading.criterion.statement).toContain("4-1806119-G-C (GRCh37)");
    expect(reading.recoveryAction).toBe("provide-allele");
  });

  it("never reads a candidate run without candidate readings as an absence", () => {
    const reading = evidence(null, [lifted("A"), lifted("C")], "not_found");
    expect(reading.criterion.code).toBe("withheld");
  });

  it("preserves gnomadRelease, provider faults, pending status, and BS2 homozygote eligibility on candidate runs", () => {
    const failed = evidence([absent("A"), { ...absent("C"), outcome: "failed", detail: "timeout" }]);
    expect(failed.gnomadRelease).toBe("v4");
    expect(failed.hasProviderFault).toBe(true);
    expect(failed.recoveryAction).toBe("retry");

    const pending = evidence(null, [lifted("A"), lifted("C")], "pending");
    expect(pending.hasPendingSource).toBe(true);
    expect(pending.hasProviderFault).toBe(false);

    const bs2 = buildFrequencyEvidence({
      gnomadFrequency: {
        maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null,
        genomeAC: null, exomeAC: null, genomeAN: null, exomeAN: null, nHomozygous: null, dataset: "gnomad_r4",
        candidates: [found("A", 0.02, { nHomozygous: 3 }), found("C", 0.03, { nHomozygous: 2 })],
      },
      serviceStatus: { gnomadFrequency: "ok" },
      engineCriteria: [{ code: "BS2" }],
      locus: {
        predictorData: {
          gnomadVariantId: null, gnomadVariantAssembly: null,
          locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates: [lifted("A"), lifted("C")] },
        },
      },
    });
    expect(bs2.gnomadHomozygotes).toBe(2);
    expect(bs2.homozygoteCriterion).toMatchObject({ applicable: false, recorded: true });

    const xChrom = buildFrequencyEvidence({
      gnomadFrequency: {
        maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null,
        genomeAC: null, exomeAC: null, genomeAN: null, exomeAN: null, nHomozygous: null, dataset: "gnomad_r4",
        candidates: [
          { id: "X-154032500-G-A", grch37Id: "X-153297955-G-A", outcome: "found", frequency: { maxAF: 0.02, groupMaxAF: 0.02, genomeAF: 0.02, exomeAF: null, genomeAC: 20, exomeAC: null, genomeAN: 1000, exomeAN: null, nHomozygous: 4, dataset: "gnomad_r4" } },
          { id: "X-154032500-G-C", grch37Id: "X-153297955-G-C", outcome: "found", frequency: { maxAF: 0.02, groupMaxAF: 0.02, genomeAF: 0.02, exomeAF: null, genomeAC: 20, exomeAC: null, genomeAN: 1000, exomeAN: null, nHomozygous: 2, dataset: "gnomad_r4" } },
        ],
      },
      serviceStatus: { gnomadFrequency: "ok" },
      locus: {
        predictorData: {
          gnomadVariantId: null, gnomadVariantAssembly: null,
          locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates: [lifted("A"), lifted("C")] },
        },
      },
    });
    expect(xChrom.homozygoteCriterion.applicable).toBe(false);

    const nullAfFound = evidence([{ ...found("A", 0), frequency: { ...found("A", 0).frequency!, maxAF: null, groupMaxAF: null, exomeAF: null } }, absent("C")]);
    expect(nullAfFound.candidates?.[0].note).toMatch(/without an allele frequency/i);
  });
});

describe("population comparison chart for several candidate alleles", () => {
  it("adds one row per candidate allele, plotting only positive frequencies", async () => {
    const { buildPopulationComparison } = await import("../evidenceComparison");
    const model = buildPopulationComparison(evidence([found("A", 0.000003), absent("C")]));
    const rows = model.rows.filter(r => r.group === "gnomad-candidate");
    expect(rows.map(r => [r.name, r.valueText, r.value === null])).toEqual([
      ["gnomAD G>A · 4-1804392-G-A", "3.00e-4%", false],
      ["gnomAD G>C · 4-1804392-G-C", "No variant record returned", true],
    ]);
    expect(rows[0].facts).toContainEqual({ label: "Supports", value: "PM2" });
    expect(rows[0].facts).toContainEqual({ label: "Candidate allele (GRCh38)", value: "4-1804392-G-A" });
  });

  it("discloses FAF95 beside groupMaxAF, marks unlifted alleles without GRCh38, and labels Statistic on rule input", async () => {
    const { buildPopulationComparison } = await import("../evidenceComparison");
    const unlifted: AlleleCandidate = { grch37Id: "4-1806119-G-C", id: null, canonicalBy: null, retryable: false };
    const fe = evidence(
      [found("A", 0.03, { faf95: 0.02 }), { id: null, grch37Id: "4-1806119-G-C", outcome: "not-lifted", frequency: null }],
      [lifted("A"), unlifted],
    );
    expect(fe.candidates?.[0]).toMatchObject({ lifted: true, benignAf: 0.02, benignStatistic: "faf95" });
    expect(fe.candidates?.[1]).toMatchObject({ lifted: false, benignAf: null, benignStatistic: null });

    const model = buildPopulationComparison(fe);
    const rows = model.rows.filter(r => r.group === "gnomad-candidate");
    expect(rows[0].facts).toContainEqual({ label: "FAF95 (BA1/BS1 input)", value: "2%" });
    expect(rows[1].facts).toContainEqual({ label: "Candidate allele", value: "4-1806119-G-C (GRCh37)" });

    const fafModel = buildPopulationComparison(evidence([found("A", 0.03, { faf95: 0.02 }), found("C", 0.025, { faf95: 0.02 })]));
    const ruleRow = fafModel.rows.find(r => r.key === "frequency-rule-input")!;
    expect(ruleRow.facts).toContainEqual({ label: "Statistic", value: "Filtering allele frequency (FAF95)" });
  });
});

describe("cDNA change for each candidate allele", () => {
  it("carries each allele's cDNA change onto its row and its chart inspector", async () => {
    const { buildPopulationComparison } = await import("../evidenceComparison");
    const reading = evidence([{ ...absent("A"), cdna: "ENST00000440486.8:c.1138G>A" }, absent("C")]);
    expect(reading.candidates?.map(r => r.cdna)).toEqual(["ENST00000440486.8:c.1138G>A", null]);
    const rows = buildPopulationComparison(reading).rows.filter(r => r.group === "gnomad-candidate");
    expect(rows[0].facts).toContainEqual({ label: "cDNA change", value: "ENST00000440486.8:c.1138G>A" });
    expect(rows[1].facts.some(f => f.label === "cDNA change")).toBe(false);
  });
});

describe("All of Us for each candidate allele", () => {
  it("gives each allele its own All of Us figure, or names which absence it is", () => {
    const counts = { aouAC: 4, aouAN: 400000, aouHet: 4, aouHom: 0 };
    const reading = evidence([
      { ...absent("A"), allOfUs: { localTable: "found", frequency: counts } },
      { ...absent("C"), allOfUs: { localTable: "absent", frequency: null } },
    ]);
    expect(reading.candidates?.map(r => r.allOfUs)).toEqual([
      { af: 0.00001, counts: "4 / 400,000", note: null },
      { af: null, counts: null, note: "Not in the local All of Us table." },
    ]);
    const aou = reading.observations.find(o => o.id === "all-of-us")!;
    expect(aou.availability.reason).toBe("All of Us is read for each candidate allele; see the candidate rows.");
  });

  it("names a rejected All of Us row instead of calling it absent", () => {
    const reading = evidence([{ ...absent("A"), allOfUs: { localTable: "invalid", frequency: null } }, absent("C")]);
    expect(reading.candidates?.[0].allOfUs?.note).toBe("The local All of Us row has counts that fail validation, so none is shown.");
  });

  it("says the table is not installed rather than implying an absence", () => {
    const reading = evidence([{ ...absent("A"), allOfUs: { localTable: "not-installed", frequency: null } }, absent("C")]);
    expect(reading.candidates?.[0].allOfUs?.note).toBe("No local All of Us table in this deployment.");
    expect(reading.candidates?.[1].allOfUs).toBeNull();
  });
});

describe("chart rows carry each allele's All of Us figure", () => {
  it("adds an All of Us fact to the candidate's inspector", async () => {
    const { buildPopulationComparison } = await import("../evidenceComparison");
    const counts = { aouAC: 4, aouAN: 400000, aouHet: 4, aouHom: 0 };
    const model = buildPopulationComparison(evidence([{ ...absent("A"), allOfUs: { localTable: "found", frequency: counts } }, absent("C")]));
    const rows = model.rows.filter(r => r.group === "gnomad-candidate");
    expect(rows[0].facts).toContainEqual({ label: "All of Us AC / AN", value: "4 / 400,000" });
    expect(rows[1].facts.some(f => f.label.startsWith("All of Us"))).toBe(false);
  });
});
