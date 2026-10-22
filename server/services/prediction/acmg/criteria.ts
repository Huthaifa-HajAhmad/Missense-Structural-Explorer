import {
  THRESHOLDS,
  countPredictorConcordance,
  insilicoVoteOutcome,
  PredictorConcordance,
} from "../../../../src/shared/thresholds.ts";
import type { ClinVarData } from "../../external-api/clinvar.ts";
import type { PredictorData, ConservationData } from "../../../../src/shared/contracts.ts";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "../../external-api/gnomad.ts";
import type { UniprotFeaturesResult } from "../../external-api/uniprot.ts";
import { isNullVariant, isInFrameIndel, isIndelInRepeatRegion } from "./syntax.ts";
import type { ACMGItem } from "./classifier.ts";
import { assessPm1, featureCoversResidue } from "../../../../src/shared/functionalSites.ts";
import { classifyClinvar } from "../../../../src/shared/clinvarClassification.ts";

export interface ACMGEvidenceInput {
  gene: string;
  variant: string;
  /**
   * The residue number on the canonical protein, as the caller's parsed context holds it. PVS1's
   * C-terminal test and PM1 prefer it to re-reading digits out of `variant`, which has no shape
   * guarantee; absent, the first digit run in `variant` is used as before.
   */
  residueIndex?: number | null;
  clinvar?: Partial<ClinVarData> | ClinVarData | null;
  predictorData?: Partial<PredictorData> | PredictorData | null;
  conservationData?: Partial<ConservationData> | ConservationData | null;
  gnomadConstraint?: GnomadGeneConstraint | {
    missense_z: number | null;
    oe_mis: number | null;
    pli: number | null;
    isPP2Constrained: boolean;
  } | null;
  gnomadFrequency?: GnomadVariantFrequency | {
    maxAF: number | null;
    groupMaxAF: number | null;
    genomeAF: number | null;
    exomeAF: number | null;
    nHomozygous: number | null;
    dataset: string;
    groupMaxAFIsFallback?: boolean;
  } | null;
  acmgWeighting?: "standard" | "conservative" | "strict-structural";
  esm2?: { llr: number | null; verdict: string } | null;
  uniprotFeatures?: { features?: Array<{ type: string; start: number; end: number; description?: string }>; [key: string]: any } | UniprotFeaturesResult | null;
  sequence?: string | null;
  esmcEval?: any | null;
  esm2Eval?: any | null;
  saprotEval?: any | null;
  serviceStatus?: Record<string, string> | any | null;
}

export interface CriteriaEvaluationResult {
  criteria: ACMGItem[];
  available: string[];
  unavailable: string[];
}

/**
 * Evaluates individual ACMG/AMP 2015 criteria rules from multi-source database and predictor inputs.
 */
export function evaluateAcmgCriteria(input: ACMGEvidenceInput): CriteriaEvaluationResult {
  const {
    gene,
    variant,
    residueIndex = null,
    clinvar = null,
    predictorData = null,
    conservationData = null,
    gnomadConstraint = null,
    gnomadFrequency = null,
    acmgWeighting = "standard",
    esm2 = null,
    uniprotFeatures = null,
    sequence = null,
    esmcEval = null,
    esm2Eval = null,
    saprotEval = null,
    serviceStatus = null
  } = input;
  const criteria: ACMGItem[] = [];

  const residuePos = (): number | null => {
    if (typeof residueIndex === "number" && Number.isInteger(residueIndex) && residueIndex > 0) return residueIndex;
    const m = variant.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  };

  // `classifyClinvar`, not a substring test: "Conflicting interpretations of pathogenicity" contains
  // "pathogenic" and must not open the conservative-weighting gate.
  const clinvarCls = classifyClinvar(clinvar?.classification);
  const isClinVarPathogenic = clinvarCls === "plp";
  const isClinVarBenign = clinvarCls === "blb";

  const skipPathogenicComp = acmgWeighting === "strict-structural" || (acmgWeighting === "conservative" && !isClinVarPathogenic);
  const skipBenignComp = acmgWeighting === "strict-structural" || (acmgWeighting === "conservative" && !isClinVarBenign);

  // -------------------------------------------------------------------------
  // PVS1 — Null variant in a gene where LOF is a known mechanism of disease
  // -------------------------------------------------------------------------
  const isLofIntolerant = gnomadConstraint?.pli !== null && gnomadConstraint?.pli !== undefined && gnomadConstraint.pli >= 0.9;
  const isLofGene = isLofIntolerant;
  
  if (isNullVariant(variant) && !isInFrameIndel(variant) && isLofGene && !skipPathogenicComp) {
    const pos = residuePos();
    const seqLen = sequence ? sequence.length : null;

    let nmdPredicted = true;
    let nmdNote = "nonsense-mediated decay (NMD) is predicted to occur.";

    if (pos && seqLen) {
      // Predict NMD absence if variant falls in the last exon / last 50 aa or 10% C-terminal of the protein
      const threshold = Math.max(50, Math.round(seqLen * 0.1));
      if (pos >= seqLen - threshold) {
        nmdPredicted = false;
        nmdNote = `nonsense-mediated decay (NMD) is not predicted to occur because the variant at position ${pos}/${seqLen} falls in the C-terminal region.`;
      }
    }

    if (nmdPredicted) {
      criteria.push({
        code: "PVS1",
        reason: `PVS1 (Very Strong): Null variant (${variant}) in gene ${gene} where loss-of-function is an established mechanism of disease. ${nmdNote}`
      });
    } else {
      // Check if variant overlaps a functional domain, active site, binding site
      let isCriticalDomain = false;
      if (uniprotFeatures?.features && Array.isArray(uniprotFeatures.features) && pos) {
        isCriticalDomain = uniprotFeatures.features.some((f: any) => {
          const type = (f.type || "").toLowerCase();
          // `featureCoversResidue`, not `start <= pos <= end`: a disulfide bond covers its two cysteines only.
          return (type.includes("domain") || type.includes("site") || type.includes("active") || type.includes("binding")) &&
                 featureCoversResidue(f, pos);
        });
      }

      if (isCriticalDomain) {
        criteria.push({
          code: "PVS1_Strong",
          reason: `PVS1_Strong (Strong): C-terminal null variant (${variant}) in gene ${gene} where NMD is not predicted to occur, but residue falls within an established functional domain/site.`
        });
      } else {
        criteria.push({
          code: "PVS1_Moderate",
          reason: `PVS1_Moderate (Moderate): C-terminal null variant (${variant}) in gene ${gene} where NMD is not predicted to occur, and no critical domain overlap is confirmed.`
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // ACMG-3: Map ClinVar database status directly to standard ACMG codes (PS1)
  // -------------------------------------------------------------------------
  if (clinvar?.hasOtherPathogenicVariantSameAA && !skipPathogenicComp) {
    criteria.push({
      code: "PS1",
      reason: `Same amino acid change as a previously established pathogenic variant in ClinVar database (different nucleotide change).`
    });
  }

  // -------------------------------------------------------------------------
  // 1. PP3 / BP4  — In-silico predictor concordance (ACMG-5 fix)
  // -------------------------------------------------------------------------
  const concordance: PredictorConcordance = countPredictorConcordance(
    predictorData?.caddPhred,
    conservationData?.revel,
    predictorData?.amPathogenicity,
    predictorData?.amClass,
    conservationData?.bayesdel,
    /**
     * This positional argument is labelled "ESM-1b" and evaluated against ESM1b's ClinGen
     * bands (Bergquist 2025), so it must receive an ESM-1b score. It was
     * being fed `esmcEval?.llr ?? esm2?.llr`, which made an ESMC ΔLLR of ~-8.4 render as
     * "ESM-1b: pathogenic". ESMC, ESM-2 and SaProt have no published cut-points on their
     * own scales and travel through `extra` below, which is evaluated as informational.
     */
    conservationData?.esm1b ?? null,
    {
      metarnn: conservationData?.metarnn,
      clinpred: conservationData?.clinpred,
      eigenPhred: conservationData?.eigenPhred,
      dann: conservationData?.dann,
      popeve: conservationData?.popeve,
      esm2Llr: esm2Eval?.llr ?? esm2?.llr ?? null,
      vesmLlr: esmcEval?.llr ?? null,
      esmcLabel: typeof esmcEval?.provenance === "string" ? esmcEval.provenance : null,
      saprotLlr: saprotEval?.llr,
      gpnStar: conservationData?.gpnStar ?? null,
      alphagenome: conservationData?.alphagenome,
      // So a source the build gate declined is named in the consensus coverage line rather than
      // silently omitted (see src/shared/thresholds/concordance.ts).
      assemblyRefusals: conservationData?.assemblyRefusals
    }
  );

  const { nPathogenic, nBenign, nVus, available, unavailable } = concordance;
  const nActiveAvailable = nPathogenic + nBenign + nVus;
  const nAvailable = nActiveAvailable > 0 ? nActiveAvailable : available.length;

  /**
   * The reason text names every tool that voted, with its score, grouped by its call — the previous
   * text listed CADD, REVEL, AlphaMissense (by class), popEVE and BayesDel only, so MetaRNN and
   * ClinPred voted without appearing in the justification a curator reads.
   */
  const { pathogenicTools, benignTools, vusTools } = concordance;
  const listTools = (tools: typeof pathogenicTools) => tools.map(t => `${t.name} ${t.scoreLabel}`).join(", ");
  const voting = (tools: typeof pathogenicTools) => tools.filter(t => !t.isInformationalOnly);
  const buildPredictorDetail = () => {
    const parts = [
      voting(pathogenicTools).length ? `pathogenic: ${listTools(voting(pathogenicTools))}` : null,
      voting(benignTools).length ? `benign: ${listTools(voting(benignTools))}` : null,
      voting(vusTools).length ? `indeterminate: ${listTools(voting(vusTools))}` : null,
    ].filter(Boolean);
    const informational = [...pathogenicTools, ...benignTools, ...vusTools].filter(t => t.isInformationalOnly);
    return (
      `Votes — ${parts.join("; ")}` +
      (informational.length ? `. Informational, not counted: ${listTools(informational)}` : "") +
      (unavailable.length > 0 ? `. ⚠ Partial evidence — unavailable: ${unavailable.join(", ")}` : "")
    );
  };

  /**
   * The rule is `insilicoVoteOutcome` — the same function the Predictors tab reads — applied at
   * Supporting strength.
   *
   * This block used to raise PP3 to Moderate (AVI Phred ≥ 25) or Strong (≥ 35), and BP4 to Moderate
   * (≤ 5), from the AlphaGenome AVI alone. The AVI is a tail-quantile rank with no ClinGen
   * calibration, and AlphaMissense is one of its own features, so a single uncalibrated composite
   * decided the strength of a criterion the whole panel had voted on — and no surface said so.
   * The strength now stays at Supporting, which is what an uncalibrated vote can carry.
   */
  const rawVote = insilicoVoteOutcome(concordance);

  /**
   * A salvaged composite (its budget expired) carries `modelStatus`. Three of its models VOTE — the
   * dbNSFP ensemble, PopEVE and AlphaGenome — so a vote taken while any of them is unanswered is a
   * vote over a known-incomplete ensemble: a missing benign PopEVE turns a 2–2 tie into PP3. The
   * criterion is withheld, in the same way a timed-out gnomAD withdraws PM2, and the verdict stays
   * revisable on a re-run. The status is read from the payload, so every producer (stream, healer,
   * structural recompute) applies the same rule.
   */
  const votingModelStatus = conservationData?.modelStatus;
  const ensembleIncomplete = Boolean(
    votingModelStatus && (["base", "popeve", "alphagenome"] as const).some(model => {
      const state = votingModelStatus[model];
      return state !== undefined && state !== "settled";
    })
  );
  const vote = ensembleIncomplete ? { ...rawVote, code: null } : rawVote;

  if (vote.code === "PP3" && !skipPathogenicComp) {
    const consensusWord =
      nPathogenic >= 2 ? `${nPathogenic}/${nAvailable} predictors agree on pathogenic impact` :
                         `${nPathogenic}/${nAvailable} predictor supports pathogenic impact`;
    const conflictNote =
      nBenign >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nBenign} predictor(s) support benign.`
        : "";

    criteria.push({
      code: "PP3",
      reason:
        `${consensusWord}. (${buildPredictorDetail()})${conflictNote}`,
    });
  } else if (vote.code === "BP4" && !skipBenignComp) {
    const consensusWord =
      nBenign >= 2 ? `${nBenign}/${nAvailable} predictors agree on benign impact` :
                     `${nBenign}/${nAvailable} predictor supports benign impact`;
    const conflictNote =
      nPathogenic >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nPathogenic} predictor(s) support pathogenic.`
        : "";

    criteria.push({
      code: "BP4",
      reason: `${consensusWord}. (${buildPredictorDetail()})${conflictNote}`,
    });
  }

  // -------------------------------------------------------------------------
  // 2. PM2 / BS1 / BA1 — Population frequency
  // -------------------------------------------------------------------------
  let maxFreq = 0;
  let hasFreq = false;

  const isGnomadTimeoutOrError = serviceStatus?.gnomadFrequency === "timeout" || serviceStatus?.gnomadFrequency === "error";
  /**
   * A build gnomAD does not serve is a refusal, not an absence.
   *
   * `core-data-fetcher.ts` refuses a non-GRCh38 coordinate BEFORE querying, so any absence-shaped
   * reading is a fact about our query rather than about the variant. Classifying it is worse than a
   * display bug: it awarded PM2 — pathogenic-frequency support — for a variant no database had been
   * asked about. Withheld like an outage, and named so the reason survives into `unavailable`.
   */
  const isGnomadBuildRefused = serviceStatus?.gnomadFrequency === "unsupported-build";
  /** Any reason the frequency was never obtained. None of them may reach a criterion. */
  const isGnomadWithheld = isGnomadTimeoutOrError || isGnomadBuildRefused;

  /**
   * A number, or `null` for anything that is not one.
   *
   * `groupMaxAF` and `maxAF` are `z.number().nullable().optional()` on the wire
   * (`src/shared/contracts.ts`), and persisted payloads predate both keys. The previous guard tested
   * `!== null`, which is TRUE for `undefined` — so a payload without `groupMaxAF` set
   * `maxFreq = undefined`, every comparison below evaluated false, and **PM2 was silently dropped**
   * (while `hasFreq` stayed true, so nothing reported that either). `NaN`/`Infinity` from an
   * unguarded division had the same effect. Both are read as "no reading" here.
   */
  const finiteNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const groupedMaxAF = finiteNumber(gnomadFrequency?.groupMaxAF);
  const globalMaxAF = finiteNumber(gnomadFrequency?.maxAF);

  if (isGnomadWithheld) {
    if (!unavailable.includes("GNOMAD_FREQUENCY")) {
      unavailable.push(
        isGnomadBuildRefused
          ? "GNOMAD_FREQUENCY (this coordinate's build is not one gnomAD r4 serves — PM2 withheld)"
          : "GNOMAD_FREQUENCY (timeout/error — PM2 withheld)",
      );
    }
  } else if (groupedMaxAF !== null) {
    maxFreq = groupedMaxAF;
    hasFreq = true;
  } else if (globalMaxAF !== null) {
    maxFreq = globalMaxAF;
    hasFreq = true;
  } else if (serviceStatus?.gnomadFrequency === "not_found") {
    // Confirmed queried in gnomAD and explicitly absent from population reference
    maxFreq = 0;
    hasFreq = true;
  } else if (clinvar?.alleleFrequencies && Array.isArray(clinvar.alleleFrequencies)) {
    /**
     * ClinVar-submitted frequencies.
     *
     * Only a value that parses to a FINITE number is evidence. The wire type is
     * `{ source: string; value: any }` (`external-api/clinvar.ts:18`), so a malformed value is
     * reachable; the previous revision counted any non-null value as "frequency present" with a
     * magnitude of zero, which manufactured an "extremely rare" finding — PM2 — out of a broken
     * record.
     */
    const submitted = clinvar.alleleFrequencies
      .map(freq => finiteNumber(typeof freq.value === "string" ? parseFloat(freq.value) : freq.value))
      .filter((value): value is number => value !== null);
    if (submitted.length > 0) {
      hasFreq = true;
      maxFreq = Math.max(...submitted);
    }
  }

  if (hasFreq && !isGnomadWithheld) {
    const fallbackSuffix = gnomadFrequency?.groupMaxAFIsFallback
      ? " (note: groupMaxAF fell back to global maxAF due to low population counts)"
      : "";
    /**
     * Cut-points come from `THRESHOLDS.populationFrequency`, not from literals here.
     *
     * The engine and the Evidence Lineage card that documents it used to hold separate copies, and
     * they disagreed: this branch tested BS1 at 1% while the card printed "MAF > 0.1%". Both the
     * number and the percentages interpolated into the reason strings below are derived from the
     * shared constant, so the sentence a clinician reads is generated by the rule that fired.
     */
    const FREQ = THRESHOLDS.populationFrequency;
    const pct = (value: number, digits: number) => `${(value * 100).toFixed(digits)}%`;

    if (maxFreq > FREQ.standAloneBenign) {
      criteria.push({
        code: "BA1",
        reason: `Allele frequency is stand-alone benign (${pct(maxFreq, 3)} > ${pct(FREQ.standAloneBenign, 1)} in population database)${fallbackSuffix}.`,
      });
    } else if (maxFreq > FREQ.tooCommonForDisorder) {
      criteria.push({
        code: "BS1",
        reason: `Allele frequency significantly higher than expected for disorder (${pct(maxFreq, 3)} > ${pct(FREQ.tooCommonForDisorder, 1)})${fallbackSuffix}.`,
      });
    } else {
      // PM2 local pLI-based ceiling (lower: ≤ 0.01%, higher: ≤ 0.1%); this does not establish inheritance
      let pm2Threshold: number = FREQ.extremelyRare;
      let inheritanceModeText = "lower ceiling; pLI not available";
      if (gnomadConstraint?.pli !== null && gnomadConstraint?.pli !== undefined) {
        if (gnomadConstraint.pli < FREQ.recessivePlI) {
          pm2Threshold = FREQ.extremelyRareRecessive;
          inheritanceModeText = `higher ceiling (pLI < ${FREQ.recessivePlI})`;
        } else {
          inheritanceModeText = `lower ceiling (pLI ≥ ${FREQ.recessivePlI})`;
        }
      }

      if (maxFreq <= pm2Threshold) {
        if (!skipPathogenicComp) {
          criteria.push({
            code: "PM2",
            reason: `Variant is extremely rare in population databases (frequency ${(maxFreq * 100).toFixed(4)}% ≤ ${(pm2Threshold * 100).toFixed(2)}% app-defined threshold: ${inheritanceModeText}; pLI does not establish disease-specific inheritance)${fallbackSuffix}. Applied at Supporting strength (ClinGen SVI 2020, PM2_Supporting).`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BS2 — Observed in homozygous state in healthy population reference
  // -------------------------------------------------------------------------
  if (
    gnomadFrequency &&
    gnomadFrequency.nHomozygous !== null &&
    gnomadFrequency.nHomozygous !== undefined &&
    gnomadFrequency.nHomozygous >= 2 &&
    !skipBenignComp
  ) {
    criteria.push({
      code: "BS2",
      reason: `Observed in homozygous state in ${gnomadFrequency.nHomozygous} individuals in gnomAD general population reference cohort, arguing against fully penetrant severe pathogenic disease causality.`
    });
  }

  // -------------------------------------------------------------------------
  // PM1 — Mutational hotspot and/or critical and well-established functional domain
  // -------------------------------------------------------------------------
  /**
   * The rule lives in `src/shared/functionalSites.ts` (`assessPm1`), which the Functional domains tab
   * reads too. It replaced a test that took any UniProt active/binding/metal/disulfide annotation at the
   * residue, whatever its evidence, read a disulfide bond as covering every residue between its two
   * cysteines, and never applied the PP3 + PM1 ≤ Strong cap.
   *
   * The cap is wired but DORMANT in this engine, by design: PP3 is emitted at Supporting strength only
   * (see the vote block above: the predictors are not calibrated per-criterion here), so `pp3Code` is
   * always bare `PP3` (1 point) and 1 + PM1's 2 = 3 never exceeds Strong (4). It would bind only if the
   * engine began emitting `PP3_Moderate`/`PP3_Strong` from the calibrated reference tool, which is an
   * owner decision (doc/INDEPENDENT_AUDIT_RESPONSE.md, D2). `assessPm1` itself is covered for every
   * strength in `functionalSites.test.ts`, and `acmg.test.ts` pins this dormancy so turning the
   * calibrated strength on cannot silently bypass the cap.
   */
  if (uniprotFeatures?.features && !skipPathogenicComp) {
    const pos = residuePos();
    if (pos !== null) {
      const pp3Code = criteria.find((c) => c.code.startsWith("PP3"))?.code ?? null;
      const pm1 = assessPm1(uniprotFeatures.features as any[], pos, { pp3Code });
      if (pm1.status === "met") {
        criteria.push({ code: "PM1", reason: pm1.reason });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. PP2 — Missense constraint (ACMG-6: live gnomAD constraint preferred)
  // -------------------------------------------------------------------------
  if (gnomadConstraint?.isPP2Constrained && !skipPathogenicComp) {
    const misZ  = typeof gnomadConstraint.missense_z === "number" ? gnomadConstraint.missense_z.toFixed(2) : "N/A";
    const oeMis = typeof gnomadConstraint.oe_mis === "number"     ? gnomadConstraint.oe_mis.toFixed(3)     : "N/A";
    criteria.push({
      code: "PP2",
      reason:
        `Missense variant in gnomAD-constrained gene ${gene} ` +
        `(missense Z-score: ${misZ}, observed/expected: ${oeMis}). ` +
        `Low rate of benign missense variants supports pathogenic missense mechanism.`,
    });
  }

  // -------------------------------------------------------------------------
  // BP1 — NOT APPLIED AUTOMATICALLY (owner decision, doc/THRESHOLDS_TAB_REVIEW.md)
  // -------------------------------------------------------------------------
  /**
   * BP1 is "missense variant in a gene for which primarily truncating variants are known to cause
   * disease" (Richards 2015). That is a curated fact about the gene–disease mechanism. This block
   * used to apply it whenever pLI ≥ 0.9 and the gene was not missense-constrained — but pLI measures
   * intolerance to loss of function in the population, not which variant class causes disease, and
   * a gene can be LoF-intolerant with pathogenic missense variants. The proxy pushed classifications
   * toward benign without the fact the criterion requires, so the engine no longer applies BP1; the
   * Threshold Guide reports it as "not assessed".
   */

  // -------------------------------------------------------------------------
  // PM4 / BP3 — In-frame Indels in repeat vs non-repeat regions
  // -------------------------------------------------------------------------
  if (isInFrameIndel(variant)) {
    const match = variant.match(/\d+/);
    const pos = match ? parseInt(match[0], 10) : NaN;
    const isRepeat = sequence ? isIndelInRepeatRegion(sequence, pos) : false;
    
    if (isRepeat) {
      if (!skipBenignComp) {
        criteria.push({
          code: "BP3",
          reason: `In-frame indel (${variant}) located within a repetitive sequence region.`
        });
      }
    } else {
      if (!skipPathogenicComp) {
        criteria.push({
          code: "PM4",
          reason: `In-frame length-changing indel (${variant}) in a non-repetitive sequence region.`
        });
      }
    }
  }

  return {
    criteria,
    available,
    unavailable
  };
}
