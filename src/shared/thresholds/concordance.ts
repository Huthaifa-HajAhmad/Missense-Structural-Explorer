import type { AlphaGenomeAviData } from "../contracts.ts";
import { resolveEvidenceAvailability, refusalReasonFor } from "../evidenceAvailability.ts";
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
    /**
     * Per-source build-gate refusals recorded server-side, so a skipped evidence source can name the
     * reason it was skipped instead of being silently omitted. Optional: absent means no refusal was
     * recorded, which the resolver treats as "not a coverage problem", never as a credential one.
     */
    assemblyRefusals?: Array<{ source: string; reason: string }> | null;
    /** Whether a credential is known to be configured. `undefined` = the caller does not know. */
    alphagenomeConfigured?: boolean;
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
      /**
       * AlphaGenome used to be dropped from `unavailable` whenever it was not live, on the premise
       * that it was "without API key/endpoint" — an unprovisioned deployment, where a partial-evidence
       * warning would be noise the user cannot act on.
       *
       * That premise stopped being the only reason a score can be absent. A build-gate refusal also
       * leaves it unlive, and suppressing *that* hides a skipped evidence source from the one line
       * positioned to report it — while the panel beside it blamed the credential. The two cases are
       * now separated by the resolver rather than by assumption:
       *
       *   • not provisioned here  → still silent. Nothing to do, no source skipped for this variant.
       *   • declined this coordinate, or a provider fault → named, with the recorded reason, because
       *     the consensus genuinely is partial and the reader should know which source and why.
       *
       * The vote is unaffected either way: `unavailable` signals are excluded from the counts.
       */
      const skipReason = tool.key === "alphagenome"
        ? resolveEvidenceAvailability({
            value: extra?.alphagenome?.aviPhred ?? null,
            status: extra?.alphagenome?.status ?? null,
            refusal: refusalReasonFor(extra?.assemblyRefusals, "alphagenome"),
            message: extra?.alphagenome?.message ?? null,
            configured: extra?.alphagenomeConfigured,
          })
        : null;

      const notProvisioned = skipReason !== null && skipReason.state === "not-configured";
      if (!notProvisioned) {
        unavailable.push(
          skipReason?.state === "not-covered" && skipReason.reason
            ? `${tool.name.toUpperCase()} — NOT ASSESSED: ${skipReason.reason}`
            : tool.name.toUpperCase(),
        );
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
