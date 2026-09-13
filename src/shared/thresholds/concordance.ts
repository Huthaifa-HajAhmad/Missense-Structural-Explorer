import type { AlphaGenomeAviData } from "../contracts.ts";
import {
  type PredictorSignal,
  evaluateCadd,
  evaluateRevel,
  evaluateAlphaMissense,
  evaluateBayesdel,
  evaluateMetaRnn,
  evaluateClinPred,
  evaluateEigen,
  evaluateDann,
  evaluatePopEve,
  evaluateAlphaGenomeAvi,
  evaluateEsm1b,
  evaluateEsm,
  evaluateGpnStar
} from "./evaluators.ts";

export interface PredictorToolDetails {
  key: string;
  name: string;
  signal: PredictorSignal;
  scoreLabel: string;
  isInformationalOnly?: boolean;
}

export interface PredictorConcordance {
  nPathogenic: number;
  nBenign:     number;
  nDeleterious: number;
  nTolerated:  number;
  nVus:        number;
  available:   string[];
  unavailable: string[];
  pathogenicTools: PredictorToolDetails[];
  benignTools:     PredictorToolDetails[];
  vusTools:        PredictorToolDetails[];
  signals: Record<string, PredictorSignal>;
}

export function countPredictorConcordance(
  caddPhred: number | null | undefined,
  revel:     number | null | undefined,
  amScore:   number | null | undefined,
  amClass:   string | null | undefined,
  bayesdel?: number | null | undefined,
  esmLlr?:   number | null | undefined,
  extra?: {
    metarnn?: number | null;
    clinpred?: number | null;
    eigenPhred?: number | null;
    dann?: number | null;
    popeve?: number | null;
    esm2Llr?: number | null;
    saprotLlr?: number | null;
    vesmLlr?: number | null;
    gpnStar?: number | null;
    alphagenome?: AlphaGenomeAviData | null;
  }
): PredictorConcordance {
  const toolDefs: PredictorToolDetails[] = [
    {
      key: "cadd",
      name: "CADD",
      signal: evaluateCadd(caddPhred),
      scoreLabel: caddPhred !== null && caddPhred !== undefined ? `${caddPhred.toFixed(1)}` : "—",
    },
    {
      key: "revel",
      name: "REVEL",
      signal: evaluateRevel(revel),
      scoreLabel: revel !== null && revel !== undefined ? `${revel.toFixed(3)}` : "—",
    },
    {
      key: "am",
      name: "AlphaMissense",
      signal: evaluateAlphaMissense(amScore, amClass),
      scoreLabel: amClass ? amClass : amScore !== null && amScore !== undefined ? `${amScore.toFixed(3)}` : "—",
    },
    {
      key: "bayesdel",
      name: "BayesDel",
      signal: evaluateBayesdel(bayesdel),
      scoreLabel: bayesdel !== null && bayesdel !== undefined ? `${bayesdel.toFixed(3)}` : "—",
    },
    {
      key: "metarnn",
      name: "MetaRNN",
      signal: evaluateMetaRnn(extra?.metarnn),
      scoreLabel: extra?.metarnn !== null && extra?.metarnn !== undefined ? `${extra.metarnn.toFixed(3)}` : "—",
    },
    {
      key: "clinpred",
      name: "ClinPred",
      signal: evaluateClinPred(extra?.clinpred),
      scoreLabel: extra?.clinpred !== null && extra?.clinpred !== undefined ? `${extra.clinpred.toFixed(3)}` : "—",
    },
    {
      key: "eigen",
      name: "Eigen",
      signal: evaluateEigen(extra?.eigenPhred),
      scoreLabel: extra?.eigenPhred !== null && extra?.eigenPhred !== undefined ? `${extra.eigenPhred.toFixed(1)}` : "—",
    },
    {
      key: "dann",
      name: "DANN",
      signal: evaluateDann(extra?.dann),
      scoreLabel: extra?.dann !== null && extra?.dann !== undefined ? `${extra.dann.toFixed(3)}` : "—",
    },
    {
      key: "popeve",
      name: "popEVE",
      signal: evaluatePopEve(extra?.popeve),
      scoreLabel: extra?.popeve !== null && extra?.popeve !== undefined ? `${extra.popeve.toFixed(3)}` : "—",
    },
    {
      key: "alphagenome",
      name: "AlphaGenome",
      signal: evaluateAlphaGenomeAvi(extra?.alphagenome),
      scoreLabel: extra?.alphagenome?.aviPhred !== null && extra?.alphagenome?.aviPhred !== undefined
        ? `${extra.alphagenome.aviPhred.toFixed(1)} Phred`
        : "—",
      isInformationalOnly: false,
    },
    {
      key: "esm",
      name: "ESM-1b",
      signal: evaluateEsm1b(esmLlr),
      scoreLabel: esmLlr !== null && esmLlr !== undefined ? `${esmLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "vesm",
      name: "VESM-150M",
      signal: evaluateEsm(extra?.vesmLlr),
      scoreLabel: extra?.vesmLlr !== null && extra?.vesmLlr !== undefined ? `${extra.vesmLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "esm2_3b",
      name: "ESM-2 3B",
      signal: evaluateEsm(extra?.esm2Llr),
      scoreLabel: extra?.esm2Llr !== null && extra?.esm2Llr !== undefined ? `${extra.esm2Llr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "saprot",
      name: "SaProt 650M",
      signal: evaluateEsm(extra?.saprotLlr),
      scoreLabel: extra?.saprotLlr !== null && extra?.saprotLlr !== undefined ? `${extra.saprotLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "gpn_star",
      name: "GPN-Star",
      signal: evaluateGpnStar(extra?.gpnStar),
      scoreLabel: extra?.gpnStar !== null && extra?.gpnStar !== undefined ? `${extra.gpnStar.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
  ];

  const available: string[]   = [];
  const unavailable: string[] = [];
  const signals: Record<string, PredictorSignal> = {};
  const pathogenicTools: PredictorToolDetails[] = [];
  const benignTools: PredictorToolDetails[]     = [];
  const vusTools: PredictorToolDetails[]        = [];

  let nPathogenic = 0, nBenign = 0, nVus = 0;

  for (const tool of toolDefs) {
    signals[tool.key] = tool.signal;
    if (tool.signal === "unavailable") {
      // Unconfigured frontier models in clean Standby (e.g. AlphaGenome without API key/endpoint)
      // do not penalize the in-silico missense consensus report with false partial evidence warnings.
      const isUnconfiguredStandby =
        tool.key === "alphagenome" &&
        (!extra?.alphagenome || extra.alphagenome.status === "unavailable" || extra.alphagenome.aviPhred === null);

      if (!isUnconfiguredStandby) {
        unavailable.push(tool.name.toUpperCase());
      }
    } else {
      available.push(tool.name.toUpperCase());
      if (tool.signal === "pathogenic") {
        pathogenicTools.push(tool);
        if (!tool.isInformationalOnly) nPathogenic++;
      } else if (tool.signal === "benign") {
        benignTools.push(tool);
        if (!tool.isInformationalOnly) nBenign++;
      } else {
        vusTools.push(tool);
        if (!tool.isInformationalOnly) nVus++;
      }
    }
  }

  return {
    nPathogenic,
    nBenign,
    nDeleterious: nPathogenic,
    nTolerated: nBenign,
    nVus,
    available,
    unavailable,
    pathogenicTools,
    benignTools,
    vusTools,
    signals
  };
}
