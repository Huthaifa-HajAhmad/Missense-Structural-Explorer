/**
 * frequencyRule.test.ts — the BA1/BS1/PM2 decision the engine and the Population tab share, the
 * curated-inheritance basis for PM2's ceiling and BS2's genotype, and gnomAD's grpmax groups.
 *
 * Reference variant: UROD p.Gly318Arg (1-45015346-G-A). gnomAD v4 joint: AC 1,674 / AN 1,613,998
 * (0.104%), African-ancestry 1,272 / 75,018 (1.70%), FAF95 1.618% (afr), 15 homozygotes. The app
 * used to read the 0.104% combined figure from the local ingest and call it "between the cut-points".
 */
import { describe, expect, it } from "vitest";
import { decideFrequencyCriterion, gnomadRuleInputs } from "../frequencyRule.ts";
import { homozygotesInformBs2, pm2CeilingFor, summariseCuratedInheritance, variantChromosome } from "../inheritanceBasis.ts";
import { GRPMAX_GROUPS, groupMaximum } from "../gnomadGroups.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";

const FREQ = THRESHOLDS.populationFrequency;
const CUT = { recessiveCeiling: FREQ.extremelyRareRecessive, dominantCeiling: FREQ.extremelyRare, pliCut: FREQ.recessivePlI };
const decide = (inputs: NonNullable<ReturnType<typeof gnomadRuleInputs>>, ceiling: number) =>
  decideFrequencyCriterion(inputs, { standAloneBenign: FREQ.standAloneBenign, tooCommonForDisorder: FREQ.tooCommonForDisorder, pm2Ceiling: ceiling });

describe("gnomAD grpmax groups", () => {
  // The UROD joint population rows gnomAD returns, including the rows grpmax must ignore.
  const UROD_JOINT = [
    { id: "afr", ac: 1272, an: 75018 }, { id: "amr", ac: 63, an: 60020 }, { id: "nfe", ac: 267, an: 1179986 },
    { id: "sas", ac: 7, an: 91066 }, { id: "eas", ac: 0, an: 44886 }, { id: "mid", ac: 5, an: 5978 },
    { id: "fin", ac: 0, an: 64042 }, { id: "asj", ac: 0, an: 29598 }, { id: "ami", ac: 0, an: 912 },
    { id: "remaining", ac: 60, an: 62492 }, { id: "XX", ac: 893, an: 812362 }, { id: "afr_XY", ac: 900, an: 3000 },
    { id: "1kg:msl", ac: 5, an: 160 },
  ];

  it("takes the maximum over afr, amr, eas, mid, nfe and sas only", () => {
    expect(GRPMAX_GROUPS).toEqual(["afr", "amr", "eas", "mid", "nfe", "sas"]);
    const g = groupMaximum(UROD_JOINT, FREQ.groupMinAn);
    expect(g?.population).toBe("afr");
    expect(g?.af).toBeCloseTo(1272 / 75018, 10);
  });

  it("never lets a sex split, a founder group or 'remaining' become the maximum", () => {
    const g = groupMaximum([{ id: "fin", ac: 900, an: 3000 }, { id: "afr_XY", ac: 900, an: 3000 }, { id: "remaining", ac: 900, an: 3000 }, { id: "nfe", ac: 1, an: 10000 }], FREQ.groupMinAn);
    expect(g?.population).toBe("nfe");
  });

  it("sums a group's exome and genome rows before dividing", () => {
    const g = groupMaximum([{ id: "afr", ac: 570, an: 33466 }, { id: "afr", ac: 702, an: 41552 }], FREQ.groupMinAn);
    expect(g?.ac).toBe(1272);
    expect(g?.an).toBe(75018);
  });
});

describe("frequency rule — which number each criterion reads", () => {
  it("reads BA1/BS1 on FAF95 and PM2 on the raw grouped maximum (UROD → BS1)", () => {
    const inputs = gnomadRuleInputs({ groupMaxAF: 1272 / 75018, maxAF: 0.0049, faf95: 0.01618, dataset: "gnomad_r4" })!;
    expect(inputs.benignStatistic).toBe("faf95");
    expect(inputs.pm2Statistic).toBe("group-max");
    expect(decide(inputs, FREQ.extremelyRare)).toBe("BS1");
  });

  it("does not let a grouped maximum above 1% carry BS1 when FAF95 is below it", () => {
    const inputs = gnomadRuleInputs({ groupMaxAF: 0.012, maxAF: 0.004, faf95: 0.006, dataset: "gnomad_r4" })!;
    expect(decide(inputs, FREQ.extremelyRare)).toBe("none");
  });

  // The everyday outcome on a constrained gene: FAF95 present, far under the benign cut-points, and
  // the grouped maximum under the ceiling — the rule must still land on PM2. (UROD's FAF95 above 1%
  // covers the benign side; this is the rare side, where FAF95 exists and PM2 fires.)
  it("awards PM2 when FAF95 is present and below both benign cut-points and the grouped maximum is under the ceiling", () => {
    const inputs = gnomadRuleInputs({ groupMaxAF: 0.00005, maxAF: 0.00003, faf95: 0.00002, dataset: "gnomad_r4" })!;
    expect(inputs.benignStatistic).toBe("faf95");
    expect(inputs.pm2Statistic).toBe("group-max");
    expect(decide(inputs, FREQ.extremelyRare)).toBe("PM2");
  });

  it("names the local ingest's figure as combined, with no FAF95", () => {
    const inputs = gnomadRuleInputs({ groupMaxAF: 0.00104, maxAF: 0.00104, faf95: 0.5, dataset: "gnomad_r4_local" })!;
    expect(inputs.pm2Statistic).toBe("combined");
    expect(inputs.benignStatistic).toBe("combined");
    expect(inputs.benignAf).toBe(0.00104);
  });
});

describe("curated inheritance", () => {
  const frame = (id: string, label: string, ...levels: string[]) => ({ inheritance: { id, label }, validity: levels.map(level => ({ level })) });

  it("counts only Definitive, Strong or Moderate records (UROD: AD, AR and semidominant qualify; HEP's Supportive AR does not)", () => {
    const urod = summariseCuratedInheritance([
      frame("HP:0000006", "Autosomal dominant", "Strong", "Supportive"),
      frame("HP:0000007", "Autosomal recessive", "Strong"),
      frame("HP:0000007", "Autosomal recessive", "Supportive"),
      frame("HP:0032113", "Semidominant", "Definitive"),
    ])!;
    expect(urod.records).toBe(3);
    expect(urod.recessiveOnly).toBe(false);
    expect(pm2CeilingFor({ inheritance: urod, pli: 0 }, CUT)).toMatchObject({ ceiling: FREQ.extremelyRare, basis: "curated-dominant" });
  });

  it("gives the higher ceiling only when every qualifying record is autosomal recessive, ahead of pLI", () => {
    const ar = summariseCuratedInheritance([frame("HP:0000007", "Autosomal recessive", "Definitive")]);
    expect(pm2CeilingFor({ inheritance: ar, pli: 1 }, CUT)).toMatchObject({ ceiling: FREQ.extremelyRareRecessive, basis: "curated-recessive" });
  });

  it("falls back to pLI only without a qualifying record", () => {
    expect(summariseCuratedInheritance([frame("HP:0000006", "Autosomal dominant", "Limited")])).toBeNull();
    expect(pm2CeilingFor({ inheritance: null, pli: 0.2 }, CUT).basis).toBe("pli-recessive");
    expect(pm2CeilingFor({ inheritance: null, pli: null }, CUT).basis).toBe("unknown");
  });

  it("keeps the homozygote count out of BS2 on sex chromosomes and X/Y/mito-only genes", () => {
    expect(variantChromosome("X-153000000-A-G")).toBe("X");
    expect(variantChromosome("chrMT-100-A-G")).toBe("M");
    expect(homozygotesInformBs2({ variantId: "X-153000000-A-G" }).applies).toBe(false);
    const xl = summariseCuratedInheritance([frame("HP:0001419", "X-linked recessive", "Definitive")]);
    expect(homozygotesInformBs2({ variantId: "1-45015346-G-A", inheritance: xl }).applies).toBe(false);
    expect(homozygotesInformBs2({ variantId: "1-45015346-G-A", inheritance: null }).applies).toBe(true);
  });
});
