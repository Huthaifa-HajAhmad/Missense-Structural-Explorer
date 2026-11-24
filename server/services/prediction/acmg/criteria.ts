import {
  THRESHOLDS,
  REGIONAL_MISSENSE_CALIBRATION,
  REGIONAL_MISSENSE_SOURCE,
} from "../../../../src/shared/thresholds.ts";
import type { ClinVarData } from "../../external-api/clinvar.ts";
import type { PredictorData, ConservationData, GnomadCandidateReading } from "../../../../src/shared/contracts.ts";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "../../external-api/gnomad.ts";
import type { UniprotFeaturesResult } from "../../external-api/uniprot.ts";
import { isNullVariant, isInFrameIndel, isIndelInRepeatRegion } from "./syntax.ts";
import type { ACMGItem } from "./classifier.ts";
import { assessPm1, featureCoversResidue } from "../../../../src/shared/functionalSites.ts";
import { classifyClinvar } from "../../../../src/shared/clinvarClassification.ts";
import { decideFrequencyCriterion, gnomadRuleInputs, singleRuleInput, STATISTIC_LABEL, BS1_NOT_APPLIED_REASON, BS2_NOT_APPLIED_REASON, type FrequencyRuleInputs } from "../../../../src/shared/frequencyRule.ts";
import { homozygotesInformBs2, pm2CeilingFor, type CuratedInheritance } from "../../../../src/shared/inheritanceBasis.ts";
import type { CuratedLofMechanism } from "../../../../src/shared/lofMechanismBasis.ts";
import { candidateFrequencyCriteria } from "./candidate-frequency.ts";
import { evaluateInsilicoCriterion } from "./pp3-bp4.ts";

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
    pp2Code?: "PP2" | "PP2_Moderate" | null;
    regionalRelease?: string;
    regionalConstraint?: { oeRatio: number | null; regionText: string | null } | null;
  } | null;
  gnomadFrequency?: GnomadVariantFrequency | {
    maxAF: number | null;
    groupMaxAF: number | null;
    genomeAF: number | null;
    exomeAF: number | null;
    nHomozygous: number | null;
    dataset: string;
    groupMaxAFIsFallback?: boolean;
    faf95?: number | null;
    /** One gnomAD reading per candidate allele of a protein-only input (`candidate-frequency.ts`). */
    candidates?: GnomadCandidateReading[] | null;
  } | null;
  /**
   * The gene's curated GenCC inheritance (`summariseCuratedInheritance`), or null when it has no
   * qualifying record. Sets PM2's ceiling ahead of pLI, and keeps BS2 off sex-chromosome genes.
   */
  curatedInheritance?: CuratedInheritance | null;
  /**
   * The gene's curated LOF mechanism (`summariseCuratedLofMechanism`), or null when absent.
   * Required before awarding PVS1 so pLI >= 0.9 alone never assigns PVS1 to non-LOF/uncurated genes.
   */
  curatedLofMechanism?: CuratedLofMechanism | null;
  acmgWeighting?: "standard" | "conservative" | "strict-structural";
  uniprotFeatures?: { features?: Array<{ type: string; start: number; end: number; description?: string }>; [key: string]: any } | UniprotFeaturesResult | null;
  sequence?: string | null;
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
    uniprotFeatures = null,
    sequence = null,
    serviceStatus = null,
    curatedInheritance = null,
    curatedLofMechanism = null
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
  const isLofGene = curatedLofMechanism?.lofEstablished === true;
  let pvs1Unavailable: string | null = null;

  if (isNullVariant(variant) && !isInFrameIndel(variant) && !skipPathogenicComp) {
    if (!isLofGene) {
      if (curatedLofMechanism?.nonLofOnly) {
        pvs1Unavailable = `PVS1 (not applied: curated ${curatedLofMechanism.source} records report ${curatedLofMechanism.mechanisms.join(", ")}, not loss-of-function)`;
      } else if (isLofIntolerant) {
        pvs1Unavailable = `PVS1 (not applied: gnomAD pLI ${gnomadConstraint!.pli!.toFixed(2)} ≥ 0.90 without a curated ClinGen/G2P LOF disease mechanism)`;
      }
    } else {
      const pos = residuePos();
      const seqLen = sequence ? sequence.length : null;
      const mechanismNote = `curated ${curatedLofMechanism!.source} mechanism (${curatedLofMechanism!.mechanisms.join(", ") || "loss of function"})${
        gnomadConstraint?.pli !== null && gnomadConstraint?.pli !== undefined
          ? `; gnomAD pLI ${gnomadConstraint.pli.toFixed(2)}`
          : ""
      }`;

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
          reason: `PVS1 (Very Strong): Null variant (${variant}) in gene ${gene} where loss-of-function is an established disease mechanism via ${mechanismNote}. ${nmdNote}`
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
            reason: `PVS1_Strong (Strong): C-terminal null variant (${variant}) in gene ${gene} (${mechanismNote}) where NMD is not predicted to occur, but residue falls within an established functional domain/site.`
          });
        } else {
          criteria.push({
            code: "PVS1_Moderate",
            reason: `PVS1_Moderate (Moderate): C-terminal null variant (${variant}) in gene ${gene} (${mechanismNote}) where NMD is not predicted to occur, and no critical domain overlap is confirmed.`
          });
        }
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
  // 1. PP3 / BP4 — Primary calibrated predictor (REVEL -> BayesDel -> AM -> ESM1b) + VCEP / SpliceAI
  // -------------------------------------------------------------------------
  const insilico = evaluateInsilicoCriterion(
    {
      gene,
      predictorData,
      conservationData,
      serviceStatus,
      hasPvs1: criteria.some(c => /^PVS1(_|$)/i.test(c.code)),
    },
    { skipPathogenicComp, skipBenignComp },
  );
  criteria.push(...insilico.criteria);
  const available = insilico.available;
  const unavailable = insilico.unavailable;

  // -------------------------------------------------------------------------
  // 2. PM2 / BS1 / BA1 — Population frequency
  // -------------------------------------------------------------------------
  /** What PM2 and BA1/BS1 read (`src/shared/frequencyRule.ts`), or null when there is nothing to read. */
  let ruleInputs: FrequencyRuleInputs | null = null;

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
   * (`src/shared/contracts.ts`), and persisted payloads predate both keys. An `undefined` or `NaN`
   * used to make every comparison false and silently drop PM2; both are read as "no reading" here.
   */
  const finiteNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const gnomadInputs = gnomadRuleInputs(gnomadFrequency);
  const candidateReadings = gnomadFrequency?.candidates?.length ? gnomadFrequency.candidates : null;

  if (isGnomadWithheld) {
    if (!unavailable.includes("GNOMAD_FREQUENCY")) {
      unavailable.push(
        isGnomadBuildRefused
          ? "GNOMAD_FREQUENCY (this coordinate's build is not one gnomAD r4 serves — PM2 withheld)"
          : "GNOMAD_FREQUENCY (timeout/error — PM2 withheld)",
      );
    }
  } else if (candidateReadings) {
    // Several candidate alleles: a criterion holds only if it holds for every one of them.
    const outcome = candidateFrequencyCriteria(candidateReadings, {
      curatedInheritance, pli: gnomadConstraint?.pli ?? null, skipPathogenicComp, skipBenignComp,
    });
    criteria.push(...outcome.criteria);
    unavailable.push(...outcome.unavailable);
  } else if (gnomadInputs) {
    ruleInputs = gnomadInputs;
  } else if (serviceStatus?.gnomadFrequency === "not_found") {
    // Confirmed queried in gnomAD and explicitly absent from population reference
    ruleInputs = singleRuleInput(0, "absent");
  } else if (clinvar?.alleleFrequencies && Array.isArray(clinvar.alleleFrequencies)) {
    /**
     * ClinVar-submitted frequencies. Only a value that parses to a FINITE number is evidence: a
     * malformed value used to be counted as a frequency of zero, which manufactured PM2.
     */
    const submitted = clinvar.alleleFrequencies
      .map(freq => finiteNumber(typeof freq.value === "string" ? parseFloat(freq.value) : freq.value))
      .filter((value): value is number => value !== null);
    if (submitted.length > 0) ruleInputs = singleRuleInput(Math.max(...submitted), "clinvar");
  }

  if (ruleInputs && !isGnomadWithheld) {
    const fallbackSuffix = gnomadFrequency?.groupMaxAFIsFallback
      ? " (note: groupMaxAF fell back to global maxAF due to low population counts)"
      : "";
    const combinedSuffix = ruleInputs.pm2Statistic === "combined"
      ? " (note: this source carries no ancestry groups or FAF95, so a group-enriched allele can sit above this figure)"
      : "";
    /**
     * Cut-points come from `THRESHOLDS.populationFrequency`; the decision from the shared
     * `decideFrequencyCriterion`, so the tab that explains this verdict cannot compute another one.
     */
    const FREQ = THRESHOLDS.populationFrequency;
    const pct = (value: number, digits: number) => `${(value * 100).toFixed(digits)}%`;
    const ceiling = pm2CeilingFor(
      { inheritance: curatedInheritance, pli: gnomadConstraint?.pli ?? null },
      { recessiveCeiling: FREQ.extremelyRareRecessive, dominantCeiling: FREQ.extremelyRare, pliCut: FREQ.recessivePlI },
    );
    const decision = decideFrequencyCriterion(ruleInputs, {
      standAloneBenign: FREQ.standAloneBenign, tooCommonForDisorder: FREQ.tooCommonForDisorder, pm2Ceiling: ceiling.ceiling,
    });
    const benignName = STATISTIC_LABEL[ruleInputs.benignStatistic];
    const pm2Name = STATISTIC_LABEL[ruleInputs.pm2Statistic];

    if (decision === "BA1") {
      criteria.push({
        code: "BA1",
        reason: `Allele frequency is stand-alone benign (${benignName} ${pct(ruleInputs.benignAf, 3)} > ${pct(FREQ.standAloneBenign, 1)})${fallbackSuffix}${combinedSuffix}.`,
      });
    } else if (decision === "BS1") {
      // Above the app-wide reference cut-point, which is not a disease-specific maximum credible allele
      // frequency: shown, not counted (see BS1_COUNTED_AUTOMATICALLY). The reading stays on the payload.
      unavailable.push(`BS1 (not applied: ${BS1_NOT_APPLIED_REASON}; ${benignName} ${pct(ruleInputs.benignAf, 3)} > ${pct(FREQ.tooCommonForDisorder, 1)})`);
    } else if (decision === "PM2" && !skipPathogenicComp) {
      criteria.push({
        code: "PM2",
        reason: `Variant is extremely rare in population databases (${pm2Name} ${(ruleInputs.pm2Af * 100).toFixed(4)}% ≤ ${(ceiling.ceiling * 100).toFixed(2)}% app-defined threshold: ${ceiling.text})${fallbackSuffix}${combinedSuffix}. Applied at Supporting strength (ClinGen SVI 2020, PM2_Supporting).`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // BS2 — Observed in homozygous state in healthy population reference
  // -------------------------------------------------------------------------
  /**
   * Two or more gnomAD homozygotes, on an autosome, for a gene not curated as only X-linked, Y-linked
   * or mitochondrial (`homozygotesInformBs2`). On those, the homozygote count is not the genotype BS2
   * needs, and it used to be read anyway. BS2 also assumes full penetrance at an early age, which no
   * source here curates; the surfaces state that caveat.
   */
  const bs2Genotype = homozygotesInformBs2({ variantId: predictorData?.gnomadVariantId ?? null, inheritance: curatedInheritance });
  if (
    gnomadFrequency &&
    gnomadFrequency.nHomozygous !== null &&
    gnomadFrequency.nHomozygous !== undefined &&
    gnomadFrequency.nHomozygous >= 2 &&
    !skipBenignComp
  ) {
    if (bs2Genotype.applies) {
      // The count is a reading, not BS2: gnomAD does not phenotype its participants (BS2_COUNTED_AUTOMATICALLY).
      if (!unavailable.some(u => u.startsWith("BS2"))) {
        unavailable.push(`BS2 (not applied: ${BS2_NOT_APPLIED_REASON}; ${gnomadFrequency.nHomozygous} homozygotes observed)`);
      }
    } else if (!unavailable.some(u => u.startsWith("BS2"))) {
      unavailable.push(`BS2 (homozygote count not applied: ${bs2Genotype.reason})`);
    }
  }

  // -------------------------------------------------------------------------
  // PM1 — Mutational hotspot and/or critical and well-established functional domain
  // -------------------------------------------------------------------------
  /**
   * The rule lives in `src/shared/functionalSites.ts` (`assessPm1`), which the Functional domains tab
   * reads too. PM1 is capped with PP3 so the two together do not exceed Strong (Pejaver et al. 2022):
   * when the primary calibrated predictor emits PP3_Strong (4 points), PM1 (2 points) is withheld
   * (`withheld-cap`) and recorded in `unavailable`.
   */
  if (uniprotFeatures?.features && !skipPathogenicComp) {
    const pos = residuePos();
    if (pos !== null) {
      const pp3Code = criteria.find((c) => c.code.startsWith("PP3"))?.code ?? null;
      const pm1 = assessPm1(uniprotFeatures.features as any[], pos, { pp3Code });
      if (pm1.status === "met") {
        criteria.push({ code: "PM1", reason: pm1.reason });
      } else if (pm1.status === "withheld-cap" && !unavailable.includes(`PM1 (withheld: ${pm1.reason})`)) {
        unavailable.push(`PM1 (withheld: ${pm1.reason})`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. PP2 — Missense constraint (ACMG-6: live gnomAD constraint preferred)
  // -------------------------------------------------------------------------
  // Calibrated regional rule (Chao et al. v3, calibration.ts): the O/E of the gnomAD v4.1.1 missense
  // constraint region containing the variant. It replaced gene Z ≥ 3.09 AND o/e < 0.6, which was never
  // calibrated as PP2 evidence. No verified locus or interval, no PP2: gene Z is not a substitute.
  const pp2Code = gnomadConstraint?.pp2Code ?? null;
  const region = gnomadConstraint?.regionalConstraint;
  if (pp2Code && region && typeof region.oeRatio === "number" && !skipPathogenicComp) {
    const edge = pp2Code === "PP2_Moderate" ? REGIONAL_MISSENSE_CALIBRATION.pp2.Moderate : REGIONAL_MISSENSE_CALIBRATION.pp2.Supporting;
    criteria.push({
      code: pp2Code,
      reason:
        `Missense variant in a gnomAD v${gnomadConstraint?.regionalRelease ?? "4.1.1"} missense constraint region of ${gene} ` +
        `with observed/expected ${region.oeRatio.toFixed(2)} (${region.regionText ?? "interval"}), at or below ${edge}: ` +
        `${pp2Code === "PP2_Moderate" ? "Moderate" : "Supporting"} under ${REGIONAL_MISSENSE_SOURCE.short}'s ClinGen calibration.`,
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
    const pos = residuePos();
    const isRepeat = pos !== null && sequence ? isIndelInRepeatRegion(sequence, pos) : false;
    
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

  if (pvs1Unavailable && !unavailable.includes(pvs1Unavailable)) {
    unavailable.push(pvs1Unavailable);
  }

  return {
    criteria,
    available,
    unavailable
  };
}
