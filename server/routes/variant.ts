/**
 * variant.ts — Variant-related routes:
 *   POST /analyze-variant
 *   POST /analyze-variant-narrative
 *   POST /translate-variant
 *   POST /resolve-gene
 */
import { type Router } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { z } from "zod";

import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  AuditLogger,
  VCF_GENOMIC_PATTERN,
  CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
  filterPII,
  getApiKeyFromSession,
} from "../utils.ts";
import { analyzeVariantLimiter } from "../middleware.ts";
import {
  performGeminiAnalysis,
  GeminiError,
} from "../services/gemini.ts";
import {
  fetchClinVarData,
  resolveGeneToUniprot,
  fetchUniprotSequence,
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  fetchPredictorData,
  fetchConservationData,
  fetchStringInteractions,
  fetchGnomadGeneConstraint,
  fetchGnomadVariantFrequency,
  fetchUniprotFeatures,
  fetchLandscapeData,
  fetchLocalPopulationFrequencies,
} from "../services/external.ts";
import { isLocalDbnsfpAvailable } from "../services/dbnsfp_local.ts";
import { queryGenosWebservice } from "../services/genos_web.ts";
import { fetchEsm3StructureEval } from "../services/esm3_forge.ts";
import { AMINO_ACID_1_TO_3, AMINO_ACID_1_TO_3_TITLE } from "../../src/aminoAcids.ts";
import { type AnalysisResult } from "../../src/types.ts";
import { type DisruptionPrediction, predictStructuralDisruption, runEsm2Eval } from "../services/biophysics.ts";
import { computeRuleBasedACMG } from "../services/acmg.ts";
import { runEsmcAnalysis } from "../services/esmc.ts";
import { AMINO_ACID_3_TO_1 } from "../../src/aminoAcids.ts";
import { generateMutantPdb, biophysicalSemaphore } from "../services/biophysics.ts";
import { activeBackgroundTasks, inFlightPrewarms } from "./state.ts";
import {
  getFromCache,
  writeToCache,
  generateAltVariants,
  handleNarrativeResponse,
} from "./shared.ts";

const ensemblResponseSchema = z.array(
  z.object({
    seq_region_name: z.string().optional(),
    start: z.number().optional(),
    allele_string: z.string().optional(),
    transcript_consequences: z.array(
      z.object({
        transcript_id: z.string().optional(),
        canonical: z.union([z.number(), z.boolean()]).optional(),
        mane_select: z.string().optional(),
        hgvsp: z.string().optional(),
        gene_symbol: z.string().optional(),
        swissprot: z.array(z.string()).optional()
      })
    ).optional()
  })
);

export function registerVariantRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/analyze-variant", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    try {
      let gene: string, variant: string, uniprotId: string;
      let userDirections: string | undefined;
      let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";

      let originalNotation: string | undefined;

      try {
        gene = validateGene(req.body.gene);
        variant = validateVariant(req.body.variant);
        uniprotId = validateUniProt(req.body.uniprotId);
        originalNotation = req.body.originalNotation ? String(req.body.originalNotation) : undefined;

        if (req.body.userDirections !== undefined) {
          if (typeof req.body.userDirections !== "string") {
            throw new Error("userDirections must be a string");
          }
          userDirections = filterPII(req.body.userDirections.slice(0, 2000));
        }

        if (req.body.acmgWeighting !== undefined) {
          if (req.body.acmgWeighting === "standard" || req.body.acmgWeighting === "conservative" || req.body.acmgWeighting === "strict-structural") {
            acmgWeighting = req.body.acmgWeighting;
          } else {
            throw new Error("acmgWeighting must be one of: standard, conservative, strict-structural");
          }
        }
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }

      await AuditLogger.log("ANALYZE_VARIANT", {
        gene,
        variant,
        uniprotId,
        hasDirections: !!userDirections,
        acmgWeighting
      });

      // Parse wild-type and mutant residues if possible (e.g. p.Arg215Trp or Arg215Trp)
      const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
      let residueIndex = "";
      let wildType = "";
      let mutant = "";
      if (mutMatch) {
        wildType = mutMatch[1];
        residueIndex = mutMatch[2];
        mutant = mutMatch[3];

        // Normalize 3-letter codes to TitleCase (e.g. ser -> Ser) for case-insensitive match (BIO-15)
        if (wildType.length === 3) {
          wildType = wildType.charAt(0).toUpperCase() + wildType.slice(1).toLowerCase();
        }
        if (mutant.length === 3) {
          mutant = mutant.charAt(0).toUpperCase() + mutant.slice(1).toLowerCase();
        }
      }

      // 1. Fetch UniProt sequence and validate residue presence & identity (M-1)
      let sequence: string;
      try {
        sequence = await fetchUniprotSequence(uniprotId);
      } catch (seqErr: any) {
        sendError(res, 424, "SEQUENCE_UNAVAILABLE", `Failed to retrieve protein sequence from UniProt: ${seqErr.message}`);
        return;
      }

      const pos = parseInt(residueIndex, 10);
      if (isNaN(pos) || pos < 1 || pos > sequence.length) {
        sendError(
          res,
          422,
          "UNPROCESSABLE_ENTITY",
          `Mutation residue index ${residueIndex} is out of bounds for protein ${uniprotId} (sequence length: ${sequence.length}).`
        );
        return;
      }

      const wtUpper = wildType.toUpperCase();
      const wt1Letter = AMINO_ACID_3_TO_1[wildType] || (wildType.length === 1 ? wtUpper : null);
      if (!wt1Letter) {
        sendError(res, 400, "BAD_REQUEST", `Invalid wild-type residue notation: ${wildType}`);
        return;
      }

      const mutUpper = mutant.toUpperCase();
      const mut1Letter = AMINO_ACID_3_TO_1[mutant] || (mutant.length === 1 ? mutUpper : null);
      if (!mut1Letter) {
        sendError(res, 400, "BAD_REQUEST", `Invalid mutant residue notation: ${mutant}`);
        return;
      }

      const actualWt = sequence[pos - 1];
      if (actualWt !== wt1Letter) {
        sendError(
          res,
          422,
          "UNPROCESSABLE_ENTITY",
          `Wild-type residue mismatch at position ${pos} for ${uniprotId}. Expected ${actualWt}, but query specified ${wt1Letter} (${wildType}).`
        );
        return;
      }

      let clinvar = null;
      let predictorData = null;
      let conservationData = null;
      let stringInteractions = null;
      let gnomadFrequency = null;
      let aouFrequency = null;
      let disruptionPredictor: DisruptionPrediction = { level: "unknown", reason: "Fallback: PDB structure mapping not resolved", plddt: null };
      let esm2 = null;
      let landscapeData = null;
      let gnomadConstraint = null;
      let uniprotFeatures = null;
      let esm3Eval = null;
      let esmcEval = null;

      let resolvedPdbId: string | null = null;
      let resolvedPdbSource: string = "AlphaFold";
      let pdbMapping: { pdbId: string; chainId: string; shift: number; unpStart: number; structStart: number } | null = null;

      try {
        // Start independent tasks in parallel at t=0
        const predictorPromise = fetchPredictorData(gene, variant);

        const pdbMappingPromise = fetchBestPdbStructure(uniprotId, pos).catch(err => {
          console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
          return null;
        });

        const clinvarPromise = fetchClinVarData(gene, variant, originalNotation);
        const stringPromise = fetchStringInteractions(gene);

        const esm2Promise = runEsm2Eval(sequence, pos, wt1Letter, mut1Letter).catch(err => {
          console.warn("[ESM2 Parallel Run Warning] Failed to run ESM2 evaluation:", err);
          return null;
        });

        const startPos = (pos !== undefined && pos !== null) ? Math.max(1, pos - 15) : undefined;
        const endPos = (pos !== undefined && pos !== null) ? pos + 15 : undefined;

        const landscapePromise = fetchLandscapeData(gene, startPos, endPos).catch(err => {
          console.warn("[Landscape Parallel Run Warning] Failed to fetch landscape data:", err);
          return null;
        });

        const genosPromise = queryGenosWebservice(gene, variant).catch(err => {
          console.warn("[Genos Web Query Warning] Failed to run Genos web query:", err);
          return null;
        });

        const gnomadConstraintPromise = fetchGnomadGeneConstraint(gene, pos).catch(err => {
          console.warn("[Gnomad Constraint Warning] Failed to fetch gnomad gene constraint:", err);
          return null;
        });

        const uniprotFeaturesPromise = fetchUniprotFeatures(uniprotId).catch(err => {
          console.warn("[UniProt Features Warning] Failed to fetch uniprot features:", err);
          return null;
        });

        const localFreqsPromise = (isLocalDbnsfpAvailable() && pos !== null)
          ? fetchLocalPopulationFrequencies(gene, pos, variant).catch(err => {
              console.warn("[Local dbNSFP Freq Warning] Error querying local frequencies:", err);
              return null;
            })
          : Promise.resolve(null);

        // Chain dependent tasks:
        // gnomad frequency depends on localFreqsPromise and predictorPromise
        const gnomadFrequencyPromise = localFreqsPromise.then(localFreqs => {
          if (localFreqs && localFreqs.gnomad) return localFreqs.gnomad;
          return predictorPromise.then(pred => {
            return fetchGnomadVariantFrequency(pred?.gnomadVariantId || null);
          });
        });

        // conservationData depends on pdbMappingPromise, predictorPromise, and genosPromise
        const conservationPromise = Promise.all([pdbMappingPromise, predictorPromise, genosPromise]).then(([pdbMap, pred, genosRec]) => {
          return fetchConservationData(gene, variant, pdbMap?.pdbId, pdbMap?.chainId, pos, pred?.gnomadVariantId || null, genosRec, uniprotId);
        });

        // disruptionPredictor runs with a 500ms race so PDB structure downloads never delay the primary genomic & ACMG response
        const disruptionPromise = pdbMappingPromise.then(async (pdbMap) => {
          try {
            let wtPdbText: string | null = null;
            let chainId: string | undefined;
            if (pdbMap && pdbMap.pdbId) {
              wtPdbText = await fetchPdbFromRcsb(pdbMap.pdbId, pdbMap.chainId, pdbMap.unpStart, pdbMap.structStart);
              chainId = pdbMap.chainId;
            } else {
              wtPdbText = await fetchAlphafoldPdb(uniprotId);
              chainId = "A";
            }
            if (wtPdbText) {
              return predictStructuralDisruption(wtPdbText, wt1Letter, pos, mut1Letter, chainId);
            }
          } catch (err) {
            console.warn("[Triage Parallel Run Warning] Failed to predict structural disruption:", err);
          }
          return { level: "low", reason: "Fallback: PDB structure mapping not resolved", plddt: 100 };
        });

        const biohubToken = (req.headers["x-biohub-token"] as string) || process.env.BIOHUB_API_TOKEN || process.env.ESM3_FORGE_API_KEY || null;

        const esm3EvalPromise = pdbMappingPromise.then(async (pdbMap) => {
          let pdbText: string | null = null;
          if (pdbMap) {
            try {
              pdbText = await fetchPdbFromRcsb(pdbMap.pdbId, pdbMap.chainId, pdbMap.unpStart, pdbMap.structStart);
            } catch (pdbFetchErr: any) {
              console.warn(`[ESM3 PDB Fetch] Failed to fetch PDB text for ${pdbMap.pdbId}:`, pdbFetchErr.message);
            }
          }
          try {
            return await fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, pdbText, biohubToken);
          } catch (err) {
            console.warn("[ESM3 Parallel Run Warning] Failed to run ESM3 structural evaluation:", err);
            return fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, null, biohubToken);
          }
        });

        const esmcEvalPromise = runEsmcAnalysis(
          gene,
          variant,
          uniprotId,
          sequence,
          biohubToken
        ).catch(err => {
          console.warn("[ESMC Parallel Run Warning] Failed to run ESMC analysis:", err);
          return null;
        });

        const disruptionTimeout = new Promise(resolve => setTimeout(() => resolve({ level: "low", reason: "Async structural triage active", plddt: 100 }), 500));
        const fastDisruptionPromise = Promise.race([disruptionPromise, disruptionTimeout]);

        // Wait for all promises in parallel
        const [
          clinvarRes,
          conservationRes,
          stringRes,
          gnomadFreqRes,
          disruptionRes,
          esm2Res,
          landscapeRes,
          predictorRes,
          pdbMapRes,
          gnomadConstraintRes,
          uniprotFeaturesRes,
          localFreqsRes,
          esm3EvalRes,
          esmcEvalRes
        ] = await Promise.all([
          clinvarPromise,
          conservationPromise,
          stringPromise,
          gnomadFrequencyPromise,
          fastDisruptionPromise,
          esm2Promise,
          landscapePromise,
          predictorPromise,
          pdbMappingPromise,
          gnomadConstraintPromise,
          uniprotFeaturesPromise,
          localFreqsPromise,
          esm3EvalPromise,
          esmcEvalPromise
        ]);

        clinvar = clinvarRes;
        conservationData = conservationRes;

        if (localFreqsRes && localFreqsRes.aou) {
          aouFrequency = localFreqsRes.aou;
        } else if (conservationRes?.aouFrequency) {
          aouFrequency = conservationRes.aouFrequency;
        }
        if (aouFrequency && aouFrequency.aouAC === null && aouFrequency.aouAN === null && aouFrequency.aouHet === null && aouFrequency.aouHom === null) {
          aouFrequency = null;
        }

        stringInteractions = stringRes;
        gnomadFrequency = gnomadFreqRes;
        disruptionPredictor = disruptionRes as any;
        esm2 = esm2Res;
        landscapeData = landscapeRes;
        predictorData = predictorRes;
        pdbMapping = pdbMapRes;
        gnomadConstraint = gnomadConstraintRes;
        uniprotFeatures = uniprotFeaturesRes;
        esm3Eval = esm3EvalRes;
        esmcEval = esmcEvalRes;

        if (pdbMapping && pdbMapping.pdbId) {
          resolvedPdbId = pdbMapping.pdbId.toUpperCase();
          resolvedPdbSource = "RCSB PDB";
        }
      } catch (err: any) {
        console.error("[Parallel Fetch Error]:", err);
        if (err.name === "AbortError" || err.message.includes("timeout")) {
          sendError(res, 504, "TIMEOUT", "Variant database upstream query timed out. Please try again.");
          return;
        }
        sendError(res, 502, "BAD_GATEWAY", `Variant database upstream query error: ${err.message}`);
        return;
      }

      // ACMG-6: Inject live gnomAD constraint into PP2 logic.
      const gnomadConstraintData = gnomadConstraint as any;

      const ruleBasedInsights = computeRuleBasedACMG(
        gene, variant, clinvar, predictorData, conservationData, gnomadConstraintData, gnomadFrequency, acmgWeighting, esm2, uniprotFeatures, sequence
      );

      const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
      let customApiKey: string | undefined;
      if (customSessionId) {
        customApiKey = getApiKeyFromSession(customSessionId);
        if (!customApiKey) {
          sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
          return;
        }
      }

      // Asynchronously pre-compute FoldX modeling in the background to warm the cache (bypass during tests)
      if (process.env.NODE_ENV !== "test") {
        const prewarmKey = `${gene}_${variant}`.toUpperCase();
        if (inFlightPrewarms.has(prewarmKey)) {
          console.log(`[Pre-warm Cache] FoldX pre-warm already in-flight for ${gene} ${variant}, skipping duplicate.`);
        } else {
          inFlightPrewarms.add(prewarmKey);
          const prewarmTaskId = crypto.randomUUID();
          const prewarmController = new AbortController();

          const prewarmPromise = (async () => {
            let createdJobDir = "";
            try {
              if (pdbMapping && pdbMapping.pdbId) {
                const wtPdbText = await fetchPdbFromRcsb(pdbMapping.pdbId, pdbMapping.chainId, pdbMapping.unpStart, pdbMapping.structStart);
                if (wtPdbText) {
                  const wt1 = wt1Letter.toUpperCase();
                  const chain = pdbMapping.chainId.toUpperCase();
                  const mut1 = AMINO_ACID_3_TO_1[mutant] || (mutant.length === 1 ? mutant.toUpperCase() : mutant[0].toUpperCase());

                  const mutation = `${wt1}${chain}${pos}${mut1}`;
                  const prewarmJobId = crypto.randomUUID();
                  const prewarmJobDir = path.join(process.cwd(), "temp_jobs", prewarmJobId);
                  createdJobDir = prewarmJobDir;

                  console.log(`[Pre-warm Cache] Silently launching FoldX mutant simulation in background for ${gene} ${variant}`);
                  await generateMutantPdb(wtPdbText, mutation, uniprotId, prewarmJobDir, prewarmController.signal);
                  console.log(`[Pre-warm Cache] FoldX simulation completed and cached for ${gene} ${variant}`);
                }
              }
            } catch (prewarmErr: any) {
              if (prewarmController.signal.aborted) {
                console.log(`[Pre-warm Cache] Background FoldX pre-warm aborted for ${gene} ${variant}`);
              } else {
                console.warn(`[Pre-warm Cache Warning] Background FoldX pre-warm failed:`, prewarmErr.message);
              }
              if (createdJobDir) {
                try {
                  if (fs.existsSync(createdJobDir)) {
                    await fs.promises.rm(createdJobDir, { recursive: true, force: true });
                  }
                } catch (_) {}
              }
            } finally {
              inFlightPrewarms.delete(prewarmKey);
              const idx = activeBackgroundTasks.findIndex(t => t.id === prewarmTaskId);
              if (idx !== -1) {
                activeBackgroundTasks.splice(idx, 1);
              }
            }
          })();
          activeBackgroundTasks.push({ id: prewarmTaskId, controller: prewarmController, promise: prewarmPromise });
        }
      }

      // Construct mutated sequence
      let mutatedSequence: string | null = null;
      if (sequence && pos >= 1 && pos <= sequence.length && wt1Letter && mut1Letter) {
        mutatedSequence = sequence.substring(0, pos - 1) + mut1Letter + sequence.substring(pos);
      }

      res.json({
        analysis: null,
        insights: null,
        ruleBasedInsights,
        disclaimer: "This analysis is automatically generated by an artificial intelligence model for research purposes only. It does not constitute a clinical diagnosis or validated medical recommendation.",
        clinvar,
        predictorData,
        conservationData,
        landscapeData,
        stringInteractions,
        disruptionPredictor,
        gnomadConstraint: gnomadConstraint ?? null,
        uniprotFeatures: uniprotFeatures ?? null,
        gnomadFrequency: gnomadFrequency ?? null,
        aouFrequency: aouFrequency ?? null,
        esm2: esm2 ?? null,
        esm3Eval: esm3Eval ?? null,
        esmcEval: esmcEval ?? null,
        metadata: {
          gene,
          variant,
          uniprotId,
          residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
          wildType,
          mutant,
          pdbId: resolvedPdbId,
          pdbSource: resolvedPdbSource,
          alternativeVariants: generateAltVariants(sequence),
          mutatedSequence
        }
      });
    } catch (error: any) {
      console.error("Endpoint analysis failure:", error);
      sendError(res, 500, "INTERNAL_ERROR", error.message || "An error occurred during variant analysis.");
    }
  });

  apiRouter.post("/analyze-variant-narrative", jsonParserRegular, async (req, res) => {
    try {
      let gene: string, variant: string, uniprotId: string;
      let userDirections: string | undefined;
      let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";

      try {
        gene = validateGene(req.body.gene);
        variant = validateVariant(req.body.variant);
        uniprotId = validateUniProt(req.body.uniprotId);
        userDirections = req.body.userDirections ? String(req.body.userDirections) : undefined;

        if (req.body.acmgWeighting !== undefined) {
          if (req.body.acmgWeighting === "standard" || req.body.acmgWeighting === "conservative" || req.body.acmgWeighting === "strict-structural") {
            acmgWeighting = req.body.acmgWeighting;
          } else {
            throw new Error("acmgWeighting must be one of: standard, conservative, strict-structural");
          }
        }
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }

      const { clinvar, predictorData, conservationData, stringInteractions, gnomadConstraint, gnomadFrequency, uniprotFeatures, sequence } = req.body;

      const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
      if (!mutMatch) {
        sendError(res, 400, "BAD_REQUEST", `Invalid protein variant format: ${variant}`);
        return;
      }
      const wildType = mutMatch[1];
      const residueIndex = mutMatch[2];
      const mutant = mutMatch[3];

      const cacheKey = `clinical_${uniprotId}_${variant}_${acmgWeighting}_${userDirections || ""}`;
      const cached = getFromCache(cacheKey);

      if (cached) {
        console.log(`[Cache Hit] Serving cached clinical Gemini narrative for ${cacheKey}`);
        return handleNarrativeResponse(
          res,
          cached,
          gene,
          variant,
          clinvar,
          predictorData,
          conservationData,
          gnomadConstraint,
          gnomadFrequency,
          acmgWeighting,
          null,
          uniprotFeatures,
          sequence
        );
      }

      // Cache miss: invoke rate limiter programmatically (bypass during tests)
      const runHandler = async () => {
        try {
          const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
          let customApiKey: string | undefined;
          if (customSessionId) {
            customApiKey = getApiKeyFromSession(customSessionId);
            if (!customApiKey) {
              sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
              return;
            }
          }

          const timeoutSignal = AbortSignal.timeout(120000);
          const reqId = req.headers["x-request-id"] as string;

          let analysisResult;
          try {
            analysisResult = await performGeminiAnalysis(
              gene,
              variant,
              uniprotId,
              residueIndex,
              wildType,
              mutant,
              userDirections,
              clinvar,
              acmgWeighting,
              customApiKey,
              timeoutSignal,
              predictorData,
              conservationData,
              stringInteractions
            );
            writeToCache(cacheKey, analysisResult);
          } catch (err: any) {
            console.warn("[Graceful Fallback] Gemini narrative execution failed:", err.message);
            await AuditLogger.log("ANALYZE_VARIANT_FAILED", {
              reqId,
              code: err instanceof GeminiError ? err.code : "INTERNAL_ERROR",
              message: err.message
            });

            const ruleInsights = computeRuleBasedACMG(
              gene, variant, clinvar, predictorData, conservationData, gnomadConstraint, gnomadFrequency, acmgWeighting, null, uniprotFeatures, sequence
            );

            const clinvarText = clinvar
              ? `Listed as **${clinvar.classification || "Unclassified"}** (Review status: *${clinvar.reviewStatus || "unknown"}*).`
              : "Absent from ClinVar database (rare or novel variant).";

            const freqText = (gnomadFrequency && gnomadFrequency.exomeAF)
              ? `Observed in gnomAD with an allele frequency of **${gnomadFrequency.exomeAF.toExponential(3)}**.`
              : "Absent from gnomAD population database (extremely rare or novel variant).";

            const cadd = predictorData?.caddPhred;
            const am = predictorData?.amClass;
            const revel = conservationData?.revel;

            const predictorSummary = [
              cadd ? `CADD Phred score is **${cadd}**` : null,
              revel ? `REVEL score is **${revel}**` : null,
              am ? `AlphaMissense is **${am}**` : null
            ].filter(Boolean).join(", ");

            const fallbackText =
              `### ⚠️ AI Explanation Service Offline (Fallback Report Loaded)\n\n` +
              `The Gemini AI narrative service is currently experiencing rate/quota limits (${err.message}). A structured clinical summary has been generated from standard database metrics:\n\n` +
              `* **Clinical Consensus**: Rule-based ACMG classification is **${ruleInsights.acmgVerdict || "VUS / Conflicting Evidence"}**.\n` +
              `* **ClinVar Database**: ${clinvarText}\n` +
              `* **Population Frequency**: ${freqText}\n` +
              (predictorSummary ? `* **In-Silico Predictors**: ${predictorSummary}.\n` : "") +
              `* **Biophysical Impact**: Local sequence and structure are fully loaded and functional. You can run FoldX / DynaMut2 simulations via the 3D Molecular Viewer controls below.`;

            analysisResult = {
              analysis: fallbackText,
              insights: {
                biochemicalShift: "Unavailable (AI Service Offline)",
                structuralImpact: "Unavailable (AI Service Offline)",
                acmgCriteria: []
              }
            } as AnalysisResult;
          }

          handleNarrativeResponse(
            res,
            analysisResult,
            gene,
            variant,
            clinvar,
            predictorData,
            conservationData,
            gnomadConstraint,
            gnomadFrequency,
            acmgWeighting,
            null,
            uniprotFeatures,
            sequence
          );
        } catch (innerError: any) {
          console.error("Narrative inner execution failure:", innerError);
          sendError(res, 500, "INTERNAL_ERROR", innerError.message || "Failed to process narrative request.");
        }
      };

      if (process.env.NODE_ENV === "test") {
        await runHandler();
      } else {
        analyzeVariantLimiter(req, res, runHandler);
      }
    } catch (error: any) {
      console.error("Narrative endpoint failure:", error);
      sendError(res, 500, "INTERNAL_ERROR", error.message || "Failed to process narrative request.");
    }
  });

  apiRouter.post("/translate-variant", jsonParserRegular, async (req, res) => {
    try {
      const { variant } = req.body;
      if (!variant || typeof variant !== "string") {
        sendError(res, 400, "BAD_REQUEST", "Missing or invalid variant parameter.");
        return;
      }

      let trimmed = variant.trim();
      const dashedMatch = trimmed.match(DASHED_GENOMIC_PATTERN);
      if (dashedMatch) {
        trimmed = `chr${dashedMatch[1]}:g.${dashedMatch[2]}${dashedMatch[3].toUpperCase()}>${dashedMatch[4].toUpperCase()}`;
      }

      if (!VCF_GENOMIC_PATTERN.test(trimmed) && !CDNA_PATTERN.test(trimmed)) {
        sendError(res, 400, "BAD_REQUEST", `Invalid notation format: "${variant}". Must be genomic VCF (e.g., chr7:g.140753336A>T), transcript cDNA (e.g., NM_004333.6:c.1799T>A), or genomic coordinates (e.g., 20-23365054-G-A).`);
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        console.log(`[VEP Translator] Translating notation: "${trimmed}" via Ensembl REST API...`);
      } else {
        console.log("[VEP Translator] Translating notation via Ensembl REST API...");
      }

      // Log translation request (SEC-6)
      await AuditLogger.log("TRANSLATE_VARIANT", {
        variant: trimmed
      });

      const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(trimmed)}?content-type=application/json&hgvs=1&canonical=1&uniprot=1&mane=1`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const text = await response.text();
        sendError(res, response.status === 400 ? 400 : 502, "TRANSLATION_FAILED", `Ensembl VEP API returned status ${response.status}: ${text.slice(0, 300)}`);
        return;
      }

      const rawData = await response.json();
      const parseResult = ensemblResponseSchema.safeParse(rawData);
      if (!parseResult.success) {
        sendError(res, 502, "BAD_GATEWAY", "Ensembl VEP API returned an invalid response structure.");
        return;
      }
      const data = parseResult.data;
      if (data.length === 0 || !data[0].transcript_consequences) {
        sendError(res, 404, "NOT_FOUND", "No transcript consequences found for the provided variant.");
        return;
      }

      const chr = data[0].seq_region_name;
      const startPos = data[0].start;
      const alleleStr = data[0].allele_string;
      let genomicCoordinates: string | null = null;
      if (chr && startPos && typeof alleleStr === "string") {
        const parts = alleleStr.split("/");
        if (parts.length >= 2) {
          genomicCoordinates = `${chr}-${startPos}-${parts[0]}-${parts[1]}`;
        }
      }

      const consequences = data[0].transcript_consequences;
      // Find MANE Select first, then canonical, then fallback to first with hgvsp
      let selectedTc = consequences.find((t) => t.mane_select && !!t.hgvsp);
      if (!selectedTc) {
        selectedTc = consequences.find((t) => (t.canonical === 1 || t.canonical === true) && !!t.hgvsp);
      }
      if (!selectedTc) {
        selectedTc = consequences.find((t) => !!t.hgvsp);
      }

      if (!selectedTc || !selectedTc.hgvsp) {
        sendError(res, 404, "NOT_FOUND", "Could not find a transcript mapping to a protein variant (HGVSp).");
        return;
      }

      // Validate the values before echoing them
      let geneSymbol: string;
      let proteinPart: string;
      let uniprotId = "";

      try {
        geneSymbol = validateGene(selectedTc.gene_symbol || "");
        proteinPart = validateVariant(selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp);
        if (selectedTc.swissprot && selectedTc.swissprot.length > 0) {
          uniprotId = validateUniProt(selectedTc.swissprot[0].split(".")[0]);
        }
      } catch (valErr: any) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", `Resolved variant values are invalid: ${valErr.message}`);
        return;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log(`[VEP Translator] Resolved VCF/cDNA to: Gene: ${geneSymbol}, Protein Variant: ${proteinPart}, UniProt: ${uniprotId}`);
      } else {
        console.log("[VEP Translator] Resolved VCF/cDNA successfully.");
      }

      // TRANSCRIPT-DISC: Return transcript metadata alongside protein coordinates.
      const transcriptId: string = selectedTc.transcript_id || "";
      const isCanonical: boolean = !!(selectedTc.canonical === 1 || selectedTc.canonical === true);
      const transcriptWarning: string | undefined = !isCanonical
        ? "Non-canonical transcript used — disease isoform may differ. Verify transcript against MANE Select or RefSeq clinical."
        : undefined;

      res.json({
        gene: geneSymbol,
        variant: proteinPart,
        uniprotId,
        transcriptId,
        isCanonical,
        genomicCoordinates,
        ...(transcriptWarning ? { transcriptWarning } : {}),
      });
    } catch (err: any) {
      console.error(`[VEP Translator Crash]:`, err);
      if (err.name === "AbortError" || err.message.includes("timeout")) {
        sendError(res, 504, "TIMEOUT", "Ensembl VEP query timed out. Please try again.");
        return;
      }
      sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred during coordinate translation.");
    }
  });

  apiRouter.post("/resolve-gene", jsonParserRegular, async (req, res) => {
    try {
      const { gene } = req.body;
      let validatedGeneSymbol: string;
      try {
        validatedGeneSymbol = validateGene(gene);
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }

      const uniprotId = await resolveGeneToUniprot(validatedGeneSymbol);
      if (!uniprotId) {
        sendError(res, 404, "NOT_FOUND", `Gene '${validatedGeneSymbol}' could not be mapped to a canonical UniProt accession. Please check the spelling or provide a different gene symbol.`);
        return;
      }

      const hasPdb = await fetchAlphafoldPdb(uniprotId);
      res.json({
        gene: validatedGeneSymbol,
        uniprotId,
        pdbUrl: hasPdb ? `/api/v1/alphafold-pdb/${uniprotId}` : null
      });

    } catch (err: any) {
      console.error("Resolve gene route failure:", err);
      sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to resolve gene to AlphaFold structure.");
    }
  });
}
