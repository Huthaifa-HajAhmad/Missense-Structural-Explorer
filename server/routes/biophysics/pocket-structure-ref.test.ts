import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import { clearAllCaches } from "../../services/cache.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";
import {
  registerStructureReference,
  resolveStructureReference,
  clearStructureReferences,
} from "../../services/structure/structure-reference-store.ts";
import { isStructureRef } from "../../../src/shared/structureRefs.ts";

/**
 * Scoped structure references on the pocket/nearest routes.
 *
 * These tests pin the two properties the feature exists for, in both directions:
 *   1. A reference lets the routes compute on the EXACT bytes the server returned, with no PDB
 *      upload at all — and never by silently re-resolving the accession into another template.
 *   2. Everything the old contract promised still works: a local upload, the legacy accession path,
 *      and a reference that has been evicted (recoverable by re-sending the text, otherwise a safe
 *      refusal rather than a wrong answer).
 */

/** Residues 1..4 with known geometry: 1→2 = 1.73 Å, 1→3 = 6.93 Å, 1→4 = 15.59 Å. */
const DISPLAYED_PDB = [
  "ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C",
  "ATOM      2  CA  ALA A   2      2.000   2.000   2.000  1.00  0.00           C",
  "ATOM      3  CA  VAL A   3      5.000   5.000   5.000  1.00  0.00           C",
  "ATOM      4  CA  LEU A   4     10.000  10.000  10.000  1.00  0.00           C",
].join("\n");

/** What the 3-tier resolver WOULD answer: a different molecule, far from the displayed one. */
const RESOLVER_TEMPLATE_PDB = [
  "ATOM      1  CA  ASP A   1    100.000 100.000 100.000  1.00  0.00           C",
  "ATOM      2  CA  ALA A   2    101.000 100.000 100.000  1.00  0.00           C",
  "ATOM      3  CA  VAL A   3    102.000 100.000 100.000  1.00  0.00           C",
].join("\n");

function makeRes() {
  const out: any = { statusCode: 200, body: null, headers: {} as Record<string, string> };
  out.status = (code: number) => { out.statusCode = code; return out; };
  out.json = (body: any) => { out.body = body; return out; };
  out.setHeader = (name: string, value: string) => { out.headers[name] = value; return out; };
  out.send = (body: any) => { out.body = body; return out; };
  return out;
}

function handlerFor(path: string) {
  const route: any = apiRouter.stack.find((s: any) => s.route && s.route.path === path);
  if (!route?.route) throw new Error(`Route ${path} not found`);
  return route.route.stack[route.route.stack.length - 1].handle as (req: any, res: any, next?: any) => Promise<void>;
}

const nearestHandler = () => handlerFor("/nearest-residues");
const pocketHandler = () => handlerFor("/pocket-detect");

describe("structure references on pocket / nearest-residues", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllCaches();
    clearStructureReferences();
    try {
      BiophysicalJobQueue.initialize(2, async () => ({}));
    } catch (_) {}
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("/nearest-residues", () => {
    it("computes from an exact server reference without receiving any PDB text", async () => {
      const resolver = await import("../../services/structure-resolver.ts");
      const resolveSpy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue({
        pdbText: RESOLVER_TEMPLATE_PDB,
        provenance: { source: "experimental", pdbId: "1XXX" },
      } as any);

      const ref = registerStructureReference(DISPLAYED_PDB, {
        origin: "server",
        uniprotId: "P00439",
        source: "alphafold",
        afdbVersion: "v6",
      });
      expect(isStructureRef(ref)).toBe(true);

      const res = makeRes();
      await nearestHandler()({
        body: { structureRef: ref, targetIndex: 1, n: 2, pdbRef: "P00439" },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.residues.map((r: any) => r.name)).toEqual(["ALA", "VAL"]);
      expect(res.body.residues[0].distance).toBeCloseTo(1.73, 1);
      expect(res.body.residues[1].distance).toBeCloseTo(6.93, 1);
      // The whole point: the answer came from the reference's bytes, not from re-resolving P00439.
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(res.body.structureResolution).toEqual({
        resolvedFrom: "structureRef",
        structureRef: ref,
        source: "alphafold",
        pdbId: undefined,
        chainId: undefined,
      });
    });

    it("keeps the displayed structure when text and an accession are both supplied", async () => {
      // The regression this guards: the nearest path used to send ONLY `pdbRef: <accession>` when the
      // accession was known, so the server re-resolved it and could measure a homolog instead.
      const resolver = await import("../../services/structure-resolver.ts");
      const resolveSpy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue({
        pdbText: RESOLVER_TEMPLATE_PDB,
        provenance: { source: "experimental", pdbId: "1XXX" },
      } as any);

      const res = makeRes();
      await nearestHandler()({
        body: { pdbText: DISPLAYED_PDB, pdbRef: "P00439", uniprotId: "P00439", targetIndex: 1, n: 3 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.residues.map((r: any) => r.name)).toEqual(["ALA", "VAL", "LEU"]);
      expect(res.body.residues[2].distance).toBeCloseTo(15.59, 1);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(res.body.structureResolution?.resolvedFrom).toBe("pdbText");
    });

    it("still computes a local upload that has no reference (upload fallback)", async () => {
      const res = makeRes();
      await nearestHandler()({
        body: { pdbText: DISPLAYED_PDB, targetIndex: 1, n: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.residues[0].name).toBe("ALA");
      expect(res.body.structureResolution?.resolvedFrom).toBe("pdbText");
    });

    it("prefers the caller's text when it disagrees with the reference", async () => {
      const otherText = [
        "ATOM      1  CA  ASP A   1      0.000   0.000   0.000  1.00  0.00           C",
        "ATOM      2  CA  ALA A   2      3.000   0.000   0.000  1.00  0.00           C",
      ].join("\n");
      const ref = registerStructureReference(DISPLAYED_PDB, { origin: "server", uniprotId: "P00439" })!;

      const res = makeRes();
      await nearestHandler()({
        body: { structureRef: ref, pdbText: otherText, targetIndex: 1, n: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.residues[0].distance).toBeCloseTo(3, 2);
      expect(res.body.structureResolution).toEqual({ resolvedFrom: "pdbText", refTextMismatch: true });
    });

    it("recovers an evicted reference from the caller's text exactly once", async () => {
      const resolver = await import("../../services/structure-resolver.ts");
      const resolveSpy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue({
        pdbText: RESOLVER_TEMPLATE_PDB,
        provenance: { source: "experimental", pdbId: "1XXX" },
      } as any);

      const ref = registerStructureReference(DISPLAYED_PDB, { origin: "server", uniprotId: "P00439" })!;
      clearStructureReferences();
      expect(resolveStructureReference(ref)).toBeNull();

      const res = makeRes();
      await nearestHandler()({
        body: { structureRef: ref, pdbText: DISPLAYED_PDB, targetIndex: 1, n: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.residues[0].distance).toBeCloseTo(1.73, 1);
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it("refuses an evicted reference with no text instead of resolving the accession", async () => {
      const resolver = await import("../../services/structure-resolver.ts");
      const resolveSpy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue({
        pdbText: RESOLVER_TEMPLATE_PDB,
        provenance: { source: "experimental", pdbId: "1XXX" },
      } as any);

      const ref = registerStructureReference(DISPLAYED_PDB, { origin: "server", uniprotId: "P00439" })!;
      clearStructureReferences();

      const res = makeRes();
      await nearestHandler()({
        body: { structureRef: ref, pdbRef: "P00439", targetIndex: 1, n: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe("STALE_STRUCTURE_REF");
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it("rejects a malformed reference safely", async () => {
      const res = makeRes();
      await nearestHandler()({
        body: { structureRef: "sref1_not-a-real-reference", targetIndex: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe("STALE_STRUCTURE_REF");
    });

    /**
     * The provenance echo must be a property of the REFERENCE, not of whichever registration of
     * those bytes happened last.
     *
     * Identical bytes can legitimately be served under different provenance — chain B of an
     * experimental entry renumbered to UniProt versus the AlphaFold model, or the same text reached
     * through two routes. While the store keyed on the text alone and rewrote `identity` on every
     * registration, the second registration silently re-labelled the first reference, so a request
     * about one structure could be echoed as another. The reference now commits to one context.
     */
    it("keeps each reference's own provenance when identical bytes are registered twice", async () => {
      const chainBIdentity = {
        origin: "server" as const,
        uniprotId: "P00439",
        source: "experimental",
        pdbId: "9QN5",
        chainId: "B",
        numbering: "uniprot",
      };
      const alphafoldIdentity = {
        origin: "server" as const,
        uniprotId: "P00439",
        source: "alphafold",
        afdbVersion: "v6",
      };

      const refChainB = registerStructureReference(DISPLAYED_PDB, chainBIdentity)!;
      const refAlphafold = registerStructureReference(DISPLAYED_PDB, alphafoldIdentity)!;

      // A different provenance is a different reference…
      expect(refChainB).not.toBe(refAlphafold);
      // …while exactness is untouched: both name the very same bytes.
      expect(resolveStructureReference(refChainB)?.pdbText).toBe(DISPLAYED_PDB);
      expect(resolveStructureReference(refAlphafold)?.pdbText).toBe(DISPLAYED_PDB);
      // Same bytes under the same provenance stay a single, stable reference.
      expect(registerStructureReference(DISPLAYED_PDB, chainBIdentity)).toBe(refChainB);
      // And the first record was not rewritten by the second registration.
      expect(resolveStructureReference(refChainB)?.identity.chainId).toBe("B");

      const first = makeRes();
      await nearestHandler()({
        body: { structureRef: refChainB, targetIndex: 1, n: 1 },
        headers: {},
      }, first, () => {});
      expect(first.body.structureResolution).toEqual({
        resolvedFrom: "structureRef",
        structureRef: refChainB,
        source: "experimental",
        pdbId: "9QN5",
        chainId: "B",
      });

      const second = makeRes();
      await nearestHandler()({
        body: { structureRef: refAlphafold, targetIndex: 1, n: 1 },
        headers: {},
      }, second, () => {});
      expect(second.body.structureResolution).toEqual({
        resolvedFrom: "structureRef",
        structureRef: refAlphafold,
        source: "alphafold",
      });
    });
  });

  describe("/pocket-detect", () => {
    it("queues a job from a reference alone, echoing which structure it used", async () => {
      const ref = registerStructureReference(DISPLAYED_PDB, {
        origin: "server",
        uniprotId: "P00439",
        source: "experimental",
        pdbId: "6N7E",
        chainId: "A",
      })!;

      const res = makeRes();
      await pocketHandler()({
        body: { structureRef: ref, targetIndex: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("queued");
      expect(res.body.pocketJobId).toBeDefined();
      expect(res.body.structureResolution).toEqual({
        resolvedFrom: "structureRef",
        structureRef: ref,
        source: "experimental",
        pdbId: "6N7E",
        chainId: "A",
      });
    });

    it("refuses an evicted reference with no text", async () => {
      const ref = registerStructureReference(DISPLAYED_PDB, { origin: "server", uniprotId: "P00439" })!;
      clearStructureReferences();

      const res = makeRes();
      await pocketHandler()({
        body: { structureRef: ref, targetIndex: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(409);
      expect(res.body.error.code).toBe("STALE_STRUCTURE_REF");
    });

    it("still queues the legacy pdbRef path (unchanged contract)", async () => {
      const { pdbCache } = await import("../../services/cache.ts");
      pdbCache.set("P00439", DISPLAYED_PDB);

      const res = makeRes();
      await pocketHandler()({
        body: { pdbRef: "P00439", targetIndex: 1 },
        headers: {},
      }, res, () => {});

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("queued");
      expect(res.body.structureResolution?.resolvedFrom).toBe("uniprot-resolver");
    });
  });
});
