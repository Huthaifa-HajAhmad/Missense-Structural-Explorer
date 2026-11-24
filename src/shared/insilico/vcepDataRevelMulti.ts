import type { VcepInsilicoRule, VcepStrengthBounds } from "./vcepTypes.ts";
import { gt, gte, lt, lte } from "./vcepDataRevelSingle.ts";

function multi(
  gene: string,
  cspecId: string,
  version: string,
  vcep: string,
  pp3: VcepStrengthBounds,
  bp4: VcepStrengthBounds,
  summary: string,
  extra?: Pick<VcepInsilicoRule, "splice" | "notes">,
): VcepInsilicoRule {
  return {
    gene,
    cspecId,
    version,
    vcep,
    rule: { kind: "ordered-tools", tools: [{ tool: "revel", pp3, bp4 }] },
    summary,
    ...extra,
  };
}

const EPILEPSY = "Epilepsy Sodium Channel Variant Curation Expert Panel";
const PLATELET = "Platelet Disorders Variant Curation Expert Panel";
const LCA = "Leber Congenital Amaurosis/early onset Retinal Dystrophy Variant Curation Expert Panel";
const XIRD = "X-linked Inherited Retinal Disease Variant Curation Expert Panel";
const CCDS = "Cerebral Creatine Deficiency Syndromes Variant Curation Expert Panel";

const PEJAVER_PP3_S_M_SUP: VcepStrengthBounds = { Strong: gte(0.932), Moderate: gte(0.773), Supporting: gte(0.644) };
const PEJAVER_BP4_S_M_SUP: VcepStrengthBounds = { Strong: lte(0.016), Moderate: lte(0.183), Supporting: lte(0.290) };
const EPILEPSY_PP3: VcepStrengthBounds = { Moderate: gte(0.773), Supporting: gte(0.644) };
const EPILEPSY_BP4: VcepStrengthBounds = { Moderate: lte(0.183), Supporting: lte(0.290) };
const PLATELET_PP3: VcepStrengthBounds = { Moderate: gte(0.773), Supporting: gte(0.644) };
const PLATELET_BP4: VcepStrengthBounds = { Supporting: lte(0.290) };
const LCA_PP3_M_SUP: VcepStrengthBounds = { Moderate: gte(0.774), Supporting: gte(0.644) };
const LCA_BP4_M_SUP: VcepStrengthBounds = { Moderate: lte(0.183), Supporting: lte(0.290) };

export const VCEP_REVEL_MULTI_RULES: readonly VcepInsilicoRule[] = [
  multi("PAH", "GN006", "2.1", "Phenylketonuria Variant Curation Expert Panel",
    PEJAVER_PP3_S_M_SUP, PEJAVER_BP4_S_M_SUP,
    "REVEL Pejaver 2022 up to Strong (≥ 0.932 / ≤ 0.016); SpliceAI > 0.5 PP3, ≥ 0.1 blocks BP4.",
    {
      splice: { pp3Missense: { Supporting: gt(0.5) }, bp4Block: gte(0.1) },
      notes: ["CSpec GN006 v2.1 prints 0.644–0.733; corrected to 0.644–0.772 per cited Pejaver et al. (PMID: 36413997)."],
    }),
  multi("MYOC", "GN019", "2.1", "Glaucoma Variant Curation Expert Panel",
    PEJAVER_PP3_S_M_SUP, PEJAVER_BP4_S_M_SUP,
    "REVEL Pejaver 2022 up to Strong (≥ 0.932 / ≤ 0.016)."),
  multi("GATM", "GN025", "2.0", CCDS,
    { Moderate: gt(0.773), Supporting: gte(0.644) }, { Supporting: lt(0.29) },
    "REVEL > 0.773 (PP3 Moderate), ≥ 0.644 (PP3 Supporting), < 0.29 (BP4 Supporting); SpliceAI ≥ 0.1 blocks BP4.",
    { splice: { bp4Block: gte(0.1) } }),
  multi("GAMT", "GN026", "2.0", CCDS,
    PEJAVER_PP3_S_M_SUP, { Supporting: lt(0.29) },
    "REVEL up to PP3 Strong (≥ 0.932), BP4 Supporting (< 0.29); SpliceAI ≥ 0.1 blocks BP4.",
    { splice: { bp4Block: gte(0.1) } }),
  ...([["SCN1A", "GN067", "2.0"], ["SCN2A", "GN068", "2.0"], ["SCN3A", "GN069", "2.1"],
    ["SCN8A", "GN070", "2.0"], ["SCN1B", "GN076", "2.0"]] as const).map(([gene, id, ver]) =>
    multi(gene, id, ver, EPILEPSY, EPILEPSY_PP3, EPILEPSY_BP4,
      "REVEL Pejaver 2022 capped at Moderate (≥ 0.773 / ≥ 0.644 PP3; ≤ 0.183 / ≤ 0.290 BP4).")),
  ...([["GP1BA", "GN079", "1.1"], ["GP1BB", "GN082", "1.1"], ["GP9", "GN083", "1.1"]] as const).map(([gene, id, ver]) =>
    multi(gene, id, ver, PLATELET, PLATELET_PP3, PLATELET_BP4,
      "REVEL up to PP3 Moderate (≥ 0.773 / ≥ 0.644), BP4 Supporting (≤ 0.290); SpliceAI ≥ 0.5 PP3, > 0 blocks BP4.",
      { splice: { pp3Missense: { Supporting: gte(0.5) }, bp4Block: gt(0) } })),
  multi("IDUA", "GN091", "1.2", "Lysosomal Diseases Variant Curation Expert Panel",
    { Moderate: gt(0.773), Supporting: gte(0.644) }, { Supporting: lt(0.290) },
    "REVEL > 0.773 (PP3 Moderate), ≥ 0.644 (PP3 Supporting), < 0.290 (BP4 Supporting); SpliceAI > 0.2 PP3.",
    { splice: { pp3Missense: { Supporting: gt(0.2) } } }),
  multi("RPGR", "GN106", "1.0", XIRD,
    PEJAVER_PP3_S_M_SUP,
    { VeryStrong: lte(0.003), Strong: lte(0.016), Moderate: lte(0.183), Supporting: lte(0.290) },
    "REVEL Pejaver 2022 up to PP3 Strong (≥ 0.932) and BP4 Very Strong (≤ 0.003).",
    { notes: ["CSpec GN106 v1.0 labels REVEL ≤ 0.003 'Stand Alone' inside BP4; this engine applies BP4_VeryStrong (never BA1)."] }),
  multi("RS1", "GN126", "1.0", XIRD,
    { Strong: gt(0.931), Moderate: gte(0.773), Supporting: gte(0.644) },
    { VeryStrong: lte(0.003), Strong: lte(0.016), Moderate: lte(0.183), Supporting: lte(0.290) },
    "REVEL up to PP3 Strong (> 0.931) and BP4 Very Strong (≤ 0.003); SpliceAI > 0.1 blocks BP4.",
    {
      splice: { bp4Block: gt(0.1) },
      notes: ["CSpec GN126 v1.0 labels REVEL ≤ 0.003 'Stand Alone' inside BP4; this engine applies BP4_VeryStrong (never BA1)."],
    }),
  multi("FOXN1", "GN113", "2.3", "Severe Combined Immunodeficiency Disease Variant Curation Expert Panel",
    { Moderate: gte(0.932), Supporting: gte(0.644) }, { Supporting: lt(0.290) },
    "REVEL ≥ 0.932 downgraded to PP3 Moderate, ≥ 0.644 PP3 Supporting; < 0.290 BP4 Supporting."),
  multi("RPE65", "GN120", "1.0", LCA, LCA_PP3_M_SUP, LCA_BP4_M_SUP,
    "REVEL up to Moderate (≥ 0.774 / ≥ 0.644 PP3; ≤ 0.183 / ≤ 0.290 BP4); SpliceAI ≥ 0.1 blocks BP4.",
    { splice: { bp4Block: gte(0.1) } }),
  multi("GUCY2D", "GN167", "1.0", LCA, LCA_PP3_M_SUP, LCA_BP4_M_SUP,
    "REVEL up to Moderate (≥ 0.774 / ≥ 0.644 PP3; ≤ 0.183 / ≤ 0.290 BP4); SpliceAI ≥ 0.1 blocks BP4.",
    { splice: { bp4Block: gte(0.1) } }),
  multi("AIPL1", "GN208", "1.0", LCA,
    { Strong: gte(0.932), Moderate: gte(0.774), Supporting: gte(0.644) }, LCA_BP4_M_SUP,
    "REVEL up to PP3 Strong (≥ 0.932), BP4 up to Moderate (≤ 0.183 / ≤ 0.290); SpliceAI ≥ 0.1 blocks BP4.",
    {
      splice: { bp4Block: gte(0.1) },
      notes: ["CSpec GN208 v1.0 prints REVEL ≥ 0.093 Strong / 0.774–0.092 Moderate (transposed decimal); corrected to ≥ 0.932 / 0.774–0.931."],
    }),
  multi("DNAH5", "GN134", "1.0", "Motile Ciliopathy Variant Curation Expert Panel",
    { Strong: gte(0.932), Moderate: gte(0.870), Supporting: gte(0.690) }, PEJAVER_BP4_S_M_SUP,
    "REVEL up to PP3 Strong (≥ 0.932 / ≥ 0.870 / ≥ 0.690) and BP4 Strong (≤ 0.016); SpliceAI ≥ 0.1 blocks BP4.",
    {
      splice: { bp4Block: gte(0.1) },
      notes: ["DNAH5 VCEP additionally caps PP3 + PM1 + PM5 at Strong; PM5 is not computed by this engine."],
    }),
  multi("OTC", "GN156", "1.0", "Urea Cycle Disorders Variant Curation Expert Panel",
    PEJAVER_PP3_S_M_SUP, PEJAVER_BP4_S_M_SUP,
    "REVEL Pejaver 2022 up to Strong (≥ 0.932 / ≤ 0.016)."),
  multi("PAX6", "GN162", "1.0", "Ocular Anterior Segment Disorder Variant Curation Expert Panel",
    { Moderate: gte(0.90), Supporting: gte(0.70) }, { Supporting: lte(0.29) },
    "REVEL ≥ 0.90 (PP3 Moderate), ≥ 0.70 (PP3 Supporting), ≤ 0.29 (BP4 Supporting); SpliceAI > 0.1 blocks BP4.",
    { splice: { bp4Block: gt(0.1) } }),
  multi("ABCA4", "GN164", "1.0", "ABCA4 Variant Curation Expert Panel",
    { Moderate: gt(0.772), Supporting: gte(0.644) }, { Moderate: lt(0.184), Supporting: lte(0.290) },
    "REVEL up to Moderate (> 0.772 / < 0.184); SpliceAI ≥ 0.8 PP3 Moderate, ≥ 0.2 PP3 Supporting.",
    { splice: { pp3Missense: { Moderate: gte(0.8), Supporting: gte(0.2) } } }),
];
