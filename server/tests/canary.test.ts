import { describe, it, expect } from "vitest";
import { computeRuleBasedACMG } from "../services/acmg.ts";

/**
 * Golden Canary Benchmark Suite (Tier 3).
 *
 * Runs deterministic end-to-end ACMG classification against a fixed benchmark
 * of clinically curated variants to detect regression or unexpected scoring drift.
 */
interface CanaryVariantBenchmark {
  gene: string;
  variant: string;
  expectedVerdict: "Pathogenic" | "Likely Pathogenic" | "Benign" | "Likely Benign" | "Variant of Uncertain Significance (VUS)";
  expectedCriteria: string[];
  /** Criteria that must not be applied (e.g. PM1 under the PP3 + PM1 ≤ Strong cap). */
  absentCriteria?: string[];
  // PP2 is the calibrated regional rule: each mock carries a synthetic interval O/E of 0.5 (PP2 Supporting band).
  mockData: any;
}

/**
 * Verdicts: the three pathogenic mocks are Pathogenic. PP3/BP4 now comes from one calibrated tool at
 * its calibrated strength: REVEL ≥ 0.932 is PP3_Strong (Pejaver 2022), so the evidence is PS1 +
 * PP3_Strong (two Strong) + PM2_Supporting + PP2, which meets Richards Table 5's "≥ 2 Strong" row.
 * PM1 is withheld, because PP3 alone already reaches Strong and PP3 + PM1 is capped at Strong.
 *
 * The PM1 sites below carry `ECO:0000269` (experimental) because PM1 now counts only experimentally
 * evidenced sites (`src/shared/functionalSites.ts`); an untagged site models "no evidence cited".
 */
const GOLDEN_BENCHMARK_SET: CanaryVariantBenchmark[] = [
  {
    gene: "PAH",
    variant: "p.Arg408Trp",
    expectedVerdict: "Pathogenic",
    expectedCriteria: ["PS1", "PM2", "PP2", "PP3_Strong"],
    absentCriteria: ["PM1"],
    mockData: {
      clinvar: {
        hasOtherPathogenicVariantSameAA: true,
        records: [
          { clinicalSignificance: "Pathogenic", stars: 3, reviewStatus: "reviewed by expert panel" }
        ]
      },
      predictorData: {
        caddPhred: 28.5,
        amPathogenicity: 0.92,
        amClass: "likely_pathogenic"
      },
      conservationData: { revel: 0.94, gerp: 4.8 },
      gnomadConstraint: { pli: 0.85, missense_z: 2.1, oe_mis: 0.65, isPP2Constrained: true, pp2Code: "PP2", regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" } },
      gnomadFrequency: { maxAF: 0.00001, groupMaxAF: 0.00001 },
      acmgWeighting: "standard",
      uniprotFeatures: { features: [{ type: "Active site", start: 143, end: 410, description: "Catalytic active site", evidence: [{ code: "ECO:0000269" }] }] },
      sequence: "M".repeat(452)
    }
  },
  {
    gene: "TP53",
    variant: "p.Arg273His",
    expectedVerdict: "Pathogenic",
    expectedCriteria: ["PS1", "PM2", "PP2", "PP3_Strong"],
    absentCriteria: ["PM1"],
    mockData: {
      clinvar: {
        hasOtherPathogenicVariantSameAA: true,
        records: [
          { clinicalSignificance: "Pathogenic", stars: 4, reviewStatus: "practice guideline" }
        ]
      },
      predictorData: {
        caddPhred: 32.0,
        amPathogenicity: 0.99,
        amClass: "likely_pathogenic"
      },
      conservationData: { revel: 0.98, gerp: 5.2 },
      gnomadConstraint: { pli: 0.99, missense_z: 3.5, oe_mis: 0.35, isPP2Constrained: true, pp2Code: "PP2", regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" } },
      gnomadFrequency: { maxAF: 0.000005, groupMaxAF: 0.000005 },
      acmgWeighting: "standard",
      uniprotFeatures: { features: [{ type: "Binding site", start: 102, end: 292, description: "DNA-binding site", evidence: [{ code: "ECO:0000269" }] }] },
      sequence: "M".repeat(393)
    }
  },
  {
    gene: "BRCA1",
    variant: "p.Cys61Gly",
    expectedVerdict: "Pathogenic",
    expectedCriteria: ["PS1", "PM2", "PP2", "PP3_Strong"],
    absentCriteria: ["PM1"],
    mockData: {
      clinvar: {
        hasOtherPathogenicVariantSameAA: true,
        records: [
          { clinicalSignificance: "Pathogenic", stars: 3, reviewStatus: "reviewed by expert panel" }
        ]
      },
      predictorData: {
        caddPhred: 30.0,
        amPathogenicity: 0.98,
        amClass: "likely_pathogenic"
      },
      conservationData: { revel: 0.96, gerp: 5.0 },
      gnomadConstraint: { pli: 1.0, missense_z: 2.8, oe_mis: 0.45, isPP2Constrained: true, pp2Code: "PP2", regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" } },
      gnomadFrequency: { maxAF: 0.000002, groupMaxAF: 0.000002 },
      acmgWeighting: "standard",
      uniprotFeatures: { features: [{ type: "Metal binding", start: 1, end: 100, description: "Zinc finger metal binding site", evidence: [{ code: "ECO:0000269" }] }] },
      sequence: "M".repeat(1863)
    }
  },
  {
    gene: "PAH",
    variant: "p.Ala403Val",
    expectedVerdict: "Benign",
    expectedCriteria: ["BA1"],
    mockData: {
      clinvar: {
        records: [
          { clinicalSignificance: "Benign", stars: 2, reviewStatus: "criteria provided" }
        ]
      },
      predictorData: {
        caddPhred: 5.2,
        amPathogenicity: 0.08,
        amClass: "likely_benign"
      },
      conservationData: { revel: 0.12, gerp: 0.5 },
      gnomadConstraint: { pli: 0.85, missense_z: 2.1, oe_mis: 0.65, isPP2Constrained: true, pp2Code: "PP2", regionalConstraint: { isConstrained: true, oeRatio: 0.5, pValue: 0.001, regionText: "synthetic interval" } },
      gnomadFrequency: { maxAF: 0.085, groupMaxAF: 0.085 },
      acmgWeighting: "standard",
      uniprotFeatures: null,
      sequence: "M".repeat(452)
    }
  }
];

describe("Golden Canary Benchmark ACMG Verdict Suite (Tier 3)", () => {
  GOLDEN_BENCHMARK_SET.forEach(({ gene, variant, expectedVerdict, expectedCriteria, absentCriteria = [], mockData }) => {
    it(`should deterministically classify golden benchmark: ${gene} ${variant} as ${expectedVerdict}`, () => {
      const result = computeRuleBasedACMG({
        gene,
        variant,
        ...mockData
      });

      expect(result).toBeDefined();
      expect(result.acmgVerdict).toBe(expectedVerdict);

      // Check key criteria presence
      expectedCriteria.forEach((criterion) => {
        const hasCriterion = result.acmgCriteria.some(c => c.code === criterion || c.code.startsWith(`${criterion}_`));
        expect(hasCriterion, `Expected criterion ${criterion} for ${gene} ${variant}`).toBe(true);
      });
      absentCriteria.forEach((criterion) => {
        expect(result.acmgCriteria.some(c => c.code === criterion), `Unexpected criterion ${criterion} for ${gene} ${variant}`).toBe(false);
      });
    });
  });
});
