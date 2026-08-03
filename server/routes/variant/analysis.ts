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
  filterPII,
  getApiKeyFromSession,
  formatZodError,
} from "../../utils.ts";
import { analyzeVariantLimiter } from "../../middleware.ts";
import {
  fetchClinVarData,
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
} from "../../services/external.ts";
import { isLocalDbnsfpAvailable } from "../../services/dbnsfp_local.ts";
import { queryGenosWebservice } from "../../services/genos_web.ts";
import { fetchEsm3StructureEval } from "../../services/esm3_forge.ts";
import { AMINO_ACID_3_TO_1 } from "../../../src/aminoAcids.ts";
import { type DisruptionPrediction, predictStructuralDisruption, runEsm2Eval, generateMutantPdb, biophysicalSemaphore } from "../../services/biophysics.ts";
import { computeRuleBasedACMG } from "../../services/acmg.ts";
import { runEsmcAnalysis } from "../../services/esmc.ts";
import { runEsm2Analysis } from "../../services/esm2.ts";
import { runSaprotAnalysis } from "../../services/saprot.ts";
import { activeBackgroundTasks, inFlightPrewarms } from "../state.ts";
import { generateAltVariants } from "../shared.ts";

const analyzeVariantSchema = z.object({
  gene: z.string(),
  variant: z.string(),
  uniprotId: z.string(),
  acmgWeighting: z.enum(["standard", "conservative", "strict-structural"]).optional(),
});

export function registerAnalysisRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/analyze-variant", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
    const parseResult = analyzeVariantSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
      const xBiohubToken = req.headers["x-biohub-token"];
      const xTamarindApiKey = req.headers["x-tamarind-api-key"];
      const xHfToken = req.headers["x-hf-token"];
      console.log("[Headers Debug] x-gemini-session-id:", !!customSessionId, "x-biohub-token:", !!xBiohubToken, "x-tamarind-api-key:", !!xTamarindApiKey, "x-hf-token:", !!xHfToken, "x-hf-token-length:", xHfToken ? (xHfToken as string).length : 0);

      if (customSessionId) {
        const customApiKey = getApiKeyFromSession(customSessionId);
        if (!customApiKey) {
          sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
          return;
        }
      }

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
          userDirections = filterPII(req.body.userDirections.slice(0, 1000));
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

      const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
      let residueIndex = "";
      let wildType = "";
      let mutant = "";
      if (mutMatch) {
        wildType = mutMatch[1];
        residueIndex = mutMatch[2];
        mutant = mutMatch[3];

        if (wildType.length === 3) {
          wildType = wildType.charAt(0).toUpperCase() + wildType.slice(1).toLowerCase();
        }
        if (mutant.length === 3) {
          mutant = mutant.charAt(0).toUpperCase() + mutant.slice(1).toLowerCase();
        }
      }

      let sequence: string;
      try {
        sequence = await fetchUniprotSequence(uniprotId);
      } catch (seqErr: any) {
        sendError(res, 502, "BAD_GATEWAY", `Failed to retrieve protein sequence from UniProt: ${seqErr.message}`);
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
      let esm2Eval = null;
      let saprotEval = null;

      let resolvedPdbId: string | null = null;
      let resolvedPdbSource: string = "AlphaFold";
      let pdbMapping: { pdbId: string; chainId: string; shift: number; unpStart: number; structStart: number } | null = null;

      try {
        const predictorPromise = fetchPredictorData(gene, variant);

        const pdbMappingPromise = fetchBestPdbStructure(uniprotId, pos).catch(err => {
          console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
          return null;
        });

        const clinvarPromise = fetchClinVarData(gene, variant, originalNotation).catch(err => {
          console.warn("[ClinVar Parallel Run Warning] Failed to fetch ClinVar data:", err);
          return null;
        });
        const stringPromise = fetchStringInteractions(gene);

        const coreTimeout = new Promise(resolve => setTimeout(() => resolve(null), 20000));
        const fastClinvarPromise = Promise.race([clinvarPromise, coreTimeout]);
        const fastPredictorPromise = Promise.race([predictorPromise, coreTimeout]);
        const fastStringPromise = Promise.race([stringPromise, coreTimeout]);

        clinvarPromise.catch(() => {});
        predictorPromise.catch(() => {});
        stringPromise.catch(() => {});

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

        const gnomadFrequencyPromise = localFreqsPromise.then(localFreqs => {
          if (localFreqs && localFreqs.gnomad) return localFreqs.gnomad;
          return predictorPromise.then(pred => {
            return fetchGnomadVariantFrequency(pred?.gnomadVariantId || null);
          });
        });

        const conservationPromise = Promise.all([pdbMappingPromise, predictorPromise, genosPromise]).then(([pdbMap, pred, genosRec]) => {
          return fetchConservationData(gene, variant, pdbMap?.pdbId, pdbMap?.chainId, pos, pred?.gnomadVariantId || null, genosRec, uniprotId);
        });

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
          return { level: "low", reason: "Fallback: PDB structure mapping not resolved", plddt: null };
        });

        const biohubToken = (req.headers["x-biohub-token"] as string) || process.env.BIOHUB_API_TOKEN || null;

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

        const hfToken = (req.headers["x-hf-token"] as string) || process.env.HF_TOKEN || null;

        const esm2EvalPromise = runEsm2Analysis(
          gene,
          variant,
          uniprotId,
          sequence,
          hfToken
        ).catch(err => {
          console.warn("[ESM2 3B Parallel Run Warning] Failed to run ESM-2 3B analysis:", err);
          return null;
        });

        const saprotEvalPromise = pdbMappingPromise.then(async (pdbMap) => {
          let pdbText: string | null = null;
          if (pdbMap) {
            try {
              pdbText = await fetchPdbFromRcsb(pdbMap.pdbId, pdbMap.chainId, pdbMap.unpStart, pdbMap.structStart);
            } catch (pdbFetchErr: any) {
              console.warn(`[SaProt PDB Fetch] Failed to fetch PDB text for ${pdbMap.pdbId}:`, pdbFetchErr.message);
            }
          }
          if (!pdbText) {
            try {
              pdbText = await fetchAlphafoldPdb(uniprotId);
            } catch (afFetchErr: any) {
              console.warn(`[SaProt AF2 PDB Fetch] Failed to fetch AF2 PDB text for ${uniprotId}:`, afFetchErr.message);
            }
          }
          return runSaprotAnalysis(
            gene,
            variant,
            uniprotId,
            sequence,
            hfToken,
            pdbText
          );
        }).catch(err => {
          console.warn("[SaProt Parallel Run Warning] Failed to run SaProt analysis:", err);
          return null;
        });

        const disruptionTimeout = new Promise(resolve => setTimeout(() => resolve({ level: "low", reason: "Async structural triage active", plddt: null }), 500));
        const fastDisruptionPromise = Promise.race([disruptionPromise, disruptionTimeout]);

        const sidecarTimeout = new Promise(resolve => setTimeout(() => resolve(null), 2500));
        const fastEsm3Promise = Promise.race([esm3EvalPromise, sidecarTimeout]);
        const deepModelTimeout = new Promise(resolve => setTimeout(() => resolve(null), 130000));
        const fastEsmcPromise = Promise.race([esmcEvalPromise, deepModelTimeout]);
        const fastEsm2Promise = Promise.race([esm2EvalPromise, deepModelTimeout]);
        const fastSaprotPromise = Promise.race([saprotEvalPromise, deepModelTimeout]);

        disruptionPromise.catch(() => {});
        esm3EvalPromise.catch(() => {});
        esmcEvalPromise.catch(() => {});
        esm2EvalPromise.catch(() => {});
        saprotEvalPromise.catch(() => {});

        const fastConservationPromise = Promise.race([conservationPromise, coreTimeout]);
        const fastGnomadFrequencyPromise = Promise.race([gnomadFrequencyPromise, coreTimeout]);
        const fastGnomadConstraintPromise = Promise.race([gnomadConstraintPromise, coreTimeout]);
        const fastUniprotFeaturesPromise = Promise.race([uniprotFeaturesPromise, coreTimeout]);
        const fastLandscapePromise = Promise.race([landscapePromise, coreTimeout]);
        const fastLocalFreqsPromise = Promise.race([localFreqsPromise, coreTimeout]);
        const fastPdbMappingPromise = Promise.race([pdbMappingPromise, coreTimeout]);

        conservationPromise.catch(() => {});
        gnomadFrequencyPromise.catch(() => {});
        gnomadConstraintPromise.catch(() => {});
        uniprotFeaturesPromise.catch(() => {});
        landscapePromise.catch(() => {});
        localFreqsPromise.catch(() => {});
        pdbMappingPromise.catch(() => {});

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
          esmcEvalRes,
          esm2EvalRes,
          saprotEvalRes
        ] = await Promise.all([
          fastClinvarPromise,
          fastConservationPromise,
          fastStringPromise,
          fastGnomadFrequencyPromise,
          fastDisruptionPromise,
          esm2Promise,
          fastLandscapePromise,
          fastPredictorPromise,
          fastPdbMappingPromise,
          fastGnomadConstraintPromise,
          fastUniprotFeaturesPromise,
          fastLocalFreqsPromise,
          fastEsm3Promise,
          fastEsmcPromise,
          fastEsm2Promise,
          fastSaprotPromise
        ]) as any[];

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
        esm2Eval = esm2EvalRes;
        saprotEval = saprotEvalRes;

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

      const gnomadConstraintData = gnomadConstraint as any;

      const ruleBasedInsights = computeRuleBasedACMG(
        gene, variant, clinvar, predictorData, conservationData, gnomadConstraintData, gnomadFrequency, acmgWeighting, esm2, uniprotFeatures, sequence, esmcEval, esm2Eval, saprotEval
      );

      if (process.env.NODE_ENV !== "test") {
        const prewarmKey = `${gene}_${variant}`.toUpperCase();
        if (await inFlightPrewarms.has(prewarmKey)) {
          console.log(`[Pre-warm Cache] FoldX pre-warm already in-flight for ${gene} ${variant}, skipping duplicate.`);
        } else {
          await inFlightPrewarms.add(prewarmKey);
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

                  let acquired = false;
                  try {
                    await biophysicalSemaphore.acquire();
                    acquired = true;
                    console.log(`[Pre-warm Cache] Silently launching FoldX mutant simulation in background for ${gene} ${variant}`);
                    await generateMutantPdb(wtPdbText, mutation, uniprotId, prewarmJobDir, prewarmController.signal);
                    console.log(`[Pre-warm Cache] FoldX simulation completed and cached for ${gene} ${variant}`);
                  } finally {
                    if (acquired) {
                      biophysicalSemaphore.release();
                    }
                  }
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
              await inFlightPrewarms.delete(prewarmKey);
              const idx = activeBackgroundTasks.findIndex(t => t.id === prewarmTaskId);
              if (idx !== -1) {
                activeBackgroundTasks.splice(idx, 1);
              }
            }
          })();
          activeBackgroundTasks.push({ id: prewarmTaskId, controller: prewarmController, promise: prewarmPromise });
        }
      }

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
        esm2Eval: esm2Eval ?? null,
        saprotEval: saprotEval ?? null,
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
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "An error occurred during variant analysis.");
    }
  });
}
