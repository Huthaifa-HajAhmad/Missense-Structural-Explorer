import { type Router } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { z } from "zod";

import {
  sendError,
  formatZodError,
  anySignal,
  onClientDisconnect,
} from "../../utils.ts";
import { fetchAlphafoldPdb } from "../../services/structure-fetcher.ts";
import {
  FoldingEngine,
  FoldingContext,
  ESMFoldEngine,
  FoldxEngine,
  ESM3Engine
} from "../../services/folding-engines.ts";
import { verifyStability } from "../../services/biophysics-bridge.ts";
import {
  fetchUniprotSequence,
} from "../../services/external.ts";
import {
  testTamarindConnection,
} from "../../services/biophysics.ts";
import { governedFetch } from "../../services/infra/http-client.ts";

const testTamarindConnectionSchema = z.object({
  tamarindApiKey: z.string().optional()
});

const testHfConnectionSchema = z.object({
  hfToken: z.string().optional()
});

const verifyStabilitySchema = z.object({
  uniprotId: z.string(),
  mutation: z.object({
    chain: z.string(),
    position: z.number(),
    wt: z.string(),
    mt: z.string()
  }),
  engine: z.string(),
  wtPdb: z.string().optional()
});

export function registerStabilityRoutes(apiRouter: Router, jsonParserRegular: any, jsonParserPdb: any): void {

  apiRouter.post("/test-tamarind-connection", jsonParserRegular, async (req, res) => {
    const parseResult = testTamarindConnectionSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const apiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;
      const result = await testTamarindConnection(apiKey);
      return res.json(result);
    } catch (err: any) {
      return sendError(res, 500, "INTERNAL_SERVER_ERROR", `Failed to test Tamarind connection: ${err.message}`);
    }
  });

  apiRouter.post("/test-hf-connection", jsonParserRegular, async (req, res) => {
    const parseResult = testHfConnectionSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const hfToken = (req.headers["x-hf-token"] as string) || req.body?.hfToken || process.env.HF_TOKEN;
      if (!hfToken) {
        return res.json({ valid: false, message: "No Hugging Face token provided." });
      }
      const response = await governedFetch("https://huggingface.co/api/whoami-v2", {
        headers: {
          "Authorization": `Bearer ${hfToken}`
        },
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json() as any;
        return res.json({ valid: true, message: `Connected as ${data.name} (${data.type})` });
      } else {
        return res.json({ valid: false, message: "Invalid Hugging Face Access Token." });
      }
    } catch (err: any) {
      return res.json({ valid: false, message: `Connection failed: ${err.message}` });
    }
  });

  apiRouter.post("/biophysics/verify-stability", jsonParserPdb, async (req, res) => {
    const parseResult = verifyStabilitySchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    const { uniprotId, mutation, engine, wtPdb } = req.body;
    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

    try {
      if (!uniprotId || !mutation || !engine) {
        sendError(res, 400, "BAD_REQUEST", "Missing required parameters: uniprotId, mutation, or engine.");
        return;
      }

      const { chain, position, wt, mt } = mutation;
      if (!chain || position === undefined || !wt || !mt) {
        sendError(res, 400, "BAD_REQUEST", "Invalid mutation object format. Must contain chain, position, wt, and mt.");
        return;
      }

      let wtSeq = req.body.wtSeq;
      if (!wtSeq) {
        try {
          const seqObj = await fetchUniprotSequence(uniprotId);
          wtSeq = seqObj;
        } catch (seqErr: any) {
          sendError(res, 500, "INTERNAL_SERVER_ERROR", `Failed to resolve sequence for UniProt ID ${uniprotId}: ${seqErr.message}`);
          return;
        }
      }

      if (!wtSeq) {
        sendError(res, 500, "INTERNAL_SERVER_ERROR", `Could not resolve sequence for UniProt ID ${uniprotId}.`);
        return;
      }

      let foldingEngine: FoldingEngine;
      if (engine === "esmfold") {
        foldingEngine = new ESMFoldEngine();
      } else if (engine === "foldx" || engine === "alphafold") {
        foldingEngine = new FoldxEngine();
      } else if (engine === "esm3") {
        foldingEngine = new ESM3Engine();
      } else {
        sendError(res, 400, "BAD_REQUEST", `Unsupported engine type: ${engine}`);
        return;
      }

      let resolvedWtPdb = wtPdb;
      if (!resolvedWtPdb) {
        try {
          resolvedWtPdb = await fetchAlphafoldPdb(uniprotId);
        } catch (pdbErr: any) {
          sendError(res, 500, "INTERNAL_SERVER_ERROR", `Failed to retrieve template PDB: ${pdbErr.message}`);
          return;
        }
      }

      if (!resolvedWtPdb) {
        sendError(res, 500, "INTERNAL_SERVER_ERROR", "No template wildtype PDB structure available.");
        return;
      }

      const clientAbortController = new AbortController();
      // Detect disconnects on `res`: `req` 'close' fires as soon as the body is read.
      onClientDisconnect(res, () => clientAbortController.abort());
      const timeoutSignal = AbortSignal.timeout(240000);
      const combinedSignal = anySignal([clientAbortController.signal, timeoutSignal]);

      const mutationCode = `${wt}${chain}${position}${mt}`;
      const tamarindApiKey = (req.headers["x-tamarind-api-key"] as string) || req.body?.tamarindApiKey || process.env.TAMARIND_API_KEY;
      const biohubToken = (req.headers["x-biohub-token"] as string) || req.body?.biohubToken || process.env.BIOHUB_API_TOKEN;

      const context: FoldingContext = {
        wtPdb: resolvedWtPdb,
        uniprotId,
        jobDir,
        mutationCode,
        biohubToken,
        signal: combinedSignal
      };

      const verifyResult = await verifyStability(
        wtSeq,
        mutation,
        foldingEngine,
        context,
        tamarindApiKey
      );

      res.json({
        pdb: verifyResult.structure.pdb,
        ddG: verifyResult.ddG,
        status: verifyResult.structure.status,
        error: verifyResult.structure.error ?? null,
        structure: verifyResult.structure,
        foldedResidueIndex: position,
        resolvedChain: chain,
        dynamut2JobId: verifyResult.dynamut2JobId,
        dynamut2Status: verifyResult.dynamut2Status,
        ddmutJobId: verifyResult.ddmutJobId,
        ddmutStatus: verifyResult.ddmutStatus,
        thermompnnJobId: verifyResult.thermompnnJobId,
        thermompnnStatus: verifyResult.thermompnnStatus,
        thermompnnError: (verifyResult as any).thermompnnError ?? null,
        energetics: {
          foldx: verifyResult.structure.energetics?.foldxMean ?? null,
          dynamut2: null,
          ddmut: null,
          rasp: null,
          consensusVerdict: null,
          evidenceComplete: verifyResult.thermompnnStatus !== "pending" && verifyResult.dynamut2Status !== "pending" && verifyResult.ddmutStatus !== "pending",
          pendingTools: [
            ...(verifyResult.thermompnnStatus === "pending" ? ["ThermoMPNN"] : []),
            ...(verifyResult.dynamut2Status === "pending" ? ["DynaMut2"] : []),
            ...(verifyResult.ddmutStatus === "pending" ? ["DDMut"] : [])
          ],
          ...verifyResult.structure.energetics,
          thermompnn: verifyResult.ddG !== undefined && verifyResult.ddG !== null ? verifyResult.ddG : (verifyResult.structure.energetics?.thermompnn ?? null)
        }
      });
    } catch (runErr: any) {
      console.error("[Biophysics Route verify-stability Error]:", runErr);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", runErr.message || "Stability verification failed.");
    } finally {
      try {
        if (fs.existsSync(jobDir)) {
          await fs.promises.rm(jobDir, { recursive: true, force: true });
        }
      } catch (cleanupErr: any) {
        console.error("[Biophysics Route verify-stability Cleanup Error]:", cleanupErr.message || cleanupErr);
      }
    }
  });
}
