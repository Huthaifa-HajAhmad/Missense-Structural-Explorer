/**
 * structure.ts — Structure-related routes:
 *   GET  /sequence/:uniprotId
 *   GET  /alphafold-pdb/:uniprotId
 *   POST /esmfold
 *   POST /esm3-structure-eval
 *   POST /structural-diff
 */
import { type Router } from "express";
import { sendError, validateUniProt, AuditLogger, formatZodError } from "../utils.ts";
import { z } from "zod";
import {
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  fetchPdbHomologs,
  fetchUniprotSequence,
  pdbCache,
} from "../services/external.ts";
import { fetchEsm3StructureEval } from "../services/esm3_forge.ts";
import { foldSequence } from "../services/esmfold.ts";
import { computeStructuralDiff, alignMutantToWt } from "../services/biophysics.ts";
import fs from "fs";

export function registerStructureRoutes(apiRouter: Router, jsonParserRegular: any, jsonParserPdb: any): void {

  apiRouter.get("/homologs/:uniprotId", async (req, res) => {
    let validatedUniprot: string;
    try {
      validatedUniprot = validateUniProt(req.params.uniprotId);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }
    try {
      const homologs = await fetchPdbHomologs(validatedUniprot);
      res.json({ homologs });
    } catch (err: any) {
      console.warn(`[Homologs] Error fetching homologs for ${validatedUniprot}:`, err.message || err);
      sendError(res, 500, "HOMOLOG_FETCH_FAILED", `Failed to retrieve homologous PDB models for ${validatedUniprot}.`);
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
      sendError(res, 502, "BAD_GATEWAY", `Could not retrieve UniProt sequence for accession: ${validatedUniprot}. The UniProt REST API may be temporarily unavailable — please retry.`);
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
          res.setHeader("X-Template-Source", "experimental");
          res.send(pdbCache.get(cacheKey));
          return;
        }

        const pdbData = await fetchPdbFromRcsb(pdbId, chainId, pdbMapping.unpStart, pdbMapping.structStart);
        if (pdbData) {
          res.setHeader("Content-Type", "text/plain");
          res.setHeader("X-Template-Source", "experimental");
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
      res.setHeader("X-Template-Source", "alphafold");
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
        res.setHeader("X-Template-Source", "alphafold");
        res.send(pdbData);
      } else {
        sendError(res, 502, "BAD_GATEWAY", `Could not load AlphaFold PDB for accession: ${validatedUniprot}. EBI server returned failure.`);
      }
    } catch (err: any) {
      console.error(`PDB Proxy error:`, err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed proxying PDB structure.");
    }
  });

  const esmfoldSchema = z.object({
    sequence: z.string().min(5).max(768)
  });

  const validateBiohubTokenSchema = z.object({
    token: z.string().min(8).optional()
  });

  const esm3StructureEvalSchema = z.object({
    uniprotId: z.string(),
    position: z.union([z.number(), z.string()]),
    wtResidue: z.string(),
    mutResidue: z.string(),
    wtPdbText: z.string().optional()
  });

  const structuralDiffSchema = z.object({
    wtPdb: z.string(),
    mutPdb: z.string(),
    pos: z.union([z.number(), z.string()]),
    chain: z.string()
  });

  apiRouter.post("/esmfold", jsonParserRegular, async (req, res) => {
    const parseResult = esmfoldSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { sequence } = parseResult.data;
      const headerVal = req.headers["x-biohub-token"];
      const token = Array.isArray(headerVal) ? headerVal[0] : headerVal || process.env.ESM3_FORGE_API_KEY;
      const pdb = await foldSequence(sequence, token);
      res.json({ pdb });
    } catch (err: any) {
      sendError(res, 502, "BAD_GATEWAY", err.message || "Failed to fold sequence using ESMFold.");
    }
  });

  apiRouter.post("/validate-biohub-token", jsonParserRegular, async (req, res) => {
    const parseResult = validateBiohubTokenSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const token = parseResult.data.token || (Array.isArray(req.headers["x-biohub-token"]) ? req.headers["x-biohub-token"][0] : req.headers["x-biohub-token"]);
      if (!token || typeof token !== "string" || token.trim().length < 8) {
        res.json({ valid: false, message: "Token format invalid (must be at least 8 characters)." });
        return;
      }

      // Attempt lightweight ping call to EvolutionaryScale / ESM Atlas endpoint
      try {
        const testRes = await fetch("https://biohub.ai/v1/models", {
          method: "GET",
          headers: { "Authorization": `Bearer ${token}` },
          signal: AbortSignal.timeout(4000)
        });
        if (testRes.status === 200) {
          res.json({ valid: true, message: "Biohub / EvolutionaryScale API key registered & active." });
        } else if (testRes.status === 401 || testRes.status === 403) {
          res.json({ valid: false, message: "Invalid or unauthorized Biohub API token." });
        } else {
          res.json({ valid: false, message: `API endpoint returned HTTP ${testRes.status}.` });
        }
      } catch (netErr: any) {
        // Fallback check against ESM Atlas
        try {
          const atlasCheck = await fetch("https://api.esmatlas.com/", { method: "HEAD", signal: AbortSignal.timeout(3000) });
          if (atlasCheck.ok || atlasCheck.status === 403) {
            res.json({ valid: true, message: "Biohub / ESM API token configured (ESM Atlas active)." });
            return;
          }
        } catch (_) {}
        res.json({ valid: false, message: `API endpoint unreachable (${netErr.message || "Network Timeout"}).` });
      }
    } catch (err: any) {
      res.json({ valid: false, message: err.message || "Validation failed." });
    }
  });

  apiRouter.post("/esm3-structure-eval", jsonParserPdb, async (req, res) => {
    const parseResult = esm3StructureEvalSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { uniprotId, position, wtResidue, mutResidue, wtPdbText } = parseResult.data;
      const posVal = typeof position === "string" ? parseInt(position, 10) : position;
      if (isNaN(posVal) || posVal <= 0) {
        sendError(res, 400, "BAD_REQUEST", "Position must be a valid positive number (> 0).");
        return;
      }
      const biohubToken = (req.headers["x-biohub-token"] as string) || req.body?.biohubToken || process.env.BIOHUB_API_TOKEN || null;
      const evalResult = await fetchEsm3StructureEval(uniprotId, posVal, wtResidue, mutResidue, wtPdbText, biohubToken);

      let expectedSeqLen = 0;
      if (wtPdbText) {
        const lines = wtPdbText.split("\n");
        for (const line of lines) {
          if (line.startsWith("ATOM ") && line.substring(12, 16).trim() === "CA") {
            expectedSeqLen++;
          }
        }
      }

      if (evalResult && evalResult.perturbationScores && expectedSeqLen > 0) {
        if (evalResult.perturbationScores.length !== expectedSeqLen) {
          sendError(res, 502, "BAD_GATEWAY", `ESM3 structural evaluation score length mismatch (got ${evalResult.perturbationScores.length}, expected ${expectedSeqLen}).`);
          return;
        }
      }

      res.json(evalResult);
    } catch (error: any) {
      console.error("ESM3 structure eval endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "Failed to evaluate ESM3 structure.");
    }
  });

  apiRouter.post("/structural-diff", jsonParserPdb, async (req, res) => {
    const parseResult = structuralDiffSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { wtPdb, mutPdb, pos, chain } = parseResult.data;
      const posVal = typeof pos === "string" ? parseInt(pos, 10) : pos;
      if (isNaN(posVal) || posVal <= 0) {
        sendError(res, 400, "BAD_REQUEST", "Position (pos) must be a positive number (> 0).");
        return;
      }
      const diff = await computeStructuralDiff(wtPdb, mutPdb, posVal, chain);
      res.json(diff);
    } catch (error: any) {
      console.error("Structural diff endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "Failed to compute structural difference.");
    }
  });

  apiRouter.post("/structural-align", jsonParserPdb, async (req, res) => {
    const parseResult = structuralDiffSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { wtPdb, mutPdb, pos, chain } = parseResult.data;
      const posVal = typeof pos === "string" ? parseInt(pos, 10) : pos;
      if (isNaN(posVal) || posVal <= 0) {
        sendError(res, 400, "BAD_REQUEST", "Position (pos) must be a positive number (> 0).");
        return;
      }
      const alignResult = await alignMutantToWt(wtPdb, mutPdb, posVal, chain);
      res.json({
        alignedPdb: alignResult.alignedMutPdb,
        metrics: {
          ...alignResult,
          // Compatibility renames for legacy or alternative readers
          localBackboneRmsd: alignResult.localWindowRmsd,
          maxCaDisplacement: alignResult.displacements && alignResult.displacements.length > 0
            ? Math.max(...alignResult.displacements.map(d => d.displacement))
            : 0,
          deltaSasa: alignResult.sasaChange,
          sasaDiff: { delta: alignResult.sasaChange },
          hBondsDiff: { lostCount: alignResult.lostHBonds, gainedCount: alignResult.gainedHBonds },
          contactsDiff: { lostCount: alignResult.lostContacts, gainedCount: alignResult.gainedContacts }
        }
      });
    } catch (error: any) {
      console.error("Structural align endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "Failed to align structures.");
    }
  });
}
