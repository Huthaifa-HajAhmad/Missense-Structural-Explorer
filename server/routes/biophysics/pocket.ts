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
import { submitterId, submitterLimits, submitterPlacementPref } from "../../auth/principal.ts";
import { AdmissionError } from "../../services/infra/admission.ts";
import { countResidues } from "../../services/stability/foldx/estimate.ts";
import { pocketCache, pocketResultCacheKey } from "../../services/structure/pocket/runner.ts";
import { pocketJobRegistry } from "../../services/infra/foldx-job-registry.ts";
import { mayServe, withProvenanceFor } from "../../../src/shared/computeProvenance.ts";
import { QueueLimitError } from "../../services/infra/queue-owners.ts";
import {
  resolveStructureReference,
  structureReferenceMatchesText,
  type StructureReferenceIdentity,
} from "../../services/structure/structure-reference-store.ts";
import { type StructureResolutionEcho } from "../../../src/shared/structureRefs.ts";

/**
 * What the routes computed on, and where it came from.
 *
 * `resolution` is returned to the caller as an audit echo: a pocket or contact map that cannot say
 * which structure produced it is not reproducible, and the whole point of this path is that the
 * answer must be about the structure the reader is looking at.
 */
export interface ResolvedStructureInput {
  pdbText: string;
  resolution: StructureResolutionEcho;
  identity?: StructureReferenceIdentity;
}

/** A reference was supplied, is no longer resolvable, and no text came with it. */
export interface UnresolvedStructureRef {
  unresolvedStructureRef: string;
}

export function isUnresolvedStructureRef(value: unknown): value is UnresolvedStructureRef {
  return Boolean(value) && typeof value === "object" && "unresolvedStructureRef" in (value as any);
}

/**
 * Resolve the PDB text a pocket/nearest request should be computed on.
 *
 * Order of authority — and WHY it is this order:
 *   1. `structureRef` — the exact bytes this server returned for the structure on screen. Exact by
 *      construction: the reference is the digest of those bytes. When text is also present and
 *      disagrees with the reference, the TEXT wins (step 1b): the caller's bytes are what it is
 *      displaying, and answering about the reference's structure would be the very conflation this
 *      path exists to prevent. The disagreement is reported via `refTextMismatch`.
 *   2. `pdbText` — the caller's own bytes: a local upload, or the documented one-shot fallback when
 *      a reference has been evicted. Preferred over any accession so the computation stays on the
 *      structure that was sent, never on whatever the resolver happens to pick.
 *   3. `pdbRef` / `uniprotId` — the legacy accession ladder, kept for older callers only. It can
 *      return a DIFFERENT template than the one on screen, which is why it is last.
 *
 * An unresolvable reference with no text is reported (`unresolvedStructureRef`) rather than silently
 * falling through to step 3: the caller asked for specific bytes, and substituting another structure
 * for them would be a wrong answer that looks right.
 */
export async function resolveStructureInput(body: {
  pdbText?: string;
  pdbRef?: string;
  uniprotId?: string;
  structureRef?: string;
}): Promise<ResolvedStructureInput | UnresolvedStructureRef | null> {
  const requestedRef = typeof body.structureRef === "string" ? body.structureRef.trim() : "";
  const providedText = typeof body.pdbText === "string" ? body.pdbText : "";

  if (requestedRef) {
    const record = resolveStructureReference(requestedRef);
    if (record) {
      if (providedText.trim().length === 0 || structureReferenceMatchesText(record, providedText)) {
        return {
          pdbText: record.pdbText,
          resolution: {
            resolvedFrom: "structureRef",
            structureRef: record.ref,
            source: record.identity.source,
            pdbId: record.identity.pdbId,
            chainId: record.identity.chainId,
          },
          identity: record.identity,
        };
      }
      return {
        pdbText: providedText,
        resolution: { resolvedFrom: "pdbText", refTextMismatch: true },
      };
    }
    if (providedText.trim().length > 0) {
      // The reference was evicted (or never existed): use the bytes the caller sent, exactly once.
      return { pdbText: providedText, resolution: { resolvedFrom: "pdbText" } };
    }
    return { unresolvedStructureRef: requestedRef };
  }

  if (providedText.trim().length > 0) {
    return { pdbText: providedText, resolution: { resolvedFrom: "pdbText" } };
  }

  const ref = (body.pdbRef || body.uniprotId || "").trim();
  if (!ref) return null;

  const { pdbCache } = await import("../../services/cache.ts");
  if (pdbCache.has(ref)) {
    const cached = pdbCache.get(ref);
    if (cached) return { pdbText: cached, resolution: { resolvedFrom: "uniprot-resolver" } };
  }

  try {
    const { resolveStructure } = await import("../../services/structure-resolver.ts");
    const resolved = await resolveStructure(ref);
    if (resolved?.pdbText) {
      pdbCache.set(ref, resolved.pdbText);
      return {
        pdbText: resolved.pdbText,
        resolution: {
          resolvedFrom: "uniprot-resolver",
          source: resolved.provenance?.source,
          pdbId: resolved.provenance?.pdbId,
          chainId: resolved.provenance?.chainId,
        },
      };
    }
  } catch (_) {}

  try {
    const { fetchAlphafoldPdb } = await import("../../services/structure-fetcher.ts");
    const fetched = await fetchAlphafoldPdb(ref);
    if (fetched) {
      pdbCache.set(ref, fetched);
      return {
        pdbText: fetched,
        resolution: { resolvedFrom: "uniprot-resolver", source: "alphafold" },
      };
    }
  } catch (_) {}
  return null;
}

const STALE_STRUCTURE_REF_MESSAGE =
  "The structure reference is no longer available on the server (it expired, was evicted, or " +
  "predates a restart). Re-send the exact PDB text (structureRef with pdbText) or re-fetch the " +
  "structure so the viewer and this computation use the same coordinates.";

const pocketFinderSchema = z.object({
  pdbText: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().optional(),
  structureRef: z.string().optional(),
  targetIndex: z.union([z.number(), z.string()]).optional(),
  mutIndex: z.union([z.number(), z.string()]).optional(),
  targetChain: z.string().optional()
}).refine(data => data.pdbText !== undefined || data.pdbRef !== undefined || data.uniprotId !== undefined || data.structureRef !== undefined, {
  message: "Either pdbText, pdbRef, uniprotId, or structureRef must be specified."
}).refine(data => data.targetIndex !== undefined || data.mutIndex !== undefined, {
  message: "Either targetIndex or mutIndex must be specified."
});

const nearestResiduesSchema = z.object({
  pdbText: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().optional(),
  structureRef: z.string().optional(),
  targetIndex: z.union([z.number(), z.string()]),
  targetChain: z.string().optional(),
  distanceThreshold: z.union([z.number(), z.string()]).refine(
    value => Number(value) > 0,
    "distanceThreshold must be positive"
  ).optional(),
  n: z.union([z.number(), z.string()]).optional()
}).refine(data => data.pdbText !== undefined || data.pdbRef !== undefined || data.uniprotId !== undefined || data.structureRef !== undefined, {
  message: "Either pdbText, pdbRef, uniprotId, or structureRef must be specified."
});

export function registerPocketRoutes(apiRouter: Router, jsonParserPdb: any): void {

  const pocketHandler = async (req: any, res: any) => {
    const parseResult = pocketFinderSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { targetIndex, mutIndex, targetChain, pdbRef, uniprotId } = parseResult.data;
      const input = await resolveStructureInput(parseResult.data);
      if (isUnresolvedStructureRef(input)) {
        sendError(res, 409, "STALE_STRUCTURE_REF", STALE_STRUCTURE_REF_MESSAGE);
        return;
      }
      const pdbText = input?.pdbText ?? null;
      const structureResolution = input?.resolution;

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
          const ref = (pdbRef || uniprotId || "").trim();
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
        const requester = submitterId(req);
        const pocketKey = pocketResultCacheKey(effectivePdbText, mutIndexVal, effectiveTargetChain);
        let queueJobId: string;
        try {
          /**
           * Shared cache and de-duplication (WP-E), in the order that costs least:
           *   1. a stored result this person may be served → answered as an already-completed job,
           *      so the client's polling is unchanged and no queue slot is used;
           *   2. the same run already queued or running (anyone's) → join it;
           *   3. otherwise enqueue, as the leader that others may join.
           * Joining makes this person a watcher, so their cancel never stops the run for the others.
           */
          const cached = pocketCache.get(pocketKey);
          if (cached && mayServe(cached, requester ?? null)) {
            queueJobId = jobId;
            await queue.addCompletedJob(queueJobId, "p2rank", { mutIndex: mutIndexVal, targetChain: effectiveTargetChain, fromCache: true }, cached);
          } else {
            const submission = await pocketJobRegistry.submitOrJoin({
              cacheKey: pocketKey,
              queue,
              enqueue: () => queue.pushJob("p2rank", { pdbText: effectivePdbText, mutIndex: mutIndexVal, targetChain: effectiveTargetChain, jobDir }, {
                ownerId: requester,
                limits: submitterLimits(req),
                residues: countResidues(effectivePdbText),
                placementPref: submitterPlacementPref(req),
              }),
            });
            queueJobId = submission.queueJobId;
            if (requester) queue.addWatcher(queueJobId, requester);
          }
        } catch (queueErr: any) {
          if (queueErr instanceof QueueLimitError || queueErr instanceof AdmissionError) {
            sendError(res, queueErr.status, queueErr.code, queueErr.message);
            return;
          }
          if (queueErr.message.includes("BUSY")) {
            sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Queue limit reached.");
            return;
          }
          throw queueErr;
        }

        res.json({
          status: "queued",
          pocketJobId: queueJobId,
          // Which bytes this job was queued on. The result itself comes back through the job route,
          // so this echo is the only place the queued call can state its structure provenance.
          structureResolution
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
        result: withProvenanceFor(jobInfo.result, submitterId(req)),
        error: jobInfo.error,
        // Where it stands while it waits, in the order the scheduler will really start jobs.
        queuedAhead: jobInfo.status === "queued" ? await queue.getQueuePosition(jobId) : null
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
        result: withProvenanceFor(jobInfo.result, submitterId(req)),
        error: jobInfo.error,
        // Where it stands while it waits, in the order the scheduler will really start jobs.
        queuedAhead: jobInfo.status === "queued" ? await queue.getQueuePosition(jobId) : null
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
      const { targetIndex, targetChain } = parseResult.data;
      const input = await resolveStructureInput(parseResult.data);
      if (isUnresolvedStructureRef(input)) {
        sendError(res, 409, "STALE_STRUCTURE_REF", STALE_STRUCTURE_REF_MESSAGE);
        return;
      }
      const pdbText = input?.pdbText ?? null;
      const structureResolution = input?.resolution;
      const distanceThreshold = parseResult.data.distanceThreshold !== undefined
        ? Number(parseResult.data.distanceThreshold)
        : null;
      let n = parseResult.data.n !== undefined ? Number(parseResult.data.n) : 5;

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
        source: "computed",
        // Which exact bytes these distances were measured on — the audit trail that makes the
        // contact map reproducible and lets a caller prove it was not re-resolved by accession.
        structureResolution
      });
    } catch (err: any) {
      console.error("Nearest residues calculation failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "An error occurred while computing nearest residues.");
    }
  });
}
