import type { VcepInsilicoRule } from "./vcepTypes.ts";
import { gt, gte, lt, lte, revelSingleTool } from "./vcepDataRevelSingle.ts";

const AB_VCEP = "Antibody Deficiencies Variant Curation Expert Panel";
const SCID_VCEP = "Severe Combined Immunodeficiency Disease Variant Curation Expert Panel";
const HEMOGLOBIN = "Hemoglobinopathy Variant Curation Expert Panel";
const ENIGMA = "ENIGMA BRCA1 and BRCA2 Variant Curation Expert Panel";
const MYOPATHY = "Congenital Myopathies Variant Curation Expert Panel";

const CADD_STD = { tool: "cadd" as const, pp3: { Supporting: gte(25.3) }, bp4: { Supporting: lte(22.7) } };
const REVEL_STD = revelSingleTool(gte(0.644), lte(0.290));

export const VCEP_SPECIAL_RULES: readonly VcepInsilicoRule[] = [
  // Ordered fallbacks (3 genes)
  {
    gene: "CYP1B1", cspecId: "GN104", version: "2.0", vcep: "Glaucoma Variant Curation Expert Panel",
    rule: {
      kind: "ordered-tools",
      tools: [
        {
          tool: "revel",
          pp3: { Strong: gte(0.932), Moderate: gte(0.773), Supporting: gte(0.644) },
          bp4: { Strong: lte(0.016), Moderate: lte(0.183), Supporting: lte(0.290) },
        },
        { tool: "alphaMissense", pp3: { Supporting: gte(0.792) }, bp4: { Supporting: lte(0.169) } },
      ],
    },
    splice: { bp4Block: gt(0.1) },
    summary: "REVEL (Pejaver 2022 up to Strong), fallback AlphaMissense (≥ 0.792 / ≤ 0.169 Supporting); SpliceAI > 0.1 blocks BP4.",
  },
  ...(["HBB", "HBA2"] as const).map((gene, idx): VcepInsilicoRule => ({
    gene, cspecId: idx === 0 ? "GN170" : "GN173", version: "1.0", vcep: HEMOGLOBIN,
    rule: {
      kind: "ordered-tools",
      tools: [
        revelSingleTool(gt(0.8), lt(0.7)),
        { tool: "cadd", pp3: { Supporting: gt(23.5) }, bp4: { Supporting: lte(20.0) } },
      ],
    },
    splice: { pp3Missense: { Supporting: gt(0.3) } },
    summary: "REVEL > 0.8 / < 0.7, fallback CADD > 23.5 / ≤ 20.0 (Supporting); SpliceAI > 0.3 PP3, ≥ 0.2 blocks BP4.",
  })),

  // Multi-tool combos (4 genes)
  {
    gene: "CTLA4", cspecId: "GN122", version: "2.0", vcep: AB_VCEP,
    rule: { kind: "all-of", tools: [REVEL_STD, CADD_STD] },
    splice: { bp4Block: gte(0.1) },
    summary: "Requires REVEL (≥ 0.644 / ≤ 0.290) AND CADD (≥ 25.3 / ≤ 22.7) in agreement (Supporting); SpliceAI ≥ 0.1 blocks BP4.",
  },
  {
    gene: "PIK3CD", cspecId: "GN141", version: "1.0", vcep: AB_VCEP,
    rule: { kind: "all-of", tools: [REVEL_STD, CADD_STD] },
    splice: { pp3Missense: "none" },
    summary: "Requires REVEL (≥ 0.644 / ≤ 0.290) AND CADD (≥ 25.3 / ≤ 22.7) in agreement (Supporting); splicing PP3 disabled for missense.",
    notes: ["PIK3CD CSpec GN141 v1.0 covers AD gain-of-function (missense splicing PP3 disabled); evaluate SpliceAI ≥ 0.2 if AR LoF is suspected."],
  },
  {
    gene: "PIK3R1", cspecId: "GN160", version: "1.0", vcep: AB_VCEP,
    rule: { kind: "all-of", tools: [REVEL_STD, { tool: "cadd", pp3: { Supporting: gte(26.0) }, bp4: { Supporting: lte(21.5) } }] },
    splice: { bp4Block: gte(0.1) },
    summary: "Requires REVEL (≥ 0.644 / ≤ 0.290) AND CADD (≥ 26.0 / ≤ 21.5) in agreement (Supporting); SpliceAI ≥ 0.1 blocks BP4.",
  },
  {
    gene: "BMPR2", cspecId: "GN125", version: "2.0", vcep: "Pulmonary Hypertension Variant Curation Expert Panel",
    rule: {
      kind: "k-of-n",
      minAgree: 2,
      tools: [
        revelSingleTool(gte(0.644), lte(0.29)),
        { tool: "alphaMissense", pp3: { Supporting: gte(0.792) }, bp4: { Supporting: lte(0.169) } },
        CADD_STD,
      ],
    },
    summary: "At least 2 of 3 among REVEL (≥ 0.644 / ≤ 0.29), AlphaMissense (≥ 0.792 / ≤ 0.169), CADD (≥ 25.3 / ≤ 22.7) agree (Supporting).",
  },

  // Non-REVEL single tools (2 genes)
  {
    gene: "DDX41", cspecId: "GN159", version: "1.0", vcep: "Myeloid Malignancy Variant Curation Expert Panel",
    rule: { kind: "ordered-tools", tools: [{ tool: "alphaMissense", pp3: { Supporting: gte(0.792) }, bp4: { Supporting: lte(0.169) } }] },
    summary: "AlphaMissense only: ≥ 0.792 (PP3 Supporting), ≤ 0.169 (BP4 Supporting).",
  },
  {
    gene: "CEP290", cspecId: "GN226", version: "1.0", vcep: "Leber Congenital Amaurosis/early onset Retinal Dystrophy Variant Curation Expert Panel",
    rule: {
      kind: "ordered-tools",
      tools: [{
        tool: "cadd",
        pp3: { Moderate: gte(28.1), Supporting: gte(25.3) },
        bp4: { Moderate: lte(0.15), Supporting: lte(17.3) },
      }],
    },
    splice: { bp4Block: gte(0.1) },
    summary: "CADD only: ≥ 28.1 / ≥ 25.3 PP3, ≤ 0.15 / ≤ 17.3 BP4 (up to Moderate); SpliceAI ≥ 0.1 blocks BP4.",
    notes: ["CSpec GN226 v1.0 prints Pejaver CADD BP4_Strong (≤ 0.15) under BP4_Moderate; literal conservative CSpec cutoffs are kept."],
  },

  // Advisories (4 genes): the standard order runs; uncomputable / competing clauses displayed explicitly
  {
    gene: "TP53", cspecId: "GN009", version: "2.4", vcep: "TP53 Variant Curation Expert Panel",
    rule: { kind: "advisory" },
    summary: "TP53 VCEP (GN009 v2.4) pairs Align-GVGD class (C65 / C25–C55 / C0) with BayesDel; the standard order runs until Align-GVGD is available.",
    notes: ["TP53 CSpec GN009 v2.4 pairs BayesDel noAF ≥ 0.16 / ≤ -0.008 with Align-GVGD class. Align-GVGD is not computed here, so the reading uses the general Pejaver 2022 bands shown on its ruler."],
  },
  {
    gene: "BRCA1", cspecId: "GN092", version: "1.2", vcep: ENIGMA,
    rule: { kind: "advisory" },
    summary: "ENIGMA BRCA1 VCEP (GN092 v1.2) restricts BayesDel noAF (≥ 0.28 / ≤ 0.15) to RING (aa 2–101), coiled-coil (aa 1391–1424), and BRCT (aa 1650–1857) domains; the standard order runs.",
    notes: ["ENIGMA BRCA1 GN092 v1.2 gates BayesDel noAF PP3/BP4 by functional domain (RING 2–101, coiled-coil 1391–1424, BRCT 1650–1857); the standard order applies."],
  },
  {
    gene: "BRCA2", cspecId: "GN097", version: "1.2", vcep: ENIGMA,
    rule: { kind: "advisory" },
    summary: "ENIGMA BRCA2 VCEP (GN097 v1.2) restricts BayesDel noAF (≥ 0.30 / ≤ 0.18) to PALB2-binding (aa 10–40) and DNA-binding (aa 2481–3186) domains; the standard order runs.",
    notes: ["ENIGMA BRCA2 GN097 v1.2 gates BayesDel noAF PP3/BP4 by functional domain (PALB2-binding 10–40, DNA-binding 2481–3186); the standard order applies."],
  },
  {
    gene: "RYR1", cspecId: "GN012", version: "2.0", vcep: "Malignant Hyperthermia Susceptibility Variant Curation Expert Panel",
    alternateSpecs: [
      { cspecId: "GN150", version: "2.0", vcep: MYOPATHY },
      { cspecId: "GN179", version: "2.0", vcep: MYOPATHY },
    ],
    rule: { kind: "advisory" },
    summary: "RYR1 has two competing Released VCEPs (MHS GN012 vs Congenital Myopathies GN150/GN179); the standard order runs.",
    notes: ["Compete by phenotype: Malignant Hyperthermia VCEP (GN012 v2.0) uses REVEL > 0.85 Moderate / < 0.5 Supporting; Congenital Myopathies (GN150/GN179 v2.0) use REVEL ≥ 0.7 / ≤ 0.15 Supporting + SpliceAI ≥ 0.5."],
  },

  // Missense excluded (12 genes): 3 splicing-only + 9 fully excluded
  {
    gene: "PALB2", cspecId: "GN077", version: "1.3", vcep: "Hereditary Breast, Ovarian and Pancreatic Cancer Variant Curation Expert Panel",
    rule: { kind: "exclude-missense" },
    summary: "Missense computational predictors excluded by VCEP; SpliceAI ≥ 0.20 (Walker 2023) applies splicing PP3.",
  },
  {
    gene: "APC", cspecId: "GN089", version: "2.1", vcep: "InSiGHT Hereditary Colorectal Cancer/Polyposis Variant Curation Expert Panel",
    rule: { kind: "exclude-missense" },
    summary: "Missense computational predictors excluded by VCEP; SpliceAI ≥ 0.20 (Walker 2023) applies splicing PP3.",
  },
  {
    gene: "CDH1", cspecId: "GN007", version: "3.1", vcep: "Gastric Cancer Variant Curation Expert Panel",
    rule: { kind: "exclude-missense" },
    summary: "Missense computational predictors excluded by VCEP; SpliceAI ≥ 0.20 applies splicing PP3.",
    notes: ["CDH1 VCEP (GN007 v3.1) additionally specifies ≥ 3 in-silico splicing predictors in agreement (SpliceAI checked here)."],
  },
  ...([["ADA", "GN114", "2.2"], ["DCLRE1C", "GN116", "2.2"], ["IL7R", "GN119", "2.2"], ["JAK3", "GN121", "2.3"],
    ["RAG1", "GN123", "2.2"], ["RAG2", "GN124", "2.2"], ["IL2RG", "GN129", "2.2"]] as const).map(([gene, cspecId, version]): VcepInsilicoRule => ({
    gene, cspecId, version, vcep: SCID_VCEP,
    rule: { kind: "exclude-missense" },
    splice: { pp3Missense: "none" },
    summary: "Missense computational PP3/BP4 excluded by SCID VCEP.",
  })),
  {
    gene: "GFAP", cspecId: "GN157", version: "1.0", vcep: "Leukodystrophy and Leukoencephalopathy Variant Curation Expert Panel",
    rule: { kind: "exclude-missense" },
    splice: { pp3Missense: "none" },
    summary: "Missense computational PP3/BP4 excluded by VCEP.",
  },
  {
    gene: "RMRP", cspecId: "GN088", version: "1.3", vcep: SCID_VCEP,
    rule: { kind: "exclude-missense" },
    splice: { pp3Missense: "none" },
    summary: "Non-coding RNA gene (RNAsnp only); missense PP3/BP4 excluded.",
  },
];
