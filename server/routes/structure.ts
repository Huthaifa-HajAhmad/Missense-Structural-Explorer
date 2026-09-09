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
  esmFoldRequestSchema,
  structuralAlignRequestSchema
} from "../../src/shared/contracts.ts";
import {
  fetchPdbHomologs,
  fetchUniprotSequence,
  fetchAlphafoldPdb,
  getResolvedAlphafoldVersion,
  fetchFullPdbEntry,
} from "../services/external.ts";
import { resolveStructure } from "../services/structure-resolver.ts";
import { fetchEsm3StructureEval } from "../services/esm3_forge.ts";
import { foldSequence } from "../services/esmfold.ts";
import { runStructuralDiffInWorker, runAlignMutantToWtInWorker } from "../services/biophysics-pool.ts";
import fs from "fs";
import { AMINO_ACID_3_TO_1 } from "../../src/aminoAcids.ts";
import { applyMutation } from "../utils/mutation.ts";
import { CONFIG } from "../config.ts";

export function registerStructureRoutes(apiRouter: Router, jsonParserRegular: any, jsonParserPdb: any): void {

  apiRouter.get(["/homologs", "/homologs/"], async (_req, res) => {
    res.json({ homologs: [] });
  });

  apiRouter.get("/pdb/entry/:pdbId", async (req, res) => {
    const rawPdbId = (req.params.pdbId || "").trim();
    if (!rawPdbId || !/^[0-9a-zA-Z]{4}$/.test(rawPdbId)) {
      sendError(res, 400, "BAD_REQUEST", "Valid 4-character PDB ID required.");
      return;
    }
    const pdbId = rawPdbId.toUpperCase();
    try {
      const pdbText = await fetchFullPdbEntry(pdbId);
      if (!pdbText) {
        sendError(res, 404, "NOT_FOUND", `Could not retrieve PDB structure for ${pdbId} from RCSB.`);
        return;
      }
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Template-Source", "experimental");
      res.setHeader("X-Template-PdbId", pdbId);
      res.send(pdbText);
    } catch (err: any) {
      console.error(`[PDB Entry Route] Error fetching ${pdbId}:`, err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || `Failed retrieving PDB entry ${pdbId}`);
    }
  });

  apiRouter.get(["/pdb", "/pdb/"], async (_req, res) => {
    sendError(res, 400, "BAD_REQUEST", "UniProt accession ID required.");
  });

  apiRouter.get("/homologs/:uniprotId", async (req, res) => {
    let validatedUniprot: string;
    try {
      validatedUniprot = validateUniProt(req.params.uniprotId);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }
    // Forward optional ?pos= so the result is coverage-filtered for the mutation site
    let pos: number | undefined;
    if (req.query.pos) {
      const parsedPos = parseInt(req.query.pos as string, 10);
      if (!isNaN(parsedPos)) pos = parsedPos;
    }
    try {
      const homologs = await fetchPdbHomologs(validatedUniprot, pos);
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

  /**
   * Shared PDB proxy handler used by both /alphafold-pdb/:uniprotId and /pdb/:uniprotId.
   * Uses the 3-tier resolveStructure() chain:
   *   Tier 1 → PDBe direct mapping (experimental)
   *   Tier 2 → EBI AlphaFold
   *   Tier 3 → RCSB sequence homolog (covers mutation pos, ≥30% identity)
   */
  const handlePdbProxy = async (req: any, res: any) => {
    let validatedUniprot: string;
    try {
      validatedUniprot = validateUniProt(req.params.uniprotId);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }

    let pos: number | undefined;
    if (req.query.pos) {
      const parsedPos = parseInt(req.query.pos as string, 10);
      if (!isNaN(parsedPos)) pos = parsedPos;
    }

    try {
      const resolved = await resolveStructure(validatedUniprot, pos);
      if (!resolved) {
        sendError(res, 502, "BAD_GATEWAY",
          `Could not load any structure for accession: ${validatedUniprot}. ` +
          `PDBe, AlphaFold EBI, and sequence homolog search all failed.`);
        return;
      }

      const { pdbText, provenance } = resolved;
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Template-Source", provenance.source);
      if (provenance.pdbId)       res.setHeader("X-Template-PdbId",      provenance.pdbId);
      if (provenance.chainId)     res.setHeader("X-Template-ChainId",    provenance.chainId);
      if (provenance.resolution != null)
                                  res.setHeader("X-Template-Resolution",  String(provenance.resolution));
      if (provenance.method)      res.setHeader("X-Template-Method",      provenance.method);
      if (provenance.identity != null)
                                  res.setHeader("X-Template-Identity",    String(provenance.identity));
      res.send(pdbText);
    } catch (err: any) {
      console.error("PDB Proxy error:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed proxying PDB structure.");
    }
  };

  apiRouter.get("/alphafold-pdb/:uniprotId", async (req, res) => {
    let validatedUniprot: string;
    try {
      validatedUniprot = validateUniProt(req.params.uniprotId);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }

    try {
      const afData = await fetchAlphafoldPdb(validatedUniprot);
      if (!afData) {
        sendError(res, 404, "NOT_FOUND", `Could not retrieve AlphaFold DB model for accession: ${validatedUniprot}.`);
        return;
      }
      const afdbVersion = getResolvedAlphafoldVersion(validatedUniprot) || "v6";
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Template-Source", "alphafold");
      res.setHeader("X-Template-AfdbVersion", afdbVersion);
      res.send(afData);
    } catch (err: any) {
      console.error("[AlphaFold Route] Error:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed retrieving AlphaFold structure.");
    }
  });

  apiRouter.get("/pdb/:uniprotId", handlePdbProxy);

  apiRouter.get("/sidecar-health", async (_req, res) => {
    const startTime = Date.now();
    const sidecarUrl = CONFIG.services.sidecarBaseUrl;
    const timeoutMs = CONFIG.timeouts.sidecarHealthCheckMs || 3000;
    const safeBaseUrl = CONFIG.server.isProduction ? undefined : sidecarUrl;
    try {
      const response = await fetch(`${sidecarUrl}/health`, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      const latencyMs = Date.now() - startTime;
      if (response.ok) {
        const data = await response.json() as any;
        res.json({
          reachable: true,
          baseUrl: safeBaseUrl,
          latencyMs,
          status: data.status || "healthy",
          modelLoaded: data.model_loaded ?? false,
          activeModels: data.active_models ?? 0
        });
        return;
      }
      res.json({
        reachable: false,
        baseUrl: safeBaseUrl,
        latencyMs,
        error: `Sidecar returned HTTP ${response.status}`,
        remediation: {
          local: "python -m uv run --project tools python tools/model_server.py",
          oci: "export SIDECAR_URL=http://<oci-private-or-public-ip>:8000"
        }
      });
    } catch (err: any) {
      res.json({
        reachable: false,
        baseUrl: safeBaseUrl,
        latencyMs: Date.now() - startTime,
        error: err.message || "Connection refused",
        remediation: {
          local: "python -m uv run --project tools python tools/model_server.py",
          oci: "export SIDECAR_URL=http://<oci-private-or-public-ip>:8000"
        }
      });
    }
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
    const parseResult = esmFoldRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      let { sequence, uniprotId, variant, wtSeq, mutSeq } = parseResult.data;
      const headerVal = req.headers["x-biohub-token"];
      const token = Array.isArray(headerVal) ? headerVal[0] : headerVal || process.env.ESM3_FORGE_API_KEY;

      if (!sequence && !wtSeq) {
        if (!uniprotId) {
          sendError(res, 400, "BAD_REQUEST", "Either sequence, wtSeq, or uniprotId must be provided.");
          return;
        }
        sequence = await fetchUniprotSequence(validateUniProt(uniprotId));
        if (!sequence) {
          throw new Error(`Failed to resolve sequence for uniprotId ${uniprotId}`);
        }
      }

      const wtSequence = wtSeq || sequence;

      if (!wtSequence) {
        sendError(res, 400, "BAD_REQUEST", "No sequence provided — supply 'sequence' or 'wtSeq' to fold.");
        return;
      }

      let mutatedSequence = mutSeq;

      if (!mutatedSequence && variant && wtSequence) {
        const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
        if (mutMatch) {
          const wtStr = mutMatch[1];
          const pos = parseInt(mutMatch[2], 10);
          const mutStr = mutMatch[3];

          const wtUpper = wtStr.toUpperCase();
          const mutUpper = mutStr.toUpperCase();
          const wt1 = AMINO_ACID_3_TO_1[wtStr] || AMINO_ACID_3_TO_1[wtUpper] || (wtStr.length === 1 ? wtUpper : null);
          const mut1 = AMINO_ACID_3_TO_1[mutStr] || AMINO_ACID_3_TO_1[mutUpper] || (mutStr.length === 1 ? mutUpper : null);

          if (wt1 && mut1) {
            try {
              mutatedSequence = applyMutation(wtSequence, {
                chain: "A",
                position: pos,
                wt: wt1,
                mt: mut1
              });
            } catch (err: any) {
              console.warn("[ESMFold] Failed to apply mutation in route handler:", err.message);
            }
          }
        }
      }

      if (mutatedSequence && mutatedSequence !== wtSequence) {
        console.log(`[ESMFold] Folding both WT and Mutant sequences`);
        const wtPdb = await foldSequence(wtSequence, token);
        const mutPdb = await foldSequence(mutatedSequence, token);
        res.json({ wtPdb, mutPdb, chain: "A", status: "success" });
      } else if (wtSequence) {
        console.log(`[ESMFold] Folding single WT sequence`);
        const pdb = await foldSequence(wtSequence, token);
        res.json({ pdb, status: "success" });
      } else {
        throw new Error("No sequence resolved for ESMFold query.");
      }
    } catch (err: any) {
      let customMessage = err.message || "Failed to fold sequence using ESMFold.";
      let statusCode = 502;

      // Only check sidecar health if the error was not an explicit domain error (such as sequence length limits)
      const isExplicitDomainError = err.message?.includes("Sequence length") || err.message?.includes("No sequence resolved");

      if (!isExplicitDomainError) {
        // Inspect sidecar health status to provide extremely clear researcher feedback
        try {
          const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, { signal: AbortSignal.timeout(1000) });
          if (sidecarRes.ok) {
            const healthData = await sidecarRes.json() as any;
            if (healthData && healthData.model_loaded === false) {
              statusCode = 503;
              customMessage = "Model Server sidecar is online but still loading ML model weights in the background. Please wait ~30-60 seconds and try again.";
            }
          }
        } catch (healthErr: any) {
          if (healthErr.code === "ECONNREFUSED" || healthErr.message?.includes("fetch failed") || healthErr.message?.includes("connect")) {
            if (req.headers["x-biohub-token"] || process.env.ESM3_FORGE_API_KEY) {
              statusCode = 503;
              customMessage = "Model Server sidecar is currently offline or starting up. If you just started the app, please wait a minute for the background service to bind.";
            }
          }
        }
      }

      sendError(res, statusCode, statusCode === 503 ? "SERVICE_UNAVAILABLE" : "BAD_GATEWAY", customMessage);
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

      // Attempt lightweight ping call to EvolutionaryScale / Biohub endpoint
      try {
        let testRes = await fetch("https://api.evolutionaryscale.ai/v1/models", {
          method: "GET",
          headers: { 
            "Authorization": `Bearer ${token.trim()}`,
            "User-Agent": "MissenseResolve/1.0"
          },
          signal: AbortSignal.timeout(6000)
        }).catch(() => null);

        if (!testRes) {
          testRes = await fetch("https://biohub.ai/v1/models", {
            method: "GET",
            headers: { 
              "Authorization": `Bearer ${token.trim()}`,
              "User-Agent": "MissenseResolve/1.0"
            },
            signal: AbortSignal.timeout(6000)
          }).catch(() => null);
        }

        if (!testRes) {
          testRes = await fetch("https://forge.evolutionaryscale.ai/v1/models", {
            method: "GET",
            headers: { 
              "Authorization": `Bearer ${token.trim()}`,
              "User-Agent": "MissenseResolve/1.0"
            },
            signal: AbortSignal.timeout(6000)
          }).catch(() => null);
        }

        if (!testRes) {
          throw new Error("Unable to reach EvolutionaryScale API endpoints");
        }

        if (testRes.status === 200) {
          res.json({ valid: true, message: "Biohub / EvolutionaryScale token verified & active." });
          return;
        } else if (testRes.status === 401 || testRes.status === 403) {
          res.json({ valid: false, message: "Invalid or unauthorized Biohub API token (HTTP 401/403)." });
          return;
        } else {
          res.json({ valid: false, message: `Upstream verification returned unexpected HTTP ${testRes.status}.` });
          return;
        }
      } catch (netErr: any) {
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
      const headerBiohub = req.headers["x-biohub-token"];
      const biohubToken = (Array.isArray(headerBiohub) ? headerBiohub[0] : headerBiohub) || req.body?.biohubToken || process.env.BIOHUB_API_TOKEN || null;
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
      const diff = await runStructuralDiffInWorker({ wtPdb, mutPdb, pos: posVal, chain });
      res.json(diff);
    } catch (error: any) {
      console.error("Structural diff endpoint failure:", error);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", error.message || "Failed to compute structural difference.");
    }
  });

  apiRouter.post("/structural-align", jsonParserPdb, async (req, res) => {
    const parseResult = structuralAlignRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { pdb1, pdb2, targetIndex } = parseResult.data;
      const posVal = targetIndex ?? 1;
      const alignResult = await runAlignMutantToWtInWorker({
        wtPdb: pdb1,
        mutPdb: pdb2,
        pos: posVal,
        chain: "A"
      });
      res.json({
        alignedPdb: alignResult.alignedMutPdb,
        metrics: {
          ...alignResult,
          // Compatibility renames for legacy or alternative readers
          localBackboneRmsd: alignResult.localWindowRmsd,
          maxCaDisplacement: alignResult.displacements && alignResult.displacements.length > 0
            ? Math.max(...alignResult.displacements.map((d: any) => d.displacement))
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
