import { type Router } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { z } from "zod";

import {
  sendError,
  AuditLogger,
  formatZodError,
} from "../../utils.ts";
import {
  biophysicalSemaphore,
  findBindingPocket,
  parseResiduesFromPdbMaybeAsync,
  getResidueDetails,
} from "../../services/biophysics.ts";

const pocketFinderSchema = z.object({
  pdbText: z.string(),
  targetIndex: z.union([z.number(), z.string()])
});

const nearestResiduesSchema = z.object({
  pdbText: z.string(),
  targetIndex: z.union([z.number(), z.string()]),
  n: z.union([z.number(), z.string()]).optional()
});

export function registerPocketRoutes(apiRouter: Router, jsonParserPdb: any): void {

  apiRouter.post("/pocket-finder", jsonParserPdb, async (req, res) => {
    const parseResult = pocketFinderSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
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

      try {
        const parsedResidues = await parseResiduesFromPdbMaybeAsync(pdbText);
        if (!parsedResidues || parsedResidues.length === 0) {
          throw new Error("PDB structure contains no parseable residues.");
        }
        const targetRes = parsedResidues.find(r => r.resSeq === mutIndex);
        if (!targetRes) {
          sendError(res, 400, "BAD_REQUEST", `Target residue index #${mutIndex} was not found in the PDB structure.`);
          return;
        }
      } catch (parseErr: any) {
        sendError(res, 400, "BAD_REQUEST", `Malformed PDB structure: ${parseErr.message}`);
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
          sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "An error occurred during pocket finding.");
        }
      } finally {
        await cleanupPocketFiles();
        if (acquired) {
          biophysicalSemaphore.release();
        }
      }
    } catch (outerErr: any) {
      sendError(res, 500, "INTERNAL_SERVER_ERROR", outerErr.message || "An unexpected error occurred.");
    }
  });

  apiRouter.post("/nearest-residues", jsonParserPdb, async (req, res) => {
    const parseResult = nearestResiduesSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
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
    } catch (err: any) {
      console.error("Nearest residues calculation failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "An error occurred while computing nearest residues.");
    }
  });
}
