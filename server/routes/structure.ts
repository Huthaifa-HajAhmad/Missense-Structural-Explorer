/**
 * structure.ts — Structure-related routes:
 *   GET  /sequence/:uniprotId
 *   GET  /alphafold-pdb/:uniprotId
 *   POST /esmfold
 *   POST /esm3-structure-eval
 *   POST /structural-diff
 */
import { type Router } from "express";
import { sendError, validateUniProt, validateGene, validateVariant, AuditLogger, formatZodError, onClientDisconnect } from "../utils.ts";
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
  fetchEntryForVariant,
} from "../services/external.ts";
import { resolveStructure } from "../services/structure-resolver.ts";
import { registerStructureReference, type StructureReferenceIdentity } from "../services/structure/structure-reference-store.ts";
import { STRUCTURE_REF_HEADER } from "../../src/shared/structureRefs.ts";
import { fetchEsm3StructureEval } from "../services/esm3_forge.ts";
import { foldSequenceWithProvenance } from "../services/esmfold.ts";
import { runStructuralDiffInWorker, runAlignMutantToWtInWorker } from "../services/biophysics-pool.ts";
import fs from "fs";
import { AMINO_ACID_3_TO_1 } from "../../src/shared/aminoAcids.ts";
import { applyMutation } from "../utils/mutation.ts";
import { CONFIG } from "../config.ts";
import { analyzeMultimerStructure } from "../services/multimer.ts";
import { analyzePpiBinding, analyzeBindingShift } from "../services/ppi.ts";
import { governedFetch } from "../services/infra/http-client.ts";

export function registerStructureRoutes(apiRouter: Router, jsonParserRegular: any, jsonParserPdb: any): void {

  /**
   * Publishes the reference for the text this route is about to serve.
   *
   * Every PDB route that answers with coordinates announces which exact bytes it sent, so a later
   * pocket/nearest call can name them instead of uploading half a megabyte again — and, more
   * importantly, so that call cannot be answered from a different structure via the UniProt ladder.
   * The header is additive: a reader that ignores it keeps working exactly as before.
   */
  const publishStructureRef = (res: any, pdbText: string | null | undefined, identity: StructureReferenceIdentity): void => {
    const ref = registerStructureReference(pdbText, identity);
    if (ref) res.setHeader(STRUCTURE_REF_HEADER, ref);
  };

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

    // With the variant's accession, position and wild-type residue: the matching chain, renumbered
    // to UniProt when that can be verified. The headers say which numbering the text is in.
    const q = (req.query ?? {}) as Record<string, unknown>;
    if (q.uniprot !== undefined || q.pos !== undefined || q.wt !== undefined) {
      let uniprotId: string;
      try {
        uniprotId = validateUniProt(String(q.uniprot ?? ""));
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }
      const pos = Number.parseInt(String(q.pos ?? ""), 10);
      const wt1 = String(q.wt ?? "").toUpperCase();
      if (!Number.isFinite(pos) || pos < 1 || !/^[ACDEFGHIKLMNPQRSTVWY]$/.test(wt1)) {
        sendError(res, 400, "BAD_REQUEST", "pos must be a positive residue number and wt a one-letter amino acid.");
        return;
      }
      try {
        const entry = await fetchEntryForVariant(pdbId, uniprotId, pos, wt1);
        if (!entry) {
          sendError(res, 404, "NOT_FOUND", `Could not retrieve PDB structure for ${pdbId} from RCSB.`);
          return;
        }
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("X-Template-Source", "experimental");
        res.setHeader("X-Template-PdbId", pdbId);
        res.setHeader("X-Entry-Numbering", entry.numbering);
        if (entry.chainId) res.setHeader("X-Entry-Chain", entry.chainId);
        if (entry.mapping) res.setHeader("X-Entry-Mapping", entry.mapping);
        if (entry.unmappedResidues) res.setHeader("X-Entry-Unmapped", String(entry.unmappedResidues));
        if (entry.reason) res.setHeader("X-Entry-Reason", encodeURIComponent(entry.reason));
        publishStructureRef(res, entry.pdbText, {
          origin: "server",
          uniprotId,
          source: "experimental",
          pdbId,
          chainId: entry.chainId ?? undefined,
          numbering: entry.numbering,
          pos,
        });
        res.send(entry.pdbText);
      } catch (err: any) {
        console.error(`[PDB Entry Route] Error resolving ${pdbId} for ${uniprotId}:`, err);
        sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || `Failed retrieving PDB entry ${pdbId}`);
      }
      return;
    }

    try {
      const pdbText = await fetchFullPdbEntry(pdbId);
      if (!pdbText) {
        sendError(res, 404, "NOT_FOUND", `Could not retrieve PDB structure for ${pdbId} from RCSB.`);
        return;
      }
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Template-Source", "experimental");
      res.setHeader("X-Template-PdbId", pdbId);
      res.setHeader("X-Entry-Numbering", "author");
      publishStructureRef(res, pdbText, {
        origin: "server",
        source: "experimental",
        pdbId,
        numbering: "author",
      });
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
      console.warn(`[Homologs] Notice: Error or timeout fetching homologs for ${validatedUniprot}:`, err.message || err);
      // Homologs are optional progressive enhancements; return empty array with 200 OK so UI proceeds smoothly
      res.json({ homologs: [] });
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
      publishStructureRef(res, pdbText, {
        origin: "server",
        uniprotId: validatedUniprot,
        source: provenance.source,
        pdbId: provenance.pdbId,
        chainId: provenance.chainId,
        afdbVersion: provenance.afdbVersion,
        pos,
      });
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
      const afdbVersion = getResolvedAlphafoldVersion(validatedUniprot);
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Template-Source", "alphafold");
      // Only a version the resolved URL actually names is announced; a hardcoded default would stamp
      // provenance with a version the bytes need not carry.
      if (afdbVersion) res.setHeader("X-Template-AfdbVersion", afdbVersion);
      publishStructureRef(res, afData, {
        origin: "server",
        uniprotId: validatedUniprot,
        source: "alphafold",
        afdbVersion,
      });
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
        error: CONFIG.server.isProduction
          ? "Model server sidecar connection unavailable"
          : (err.message || "Connection refused"),
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
      const token = (Array.isArray(headerVal) ? headerVal[0] : headerVal) || process.env.BIOHUB_API_TOKEN || process.env.ESM3_FORGE_API_KEY;

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
        console.log(`[ESMFold] Folding the WT and mutant sequences concurrently`);
        // Two independent predictions, so there is nothing to wait for between them: folding them one
        // after the other doubled the wait for a fresh pair (the wild type is often a cache hit).
        const [wt, mut] = await Promise.all([
          foldSequenceWithProvenance(wtSequence, token),
          foldSequenceWithProvenance(mutatedSequence, token),
        ]);
        // Each structure names its engine: a Tier-1 outage between the two folds can hand the
        // variant to a different model than the wild type, and the viewer must be able to say so.
        res.json({ wtPdb: wt.pdb, mutPdb: mut.pdb, chain: "A", status: "success", engines: { wildType: wt.engine, variant: mut.engine } });
      } else if (wtSequence) {
        console.log(`[ESMFold] Folding single WT sequence`);
        const wt = await foldSequenceWithProvenance(wtSequence, token);
        res.json({ pdb: wt.pdb, status: "success", engines: { wildType: wt.engine, variant: null } });
      } else {
        throw new Error("No sequence resolved for ESMFold query.");
      }
    } catch (err: any) {
      let customMessage = err.message || "Failed to fold sequence using ESMFold.";
      let statusCode = 502;

      // Only check sidecar health if the error was not an explicit domain error (such as sequence length limits)
      const isExplicitDomainError = err.message?.includes("Sequence length") || err.message?.includes("No sequence resolved");

      if (isExplicitDomainError) {
        statusCode = 422;
      } else {
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

      sendError(res, statusCode, statusCode === 503 ? "SERVICE_UNAVAILABLE" : isExplicitDomainError ? "UNPROCESSABLE_ENTITY" : "BAD_GATEWAY", customMessage);
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

      // Attempt lightweight probe call to EvolutionaryScale Forge / Biohub endpoint
      try {
        const probeBody = JSON.stringify({
          model: "esm3-small-2024-08",
          inputs: { sequence: "M" }
        });
        const probeHeaders = {
          "Authorization": `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
          "User-Agent": "MissenseResolve/1.0"
        };

        let testRes = await governedFetch("https://forge.evolutionaryscale.ai/api/v1/encode", {
          method: "POST",
          headers: probeHeaders,
          body: probeBody,
          signal: AbortSignal.timeout(6000)
        }).catch(() => null);

        if (!testRes || testRes.status === 451) {
          const fallbackRes = await governedFetch("https://biohub.ai/api/v1/encode", {
            method: "POST",
            headers: probeHeaders,
            body: probeBody,
            signal: AbortSignal.timeout(6000)
          }).catch(() => null);
          if (fallbackRes) {
            testRes = fallbackRes;
          }
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
        } else if (testRes.status === 451) {
          res.json({ valid: false, message: "EvolutionaryScale endpoint is regionally restricted (HTTP 451). Consider using JapanFold or a VPN." });
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
      const { pdb1, pdb2, targetIndex, alignmentScope } = parseResult.data;
      const posVal = targetIndex ?? 1;
      const alignResult = await runAlignMutantToWtInWorker({
        wtPdb: pdb1,
        mutPdb: pdb2,
        pos: posVal,
        chain: "A",
        alignmentScope: alignmentScope || "local"
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

  const multimerRequestSchema = z.object({
    gene: z.string().trim().min(1, "gene is required").max(30),
    variant: z.string().trim().min(3, "variant is required").max(50),
    uniprotId: z.string().trim().min(3, "uniprotId is required").max(20),
    // The complex model is a GPU job the reader asks for; without it the answer is the curated
    // assembly and the solved-structure interfaces alone.
    model: z.boolean().optional()
  });

  // Lookups only. The old body also took `wtPdb`/`mutPdb`/`chainA`/`chainB`; zod strips them now, so an
  // older client still gets partners and sites, and no binding value is computed from its PDB.
  const ppiBindingRequestSchema = z.object({
    gene: z.string().trim().min(1, "gene is required").max(30),
    variant: z.string().trim().min(3, "variant is required").max(50),
    uniprotId: z.string().trim().min(3).max(20).optional().nullable()
  });

  const ppiShiftRequestSchema = z.object({
    gene: z.string().trim().min(1, "gene is required").max(30),
    variant: z.string().trim().min(3, "variant is required").max(50),
    uniprotId: z.string().trim().min(3, "uniprotId is required").max(20),
    chains: z.array(z.object({
      id: z.string().trim().regex(/^[A-Z]$/, "Chain ids are single capital letters"),
      accession: z.string().trim().min(6).max(15),
      gene: z.string().trim().max(30).optional().nullable()
    })).min(2, "A complex needs at least two chains").max(4, "At most four chains are modelled").optional()
  });

  apiRouter.post("/structure/multimer", jsonParserRegular, async (req, res) => {
    const parseResult = multimerRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    const clientAbortController = new AbortController();
    // Detect disconnects on `res`: `req` 'close' fires as soon as the body is read.
    onClientDisconnect(res, () => clientAbortController.abort());
    try {
      const validGene = validateGene(parseResult.data.gene);
      const validVariant = validateVariant(parseResult.data.variant);
      const validUniprot = validateUniProt(parseResult.data.uniprotId);

      const result = await analyzeMultimerStructure(validGene, validVariant, validUniprot, clientAbortController.signal, {
        model: parseResult.data.model === true,
      });
      res.json(result);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message || "Failed to analyze multimer structure.");
    }
  });

  apiRouter.post(["/ppi/binding-affinity", "/ppi/binding-affinity/"], jsonParserPdb, async (req, res) => {
    const parseResult = ppiBindingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    const clientAbortController = new AbortController();
    // Detect disconnects on `res`: `req` 'close' fires as soon as the body is read.
    onClientDisconnect(res, () => clientAbortController.abort());
    try {
      const validGene = validateGene(parseResult.data.gene);
      const validVariant = validateVariant(parseResult.data.variant);
      const validUniprot = parseResult.data.uniprotId ? validateUniProt(parseResult.data.uniprotId) : undefined;

      const result = await analyzePpiBinding(validGene, validVariant, validUniprot, clientAbortController.signal);
      res.json(result);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message || "Failed to analyze PPI binding affinity.");
    }
  });

  apiRouter.post(["/ppi/binding-shift", "/ppi/binding-shift/"], jsonParserRegular, async (req, res) => {
    const parseResult = ppiShiftRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    const clientAbortController = new AbortController();
    onClientDisconnect(res, () => clientAbortController.abort());
    try {
      const validGene = validateGene(parseResult.data.gene);
      const validVariant = validateVariant(parseResult.data.variant);
      const validUniprot = validateUniProt(parseResult.data.uniprotId);
      const chains = (parseResult.data.chains ?? []).map(c => ({ id: c.id, accession: validateUniProt(c.accession), gene: c.gene ?? null }));
      const result = await analyzeBindingShift(validGene, validVariant, validUniprot, chains, clientAbortController.signal);
      res.json(result);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message || "Failed to estimate the binding change.");
    }
  });
}

