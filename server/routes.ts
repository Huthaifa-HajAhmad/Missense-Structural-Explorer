import express from "express";
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
  MUTATION_FOLDX_PATTERN,
  filterPII,
  encryptSession,
  decryptSession,
  getApiKeyFromSession
} from "./utils.ts";

import {
  apiLimiter,
  authCheck,
  analyzeVariantLimiter
} from "./middleware.ts";

import {
  performGeminiAnalysis,
  GeminiError
} from "./services/gemini.ts";

import {
  fetchClinVarData,
  resolveGeneToUniprot,
  fetchUniprotSequence,
  fetchAlphafoldPdb,
  pdbCache,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  fetchPredictorData,
  fetchConservationData,
  fetchStringInteractions
} from "./services/external.ts";

import {
  biophysicalSemaphore,
  generateMutantPdb,
  calculateConsensusEnergetics,
  findBindingPocket,
  parseResiduesFromPdbMaybeAsync,
  getResidueDetails
} from "./services/biophysics.ts";

export const apiRouter = express.Router();

const jsonParserRegular = express.json({ limit: "1mb" });
const jsonParserPdb = express.json({ limit: "5mb" });

apiRouter.get("/health", (req, res) => {
  // foldxReady: check binary exists (no exec)
  const foldxBinEnv = process.env.FOLDX_BINARY || "";
  let foldxReady = false;
  if (foldxBinEnv) {
    foldxReady = fs.existsSync(foldxBinEnv);
  } else {
    try {
      const toolsDir = path.join(process.cwd(), "tools", "foldx");
      if (fs.existsSync(toolsDir)) {
        const files = fs.readdirSync(toolsDir);
        foldxReady = files.some(f => /^foldx.*\.exe$/i.test(f));
      }
    } catch { foldxReady = false; }
  }
  // geminiReady: key is set and not a placeholder
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const placeholders = ["YOUR_GEMINI_API_KEY", "CHANGE_ME", "MY_GEMINI_API_KEY", ""];
  const geminiReady = !!(geminiKey && !placeholders.some(p => geminiKey.includes(p)) && geminiKey.trim().length >= 10);

  res.json({ status: "ok", timestamp: new Date().toISOString(), foldxReady, geminiReady });
});

apiRouter.get("/version", (req, res) => {
  res.json({ version: "1.0.0", env: process.env.NODE_ENV || "development" });
});

// Apply authCheck and apiLimiter globally to the API Router
apiRouter.use(authCheck);
apiRouter.use(apiLimiter);

apiRouter.post("/analyze-variant", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
  try {
    let gene: string, variant: string, uniprotId: string;
    let userDirections: string | undefined;
    let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";

    try {
      gene = validateGene(req.body.gene);
      variant = validateVariant(req.body.variant);
      uniprotId = validateUniProt(req.body.uniprotId);
      
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
    }

    let clinvar = null;
    let predictorData = null;
    let conservationData = null;
    let stringInteractions = null;

    try {
      const results = await Promise.all([
        fetchClinVarData(gene, variant),
        fetchPredictorData(gene, variant),
        fetchConservationData(gene, variant),
        fetchStringInteractions(gene)
      ]);
      clinvar = results[0];
      predictorData = results[1];
      conservationData = results[2];
      stringInteractions = results[3];
    } catch (err: any) {
      console.error("[Parallel Fetch Error]:", err);
      if (err.name === "AbortError" || err.message.includes("timeout")) {
        sendError(res, 504, "TIMEOUT", "Variant database upstream query timed out. Please try again.");
        return;
      }
      sendError(res, 502, "BAD_GATEWAY", `Variant database upstream query error: ${err.message}`);
      return;
    }

    const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
    let customApiKey: string | undefined;
    if (customSessionId) {
      customApiKey = getApiKeyFromSession(customSessionId);
      if (!customApiKey) {
        sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
        return;
      }
    }
    
    if (process.env.NODE_ENV !== "production") {
      console.log(`Analyzing variant ${gene} ${variant} using gemini-3.5-flash (Markdown Narrative & JSON Insights in parallel)...`);
    } else {
      console.log("Analyzing variant using gemini-3.5-flash...");
    }
    
    const timeoutSignal = AbortSignal.timeout(120000); // 120 second timeout (Fix 4)
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
    } catch (err: any) {
      console.warn("Gemini client execution failed:", err.message);
      if (err instanceof GeminiError) {
        await AuditLogger.log("ANALYZE_VARIANT_FAILED", {
          reqId,
          code: err.code,
          message: err.message
        });
        sendError(res, err.status, err.code, err.message, { isConfigError: err.code === "API_KEY_INVALID" || err.code === "API_KEY_MISSING" });
      } else {
        await AuditLogger.log("ANALYZE_VARIANT_FAILED", {
          reqId,
          code: "INTERNAL_ERROR",
          message: err.message
        });
        sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred during Gemini analysis.");
      }
      return;
    }

    if (analysisResult.insights) {
      (analysisResult.insights as any).source = "ai_inference";
      (analysisResult.insights as any).model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
    }

    res.json({
      analysis: analysisResult.analysis,
      insights: analysisResult.insights,
      disclaimer: "This analysis is automatically generated by an artificial intelligence model for research purposes only. It does not constitute a clinical diagnosis or validated medical recommendation.",
      authoritativeEvidence: {
        clinvar,
        predictorData,
        conservationData,
        stringInteractions
      },
      clinvar, // Real ClinVar & gnomAD data (S-1)
      predictorData,
      conservationData,
      stringInteractions,
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
        wildType,
        mutant
      }
    });
  } catch (error: any) {
    console.error("Endpoint analysis failure:", error);
    sendError(res, 500, "INTERNAL_ERROR", error.message || "An error occurred during variant analysis.");
  }
});

apiRouter.post("/generate-mutant", jsonParserPdb, async (req, res) => {
  try {
    const { wtPdb, mutation, uniprotId } = req.body;

    if (!wtPdb || typeof wtPdb !== "string" || (!wtPdb.includes("ATOM") && !wtPdb.includes("HETATM"))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
      return;
    }
    if (wtPdb.length > 5 * 1024 * 1024) {
      sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
      return;
    }
    if (!mutation || typeof mutation !== "string" || !MUTATION_FOLDX_PATTERN.test(mutation.trim())) {
      sendError(res, 400, "BAD_REQUEST", "Invalid mutation code: must match FoldX format (e.g., RA215W).");
      return;
    }

    const mutTrimmed = mutation.trim();
    const wtLetter = mutTrimmed[0].toUpperCase();
    const mutLetter = mutTrimmed[mutTrimmed.length - 1].toUpperCase();
    if (wtLetter === mutLetter) {
      sendError(res, 400, "BAD_REQUEST", "Synonymous mutation detected: WT and mutant residues are identical.");
      return;
    }

    let acquired = false;
    try {
      await biophysicalSemaphore.acquire();
      acquired = true;
    } catch (semErr: any) {
      sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Please try again later.");
      return;
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

    async function cleanupFiles() {
      try {
        if (fs.existsSync(jobDir)) {
          await fs.promises.rm(jobDir, { recursive: true, force: true });
          console.log(`[Cleanup] Deleted temporary job directory: ${jobDir}`);
        }
      } catch (cleanupErr: any) {
        console.error(`[Cleanup Error] Job directory cleanup failed:`, cleanupErr.message);
      }
    }

    // foldxResult holds the core result from the semaphore-gated FoldX phase.
    // energetics is computed separately, outside the semaphore, to avoid
    // blocking concurrent FoldX jobs during DynaMut2 polling (~20 s max).
    let foldxResult: { pdb: string; ddG: number | null; status: string; foldedResidueIndex: number } | null = null;
    let routeError: any = null;

    try {
      await AuditLogger.log("GENERATE_MUTANT", {
        mutation: mutTrimmed
      });

      if (process.env.NODE_ENV !== "production") {
        console.log(`[Biophysical Modeling] Generating mutant structure for mutation configuration: ${mutTrimmed}`);
      } else {
        console.log("[Biophysical Modeling] Generating mutant structure...");
      }

      // Create job directory
      await fs.promises.mkdir(jobDir, { recursive: true });

      foldxResult = await generateMutantPdb(wtPdb, mutTrimmed, uniprotId, jobDir);

    } catch (err: any) {
      routeError = err;
    } finally {
      await cleanupFiles();
      if (acquired) {
        // Release semaphore here, before DynaMut2 polling, so other FoldX jobs
        // are not queued behind the ~20 s DynaMut2 network wait.
        biophysicalSemaphore.release();
        acquired = false;
      }
    }

    // Handle FoldX-phase errors with clean typed responses
    if (routeError) {
      console.error(`[Biophysical Server Route Crash] Route processing failed:`, routeError);
      const reqId = req.headers["x-request-id"] as string;
      await AuditLogger.log("GENERATE_MUTANT_FAILED", {
        reqId,
        message: routeError.message
      });
      if (routeError.message.includes("modeling engine unavailable")) {
        sendError(res, 503, "MODELING_UNAVAILABLE", routeError.message, { foldxReady: false });
      } else if (routeError.message.includes("not found in PDB") || routeError.message.includes("mismatch")) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", routeError.message);
      } else if (routeError.message.includes("Invalid FoldX file")) {
        sendError(res, 502, "BAD_GATEWAY", `FoldX biophysical calculation failed: ${routeError.message}`);
      } else {
        sendError(res, 500, "INTERNAL_ERROR", routeError.message || "Route exception encountered inside biophysical model processor.");
      }
      return;
    }

    if (!foldxResult) {
      sendError(res, 500, "INTERNAL_ERROR", "Biophysical model processor returned no result.");
      return;
    }

    // Semaphore is already released. Now compute DynaMut2 energetics without
    // blocking other FoldX jobs.
    const posNum = foldxResult.foldedResidueIndex;
    const energetics = await calculateConsensusEnergetics(
      foldxResult.ddG,
      wtLetter,
      mutLetter,
      posNum,
      wtPdb
    );

    res.json({ ...foldxResult, energetics });
  } catch (outerErr: any) {
    sendError(res, 500, "INTERNAL_ERROR", outerErr.message || "An unexpected error occurred.");
  }
});

const ensemblResponseSchema = z.array(
  z.object({
    transcript_consequences: z.array(
      z.object({
        canonical: z.union([z.number(), z.boolean()]).optional(),
        hgvsp: z.string().optional(),
        gene_symbol: z.string().optional(),
        swissprot: z.array(z.string()).optional()
      })
    ).optional()
  })
);

apiRouter.post("/translate-variant", jsonParserRegular, async (req, res) => {
  try {
    const { variant } = req.body;
    if (!variant || typeof variant !== "string") {
      sendError(res, 400, "BAD_REQUEST", "Missing or invalid variant parameter.");
      return;
    }

    const trimmed = variant.trim();
    if (!VCF_GENOMIC_PATTERN.test(trimmed) && !CDNA_PATTERN.test(trimmed)) {
      sendError(res, 400, "BAD_REQUEST", `Invalid notation format: "${trimmed}". Must be genomic VCF (e.g., chr7:g.140753336A>T) or transcript cDNA (e.g., NM_004333.6:c.1799T>A).`);
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

    const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(trimmed)}?content-type=application/json&hgvs=1&canonical=1&uniprot=1`;
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

    const consequences = data[0].transcript_consequences;
    // Find canonical transcript first
    let selectedTc = consequences.find((t) => t.canonical === 1 || t.canonical === true);
    // Fallback to first one with hgvsp
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

    res.json({
      gene: geneSymbol,
      variant: proteinPart,
      uniprotId
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

apiRouter.get("/sequence/:uniprotId", async (req, res) => {
  let validatedUniprot: string;
  try {
    validatedUniprot = validateUniProt(req.params.uniprotId);
  } catch (err: any) {
    sendError(res, 400, "BAD_REQUEST", err.message);
    return;
  }
  try {
    const sequence = await fetchUniprotSequence(validatedUniprot);
    res.json({ sequence });
  } catch (err: any) {
    console.warn(`[Sequence] Could not fetch UniProt sequence for ${validatedUniprot}: ${err.message}.`);
    const reqId = req.headers["x-request-id"] as string;
    await AuditLogger.log("SEQUENCE_FETCH_FAILED", {
      reqId,
      uniprotId: validatedUniprot,
      message: err.message
    });
    sendError(res, 424, "SEQUENCE_UNAVAILABLE", `Could not retrieve UniProt sequence for accession: ${validatedUniprot}. The UniProt REST API may be temporarily unavailable — please retry.`);
  }
});

apiRouter.post("/pocket-finder", jsonParserPdb, async (req, res) => {
  try {
    const { pdbText, targetIndex } = req.body;

    if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
      return;
    }
    if (pdbText.length > 5 * 1024 * 1024) {
      sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
      return;
    }

    const mutIndex = targetIndex !== undefined && targetIndex !== null ? Number(targetIndex) : null;
    if (mutIndex === null || isNaN(mutIndex) || mutIndex <= 0 || mutIndex > 99999) {
      sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex: must be a positive integer.");
      return;
    }

    let acquired = false;
    try {
      await biophysicalSemaphore.acquire();
      acquired = true;
    } catch (semErr: any) {
      sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Please try again later.");
      return;
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

    async function cleanupPocketFiles() {
      try {
        if (fs.existsSync(jobDir)) {
          await fs.promises.rm(jobDir, { recursive: true, force: true });
          console.log(`[Cleanup] Deleted temporary pocket job directory: ${jobDir}`);
        }
      } catch (cleanupErr: any) {
        console.error("[Pocket Cleanup Error] Cleanup failed:", cleanupErr.message);
      }
    }

    try {
      const result = await findBindingPocket(pdbText, mutIndex, jobDir);
      res.json(result);

    } catch (err: any) {
      console.error("Pocket finder route failure:", err);
      const reqId = req.headers["x-request-id"] as string;
      await AuditLogger.log("POCKET_FINDER_FAILED", {
        reqId,
        message: err.message
      });
      if (err.message.includes("out of range") || err.message.includes("not found")) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", err.message);
      } else {
        sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred during pocket finding.");
      }
    } finally {
      await cleanupPocketFiles();
      if (acquired) {
        biophysicalSemaphore.release();
      }
    }
  } catch (outerErr: any) {
    sendError(res, 500, "INTERNAL_ERROR", outerErr.message || "An unexpected error occurred.");
  }
});

apiRouter.post("/nearest-residues", jsonParserPdb, async (req, res) => {
  try {
    const { pdbText, targetIndex } = req.body;
    let n = req.body.n !== undefined ? Number(req.body.n) : 5;

    if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
      return;
    }
    if (pdbText.length > 5 * 1024 * 1024) {
      sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
      return;
    }
    if (targetIndex === undefined || targetIndex === null || isNaN(Number(targetIndex))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex: must be a number.");
      return;
    }
    const targetIndexNum = Number(targetIndex);

    if (isNaN(n) || n <= 0) {
      n = 5;
    }
    if (n > 20) {
      n = 20;
    }

    let acquired = false;
    try {
      await biophysicalSemaphore.acquire();
      acquired = true;
    } catch (semErr: any) {
      sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Please try again later.");
      return;
    }

    try {
      const residues = await parseResiduesFromPdbMaybeAsync(pdbText);
      const targetRes = residues.find(r => r.resSeq === targetIndexNum);
      if (!targetRes) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${targetIndexNum} is not found in the PDB structure.`);
        return;
      }

      if (targetRes.x === undefined || targetRes.y === undefined || targetRes.z === undefined) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", `Coordinates for target residue position ${targetIndexNum} could not be extracted.`);
        return;
      }

      const computedNeighbors: any[] = [];
      for (const r of residues) {
        if (r.resSeq === targetIndexNum) continue;
        if (r.x === undefined || r.y === undefined || r.z === undefined) continue;

        const dx = r.x - targetRes.x;
        const dy = r.y - targetRes.y;
        const dz = r.z - targetRes.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const details = getResidueDetails(r.resName3);
        computedNeighbors.push({
          index: r.resSeq,
          name: r.resName3,
          distance: parseFloat(dist.toFixed(2)),
          properties: details.properties,
          role: details.role,
          classBadge: details.classBadge
        });
      }

      computedNeighbors.sort((a, b) => a.distance - b.distance);
      const sliced = computedNeighbors.slice(0, n);

      res.json({
        residues: sliced,
        source: "computed"
      });
    } finally {
      if (acquired) {
        biophysicalSemaphore.release();
      }
    }
  } catch (err: any) {
    console.error("Nearest residues calculation failure:", err);
    sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred while computing nearest residues.");
  }
});

apiRouter.post("/session/keys", jsonParserRegular, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== "string") {
      sendError(res, 400, "BAD_REQUEST", "API key parameter is required.");
      return;
    }
    const cleanKey = apiKey.trim();
    if (cleanKey.length < 10 || cleanKey.length > 200 || !/^[a-zA-Z0-9_\-\.\+\=\/]+$/.test(cleanKey)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid API key format or length.");
      return;
    }
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour session
    const secret = process.env.APP_SESSION_SECRET || "dev-session-secret-must-be-changed-in-prod";
    const sessionId = encryptSession({ apiKey, expiresAt }, secret);
    
    res.json({ sessionId, expiresAt });
  } catch (err: any) {
    sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to create session.");
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

apiRouter.get("/alphafold-pdb/:uniprotId", async (req, res) => {
  let validatedUniprot: string;
  try {
    validatedUniprot = validateUniProt(req.params.uniprotId);
  } catch (err: any) {
    sendError(res, 400, "BAD_REQUEST", err.message);
    return;
  }
  
  // Parse optional query parameter `pos` for position coverage matching
  let pos: number | undefined;
  if (req.query.pos) {
    const parsedPos = parseInt(req.query.pos as string, 10);
    if (!isNaN(parsedPos)) {
      pos = parsedPos;
    }
  }

  // 1. Try experimental structures mapping first (PDB Prioritization)
  try {
    const pdbMapping = await fetchBestPdbStructure(validatedUniprot, pos);
    if (pdbMapping) {
      const { pdbId, chainId } = pdbMapping;
      const cacheKey = `pdb_rcsb_${pdbId}_chain_${chainId}`;
      
      if (pdbCache.has(cacheKey)) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[Cache Hit] Serving RCSB PDB for ${pdbId} chain ${chainId} from memory cache.`);
        }
        res.setHeader("Content-Type", "text/plain");
        res.send(pdbCache.get(cacheKey));
        return;
      }
      
      const pdbData = await fetchPdbFromRcsb(pdbId, chainId);
      if (pdbData) {
        res.setHeader("Content-Type", "text/plain");
        res.send(pdbData);
        return;
      }
    }
  } catch (pdbErr: any) {
    console.warn(`[PDB Prioritization] Failed to resolve best PDB structure for ${validatedUniprot}:`, pdbErr.message || pdbErr);
  }

  // 2. Fallback to AlphaFold DB
  if (pdbCache.has(validatedUniprot)) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Cache Hit] Serving AlphaFold PDB for ${validatedUniprot} from memory cache.`);
    }
    res.setHeader("Content-Type", "text/plain");
    res.send(pdbCache.get(validatedUniprot));
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`PDB proxy requesting AlphaFold structure for UniProt ID: ${validatedUniprot}`);
  } else {
    console.log("PDB proxy requesting structure.");
  }
  
  try {
    const pdbData = await fetchAlphafoldPdb(validatedUniprot);
    if (pdbData) {
      pdbCache.set(validatedUniprot, pdbData);
      res.setHeader("Content-Type", "text/plain");
      res.send(pdbData);
    } else {
      sendError(res, 502, "BAD_GATEWAY", `Could not load AlphaFold PDB for accession: ${validatedUniprot}. EBI server returned failure.`);
    }
  } catch (err: any) {
    console.error(`PDB Proxy error:`, err);
    sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed proxying PDB structure.");
  }
});
