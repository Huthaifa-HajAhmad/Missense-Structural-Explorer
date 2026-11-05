// Written by `npx tsx scripts/foldx-repair-benchmark.ts --report --write-disclosure`. Do not edit by hand.
// Above 233 residues the app repairs locally (typicalError, medianGap, maxGap, bandChanges cover those chains).
// overall* / smallChain* are FoldX's error against the measured ΔΔG (kcal/mol) and its band hit rate.
export const LOCAL_REPAIR_BENCHMARK = {
  "dataset": "s669_clean_dir.csv",
  "variants": 92,
  "chains": 13,
  "medianGap": 0.09,
  "maxGap": 1.87,
  "bandChanges": 4,
  "typicalError": 2.54,
  "smallChainRmse": 1.86,
  "smallChainVariants": 575,
  "smallChainBandAgreement": 48.7,
  "localBandAgreement": 41.3,
  "overallRmse": 1.97,
  "overallVariants": 667,
  "overallBandAgreement": 47.38,
  "overallNeutralShare": 41.08,
  "smallChainNeutralShare": 39.13,
  "localNeutralShare": 53.26,
  "smallChainWithinError": 76.52,
  "localWithinError": 71.74,
  "largeValueFoldx": 4.26,
  "largeValueMeasured": 2.18
} as const;
