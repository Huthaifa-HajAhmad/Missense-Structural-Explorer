import type { ThresholdBound, VcepInsilicoRule, VcepSpliceSpec, VcepToolSpec } from "./vcepTypes.ts";

export const gte = (threshold: number): ThresholdBound => ({ threshold, inclusive: true });
export const gt = (threshold: number): ThresholdBound => ({ threshold, inclusive: false });
export const lte = (threshold: number): ThresholdBound => ({ threshold, inclusive: true });
export const lt = (threshold: number): ThresholdBound => ({ threshold, inclusive: false });

export function revelSingleTool(pp3: ThresholdBound, bp4: ThresholdBound | null): VcepToolSpec {
  return {
    tool: "revel",
    pp3: { Supporting: pp3 },
    bp4: bp4 ? { Supporting: bp4 } : {},
  };
}

function entry(
  gene: string,
  cspecId: string,
  version: string,
  vcep: string,
  pp3: ThresholdBound,
  bp4: ThresholdBound | null,
  summary: string,
  extra?: Pick<VcepInsilicoRule, "splice" | "alternateSpecs" | "notes">,
): VcepInsilicoRule {
  return {
    gene,
    cspecId,
    version,
    vcep,
    rule: { kind: "ordered-tools", tools: [revelSingleTool(pp3, bp4)] },
    summary,
    ...extra,
  };
}

function groupEntries(
  specs: ReadonlyArray<readonly [gene: string, cspecId: string, version: string]>,
  vcep: string,
  pp3: ThresholdBound,
  bp4: ThresholdBound,
  summary: string,
  extra?: Pick<VcepInsilicoRule, "splice" | "notes">,
): VcepInsilicoRule[] {
  return specs.map(([gene, cspecId, version]) => entry(gene, cspecId, version, vcep, pp3, bp4, summary, extra));
}

const CARDIOMYOPATHY = "Cardiomyopathy Variant Curation Expert Panel";
const DIABETES = "Monogenic Diabetes Variant Curation Expert Panel";
const RETT = "Rett and Angelman-like Disorders Variant Curation Expert Panel";
const RASOPATHY = "RASopathy Variant Curation Expert Panel";
const COAG = "Coagulation Factor Deficiency Variant Curation Expert Panel";
const HHT = "Hereditary Hemorrhagic Telangiectasia Variant Curation Expert Panel";
const MYOPATHY = "Congenital Myopathies Variant Curation Expert Panel";
const LGMD = "Limb Girdle Muscular Dystrophy Variant Curation Expert Panel";

export const VCEP_REVEL_SINGLE_RULES: readonly VcepInsilicoRule[] = [
  ...groupEntries(
    [["MYH7", "GN002", "2.0"], ["MYBPC3", "GN095", "1.0"], ["TNNI3", "GN098", "1.0"], ["TNNT2", "GN099", "1.0"],
      ["TPM1", "GN100", "1.0"], ["ACTC1", "GN101", "1.0"], ["MYL2", "GN102", "1.0"], ["MYL3", "GN103", "1.0"]],
    CARDIOMYOPATHY, gte(0.70), lte(0.40), "REVEL ≥ 0.70 (PP3 Supporting), ≤ 0.40 (BP4 Supporting).",
  ),
  entry("PTEN", "GN003", "3.2", "PTEN Variant Curation Expert Panel",
    gt(0.7), lt(0.5), "REVEL > 0.7 (PP3 Supporting), < 0.5 (BP4 Supporting)."),
  entry("RUNX1", "GN008", "3.1", "Myeloid Malignancy Variant Curation Expert Panel",
    gte(0.88), lt(0.50), "REVEL ≥ 0.88 (PP3 Supporting), < 0.50 (BP4 Supporting); SpliceAI ≥ 0.38 for splicing PP3.",
    { splice: { pp3Missense: { Supporting: gte(0.38) } } }),
  entry("GAA", "GN010", "2.0", "Lysosomal Diseases Variant Curation Expert Panel",
    gt(0.7), lt(0.5), "REVEL > 0.7 (PP3 Supporting), < 0.5 (BP4 Supporting); SpliceAI > 0.5 for splicing PP3.",
    { splice: { pp3Missense: { Supporting: gt(0.5) } } }),
  entry("ITGA2B", "GN011", "2.1", "Platelet Disorders Variant Curation Expert Panel",
    gte(0.7), lt(0.25), "REVEL ≥ 0.7 (PP3 Supporting), < 0.25 (BP4 Supporting)."),
  entry("ITGB3", "GN011", "2.1", "Platelet Disorders Variant Curation Expert Panel",
    gte(0.7), lt(0.25), "REVEL ≥ 0.7 (PP3 Supporting), < 0.25 (BP4 Supporting)."),
  entry("LDLR", "GN013", "1.2", "Familial Hypercholesterolemia Variant Curation Expert Panel",
    gte(0.75), lte(0.5), "REVEL ≥ 0.75 (PP3 Supporting), ≤ 0.5 (BP4 Supporting)."),
  ...groupEntries(
    [["HNF1A", "GN017", "3.1"], ["HNF4A", "GN085", "4.0"], ["GCK", "GN086", "3.1"]],
    DIABETES, gte(0.70), lte(0.15), "REVEL ≥ 0.70 (PP3 Supporting), ≤ 0.15 (BP4 Supporting).",
  ),
  entry("ATM", "GN020", "1.6", "Hereditary Breast, Ovarian and Pancreatic Cancer Variant Curation Expert Panel",
    gt(0.7333), lte(0.249), "REVEL > 0.7333 (PP3 Supporting), ≤ 0.249 (BP4 Supporting); BP4 blocked above SpliceAI 0.10.",
    { splice: { bp4Block: gt(0.1) } }),
  entry("ACADVL", "GN021", "2.2", "ACADVL Variant Curation Expert Panel",
    gt(0.75), lt(0.5), "REVEL > 0.75 (PP3 Supporting), < 0.5 (BP4 Supporting); SpliceAI ≥ 0.5 PP3, > 0.1 blocks BP4.",
    { splice: { pp3Missense: { Supporting: gte(0.5) }, bp4Block: gt(0.1) } }),
  entry("FBN1", "GN022", "1.0", "FBN1 Variant Curation Expert Panel",
    gte(0.75), lte(0.326), "REVEL ≥ 0.75 (PP3 Supporting), ≤ 0.326 (BP4 Supporting)."),
  entry("SLC6A8", "GN027", "2.1", "Cerebral Creatine Deficiency Syndromes Variant Curation Expert Panel",
    gt(0.75), lte(0.20), "REVEL > 0.75 (PP3 Supporting), ≤ 0.20 (BP4 Supporting); SpliceAI ≥ 0.10 blocks BP4.",
    { splice: { bp4Block: gte(0.1) } }),
  ...groupEntries(
    [["TCF4", "GN032", "6.0"], ["CDKL5", "GN034", "6.0"], ["FOXG1", "GN035", "6.0"], ["UBE3A", "GN037", "7.0"]],
    RETT, gte(0.644), lte(0.290), "REVEL ≥ 0.644 (PP3 Supporting), ≤ 0.290 (BP4 Supporting); SpliceAI > 0.10 blocks BP4.",
    { splice: { bp4Block: gt(0.1) } },
  ),
  entry("SLC9A6", "GN033", "6.0", RETT,
    gte(0.644), lte(0.290), "REVEL ≥ 0.644 (PP3 Supporting), ≤ 0.290 (BP4 Supporting); SpliceAI > 0.10 blocks BP4.",
    {
      splice: { bp4Block: gt(0.1) },
      notes: ["CSpec GN033 v6.0 prints ≥ 0.664; corrected to Pejaver et al. 2022 ≥ 0.644 matching sibling Rett/Angelman v6.0 specs."],
    }),
  ...groupEntries(
    [["SHOC2", "GN038", "2.3"], ["NRAS", "GN039", "2.3"], ["RAF1", "GN040", "2.3"], ["SOS1", "GN041", "2.3"],
      ["SOS2", "GN042", "2.3"], ["PTPN11", "GN043", "2.3"], ["KRAS", "GN044", "2.3"], ["MAP2K1", "GN045", "2.3"],
      ["HRAS", "GN046", "2.3"], ["RIT1", "GN047", "2.3"], ["MAP2K2", "GN048", "2.3"], ["BRAF", "GN049", "2.3"],
      ["MRAS", "GN087", "1.4"], ["LZTR1", "GN094", "1.3"], ["RRAS2", "GN127", "1.3"], ["PPP1CB", "GN128", "1.3"]],
    RASOPATHY, gte(0.7), lte(0.3), "REVEL ≥ 0.7 (PP3 Supporting), ≤ 0.3 (BP4 Supporting).",
  ),
  ...groupEntries(
    [["F8", "GN071", "2.0"], ["F9", "GN080", "2.1"]],
    COAG, gte(0.6), lte(0.3), "REVEL ≥ 0.6 (PP3 Supporting), ≤ 0.3 (BP4 Supporting); SpliceAI > 0.10 blocks BP4.",
    { splice: { bp4Block: gt(0.1) } },
  ),
  entry("VHL", "GN078", "1.1", "VHL Variant Curation Expert Panel",
    gte(0.664), null, "REVEL ≥ 0.664 (PP3 Supporting); missense BP4 excluded by VCEP; SpliceAI > 0.5 for splicing PP3.",
    { splice: { pp3Missense: { Supporting: gt(0.5) } }, notes: ["VHL VCEP excludes missense BP4."] }),
  entry("ABCD1", "GN105", "1.0", "Peroxisomal Disorders Variant Curation Expert Panel",
    gt(0.85), lte(0.5), "REVEL > 0.85 (PP3 Supporting), ≤ 0.5 (BP4 Supporting); SpliceAI ≥ 0.5 PP3, ≥ 0.1 blocks BP4.",
    { splice: { pp3Missense: { Supporting: gte(0.5) }, bp4Block: gte(0.1) } }),
  entry("NF1", "GN109", "1.0", "Neurofibromatosis and Schwannomatosis Variant Curation Expert Panel",
    gte(0.641), lte(0.248), "REVEL ≥ 0.641 (PP3 Supporting), ≤ 0.248 (BP4 Supporting); NF1 paired/0.60 SpliceAI PP3, ≥ 0.18 blocks BP4.",
    { splice: { pp3Missense: "nf1", bp4Block: gte(0.18) } }),
  ...groupEntries(
    [["ACVRL1", "GN135", "1.1"], ["ENG", "GN136", "1.1"]],
    HHT, gte(0.644), lte(0.15), "REVEL ≥ 0.644 (PP3 Supporting), ≤ 0.15 (BP4 Supporting); SpliceAI > 0.10 blocks BP4.",
    { splice: { bp4Block: gt(0.1) } },
  ),
  entry("NEB", "GN146", "1.0", MYOPATHY,
    gte(0.7), lte(0.15), "REVEL ≥ 0.7 (PP3 Supporting), ≤ 0.15 (BP4 Supporting); SpliceAI ≥ 0.5 for splicing PP3.",
    { splice: { pp3Missense: { Supporting: gte(0.5) } } }),
  entry("ACTA1", "GN147", "2.0", MYOPATHY,
    gte(0.7), lte(0.15), "REVEL ≥ 0.7 (PP3 Supporting), ≤ 0.15 (BP4 Supporting); SpliceAI ≥ 0.5 for splicing PP3.",
    {
      splice: { pp3Missense: { Supporting: gte(0.5) } },
      alternateSpecs: [{ cspecId: "GN169", version: "1.0", vcep: MYOPATHY }],
    }),
  entry("DNM2", "GN148", "1.0", MYOPATHY,
    gte(0.7), lte(0.15), "REVEL ≥ 0.7 (PP3 Supporting), ≤ 0.15 (BP4 Supporting); SpliceAI ≥ 0.5 for splicing PP3.",
    { splice: { pp3Missense: { Supporting: gte(0.5) } } }),
  entry("MTM1", "GN149", "1.0", MYOPATHY,
    gte(0.7), lte(0.15), "REVEL ≥ 0.7 (PP3 Supporting), ≤ 0.15 (BP4 Supporting); SpliceAI ≥ 0.5 for splicing PP3.",
    { splice: { pp3Missense: { Supporting: gte(0.5) } } }),
  entry("GALT", "GN158", "1.1", "Galactosemia Variant Curation Expert Panel",
    gte(0.7), lt(0.15), "REVEL ≥ 0.7 (PP3 Supporting), < 0.15 (BP4 Supporting); SpliceAI ≥ 0.10 blocks BP4.",
    { splice: { bp4Block: gte(0.1) } }),
  entry("DDC", "GN163", "1.0", "Dopa Decarboxylase (Aromatic L-Amino Acid Decarboxylase) Variant Curation Expert Panel",
    gte(0.55), null, "REVEL ≥ 0.55 (PP3 Supporting); missense BP4 excluded by VCEP.",
    { notes: ["DDC VCEP excludes missense BP4."] }),
  ...groupEntries(
    [["DYSF", "GN180", "2.0"], ["SGCB", "GN184", "2.0"], ["SGCG", "GN185", "2.0"], ["SGCD", "GN186", "2.0"],
      ["CAPN3", "GN187", "2.0"], ["ANO5", "GN188", "2.0"], ["SGCA", "GN189", "2.0"]],
    LGMD, gte(0.7), lte(0.1), "REVEL ≥ 0.7 (PP3 Supporting), ≤ 0.1 (BP4 Supporting); SpliceAI ≥ 0.5 PP3, > 0.05 blocks BP4.",
    { splice: { pp3Missense: { Supporting: gte(0.5) }, bp4Block: gt(0.05) } satisfies VcepSpliceSpec },
  ),
];
