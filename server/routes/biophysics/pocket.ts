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
  findBindingPocket,
  parseResiduesFromPdbMaybeAsync,
  getResidueDetails,
} from "../../services/biophysics.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";

async function resolvePdbText(body: { pdbText?: string; pdbRef?: string; uniprotId?: string }): Promise<string | null> {
  if (body.pdbText && body.pdbText.trim().length > 0) {
    return body.pdbText;
  }
  const ref = (body.pdbRef || body.uniprotId || "").trim();
  if (!ref) return null;

  const { pdbCache } = await import("../../services/cache.ts");
  if (pdbCache.has(ref)) {
    const cached = pdbCache.get(ref);
    if (cached) return cached;
  }

  try {
    const { resolveStructure } = await import("../../services/structure-resolver.ts");
    const resolved = await resolveStructure(ref);
    if (resolved?.pdbText) {
      pdbCache.set(ref, resolved.pdbText);
      return resolved.pdbText;
    }
  } catch (_) {}

  try {
    const { fetchAlphafoldPdb } = await import("../../services/structure-fetcher.ts");
    const fetched = await fetchAlphafoldPdb(ref);
    if (fetched) {
      pdbCache.set(ref, fetched);
      return fetched;
    }
  } catch (_) {}
  return null;
}

const pocketFinderSchema = z.object({
  pdbText: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().optional(),
  targetIndex: z.union([z.number(), z.string()]).optional(),
  mutIndex: z.union([z.number(), z.string()]).optional(),
  targetChain: z.string().optional()
}).refine(data => data.pdbText !== undefined || data.pdbRef !== undefined || data.uniprotId !== undefined, {
  message: "Either pdbText, pdbRef, or uniprotId must be specified."
}).refine(data => data.targetIndex !== undefined || data.mutIndex !== undefined, {
  message: "Either targetIndex or mutIndex must be specified."
});

const nearestResiduesSchema = z.object({
  pdbText: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().optional(),
  targetIndex: z.union([z.number(), z.string()]),
  targetChain: z.string().optional(),
  distanceThreshold: z.union([z.number(), z.string()]).refine(
    value => Number(value) > 0,
    "distanceThreshold must be positive"
  ).optional(),
  n: z.union([z.number(), z.string()]).optional()
}).refine(data => data.pdbText !== undefined || data.pdbRef !== undefined || data.uniprotId !== undefined, {
  message: "Either pdbText, pdbRef, or uniprotId must be specified."
});

export function registerPocketRoutes(apiRouter: Router, jsonParserPdb: any): void {

  const pocketHandler = async (req: any, res: any) => {
    const parseResult = pocketFinderSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { targetIndex, mutIndex, targetChain } = req.body;
      const pdbText = await resolvePdbText(req.body);

      if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records or unresolvable structure.");
        return;
      }
      if (pdbText.length > 5 * 1024 * 1024) {
        sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
        return;
      }

      const targetIdx = targetIndex !== undefined ? targetIndex : mutIndex;
      const mutIndexVal = targetIdx !== undefined && targetIdx !== null ? Number(targetIdx) : null;
      if (mutIndexVal === null || isNaN(mutIndexVal) || mutIndexVal <= 0 || mutIndexVal > 99999) {
        sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex/mutIndex: must be a positive integer.");
        return;
      }

      let effectivePdbText = pdbText;
      let effectiveTargetChain = targetChain;

      try {
        let parsedResidues = await parseResiduesFromPdbMaybeAsync(effectivePdbText);
        if (!parsedResidues || parsedResidues.length === 0) {
          throw new Error("PDB structure contains no parseable residues.");
        }
        let targetRes = parsedResidues.find(r =>
          r.resSeq === mutIndexVal && (!effectiveTargetChain || r.chain === effectiveTargetChain)
        );

        if (!targetRes) {
          // If residue is missing from experimental structure, attempt fallback to AlphaFold full-length model
          const ref = (req.body.pdbRef || req.body.uniprotId || "").trim();
          if (ref) {
            console.log(`[Pocket Finder] Target residue #${mutIndexVal} missing from provided PDB. Falling back to AlphaFold for ${ref}...`);
            const { fetchAlphafoldPdb } = await import("../../services/structure-fetcher.ts");
            const afPdb = await fetchAlphafoldPdb(ref);
            if (afPdb && (afPdb.includes("ATOM") || afPdb.includes("HETATM"))) {
              const afResidues = await parseResiduesFromPdbMaybeAsync(afPdb);
              const afTarget = afResidues.find(r => r.resSeq === mutIndexVal);
              if (afTarget) {
                console.log(`[Pocket Finder] AlphaFold model resolved successfully for residue #${mutIndexVal}.`);
                effectivePdbText = afPdb;
                effectiveTargetChain = "A";
                targetRes = afTarget;
              }
            }
          }
        }

        if (!targetRes) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue index #${mutIndexVal} was not found in the PDB structure or AlphaFold model.`);
          return;
        }
      } catch (parseErr: any) {
        sendError(res, 400, "BAD_REQUEST", `Malformed PDB structure: ${parseErr.message}`);
        return;
      }

      const jobId = crypto.randomUUID();
      const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

      try {
        const queue = BiophysicalJobQueue.getInstance();
        let queueJobId: string;
        try {
          queueJobId = await queue.pushJob("p2rank", { pdbText: effectivePdbText, mutIndex: mutIndexVal, targetChain: effectiveTargetChain, jobDir });
        } catch (queueErr: any) {
          if (queueErr.message.includes("BUSY")) {
            sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Queue limit reached.");
            return;
          }
          throw queueErr;
        }

        res.json({
          status: "queued",
          pocketJobId: queueJobId
        });

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
      }
    } catch (outerErr: any) {
      sendError(res, 500, "INTERNAL_SERVER_ERROR", outerErr.message || "An unexpected error occurred.");
    }
  };

  apiRouter.post("/pocket-finder", jsonParserPdb, pocketHandler);
  apiRouter.post("/pocket-detect", jsonParserPdb, pocketHandler);

  apiRouter.get("/pocket-job/:jobId", async (req, res) => {
    try {
      const jobId = req.params.jobId;
      const queue = BiophysicalJobQueue.getInstance();
      const jobInfo = await queue.getJobStatus(jobId);

      if (!jobInfo) {
        sendError(res, 404, "NOT_FOUND", "Pocket job not found.");
        return;
      }

      res.json({
        jobId,
        status: jobInfo.status,
        result: jobInfo.result,
        error: jobInfo.error
      });
    } catch (err: any) {
      console.error("Pocket job polling route failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to poll pocket job status.");
    }
  });

  apiRouter.get("/biophysics/pocket-job/:jobId", async (req, res) => {
    try {
      const jobId = req.params.jobId;
      const queue = BiophysicalJobQueue.getInstance();
      const jobInfo = await queue.getJobStatus(jobId);

      if (!jobInfo) {
        sendError(res, 404, "NOT_FOUND", "Pocket job not found.");
        return;
      }

      res.json({
        jobId,
        status: jobInfo.status,
        result: jobInfo.result,
        error: jobInfo.error
      });
    } catch (err: any) {
      console.error("Pocket job polling route failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to poll pocket job status.");
    }
  });

  apiRouter.post("/nearest-residues", jsonParserPdb, async (req, res) => {
    const parseResult = nearestResiduesSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { targetIndex, targetChain } = req.body;
      const pdbText = await resolvePdbText(req.body);
      const distanceThreshold = req.body.distanceThreshold !== undefined
        ? Number(req.body.distanceThreshold)
        : null;
      let n = req.body.n !== undefined ? Number(req.body.n) : 5;

      if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
        sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records or unresolvable structure.");
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
      const targetRes = residues.find(r =>
        r.resSeq === targetIndexNum && (!targetChain || r.chain === targetChain)
      );
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
        if (targetChain && r.chain !== targetChain) continue;
        if (r.x === undefined || r.y === undefined || r.z === undefined) continue;

        const dx = r.x - targetRes.x;
        const dy = r.y - targetRes.y;
        const dz = r.z - targetRes.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distanceThreshold !== null && dist > distanceThreshold) continue;

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
