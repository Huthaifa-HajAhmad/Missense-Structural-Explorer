import type { AlphaGenomeAviData } from "../contracts.ts";
import { resolveSourceAvailability } from "../evidenceAvailability.ts";
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
    /** Display name for the `esmcEval` score — the model that actually served it. */
    esmcLabel?: string | null;
    gpnStar?: number | null;
    alphagenome?: AlphaGenomeAviData | null;
    /**
     * Per-source build-gate refusals recorded server-side, so a skipped evidence source can name the
     * reason it was skipped instead of being silently omitted. Optional: absent means no refusal was
     * recorded, which the resolver treats as "not a coverage problem", never as a credential one.
     */
    assemblyRefusals?: Array<{ source: string; reason: string; retryable?: boolean }> | null;
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
      // The score is what is called (Bergquist 2025 bands); the authors' class is only a fallback label.
      scoreLabel: amScore !== null && amScore !== undefined ? `${amScore.toFixed(3)}` : amClass ? amClass : "—",
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
      // No published clinical cut-point: see evaluateEigen.
      isInformationalOnly: true,
    },
    {
      key: "dann",
      name: "DANN",
      signal: evaluateDann(extra?.dann),
      scoreLabel: extra?.dann !== null && extra?.dann !== undefined ? `${extra.dann.toFixed(3)}` : "—",
      // No published clinical cut-point: see evaluateDann.
      isInformationalOnly: true,
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
      /**
       * Informational. The AVI is a rank (tail-quantile Phred), not a calibrated likelihood, and its
       * feature vector includes AlphaMissense — which already votes on its own. Voting it as well
       * counted AlphaMissense twice. See evaluateAlphaGenomeAvi.
       */
      isInformationalOnly: true,
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
      // `esmcEval` is served by ESMC (JapanFold tier 1) or the local VESM sidecar; the payload's
      // `provenance` says which, and a caller that has it passes it as `esmcLabel`.
      name: extra?.esmcLabel ?? "ESMC / VESM",
      signal: evaluateEsm(extra?.vesmLlr),
      scoreLabel: extra?.vesmLlr !== null && extra?.vesmLlr !== undefined ? `${extra.vesmLlr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "esm2_3b",
      // The key is historical; the model served is ESM-2 650M (esm2_t33_650M_UR50D), never 3B.
      name: "ESM-2",
      signal: evaluateEsm(extra?.esm2Llr),
      scoreLabel: extra?.esm2Llr !== null && extra?.esm2Llr !== undefined ? `${extra.esm2Llr.toFixed(2)}` : "—",
      isInformationalOnly: true,
    },
    {
      key: "saprot",
      // Unsized: the remote tier falls back 650M → 35M, and the payload's provenance says which ran.
      name: "SaProt",
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
        ? resolveSourceAvailability({
            value: extra?.alphagenome?.aviPhred ?? null,
            status: extra?.alphagenome?.status ?? null,
            refusals: extra?.assemblyRefusals,
            source: "alphagenome",
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

/**
 * The engine's PP3/BP4 rule, as one function both the engine and every surface call.
 *
 * The rule is a PLURALITY among voting tools: PP3 when pathogenic calls outnumber benign calls, BP4
 * when benign outnumber pathogenic, nothing on a tie. Indeterminate ("vus") calls and informational
 * tools do not count on either side. The criterion is applied at Supporting strength.
 *
 * The Predictors tab used to compute its own verdict with a different rule (a strict MAJORITY of all
 * voting tools), so it could print "Conflicting evidence" beside an engine that had applied PP3 —
 * and the engine then raised PP3 to Moderate or Strong from the AlphaGenome AVI alone, a strength
 * nothing on the tab reported. One function, one rule.
 *
 * The ACMG weighting gates (`strict-structural`, `conservative`) are the engine's, applied after this.
 */
export interface InsilicoVoteOutcome {
  direction: "pathogenic" | "benign" | "tie" | "no-votes";
  /** "PP3" | "BP4" | null — Supporting strength, as the engine records it. */
  code: "PP3" | "BP4" | null;
  nPathogenic: number;
  nBenign: number;
  nIndeterminate: number;
  nVoting: number;
}

export function insilicoVoteOutcome(concordance: Pick<PredictorConcordance, "nPathogenic" | "nBenign" | "nVus">): InsilicoVoteOutcome {
  const { nPathogenic, nBenign, nVus } = concordance;
  const nVoting = nPathogenic + nBenign + nVus;
  const base = { nPathogenic, nBenign, nIndeterminate: nVus, nVoting };
  if (nVoting === 0) return { ...base, direction: "no-votes", code: null };
  if (nPathogenic > nBenign) return { ...base, direction: "pathogenic", code: "PP3" };
  if (nBenign > nPathogenic) return { ...base, direction: "benign", code: "BP4" };
  return { ...base, direction: "tie", code: null };
}
