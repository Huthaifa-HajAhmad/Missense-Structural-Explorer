import crypto from "crypto";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRouter } from "../../routes.ts";
import * as externalServices from "../../services/external.ts";
import * as geminiService from "../../services/gemini.ts";
import { geminiCache } from "../shared.ts";
import {
  buildNarrativeEvidenceContract,
  canonicalNarrativeEvidence,
} from "../../../src/shared/narrativeEvidence.ts";
import { buildDeepModelEvidence } from "../../../src/shared/deepModelEvidence.ts";
import { ENGINE_OWNED_CODES } from "../../../src/shared/acmgCriteriaView.ts";
import { NARRATIVE_PROMPT_SCHEMA_VERSION } from "../../../src/shared/narrativeSynthesis.ts";

/**
 * The narrative cache key's EVIDENCE segment.
 *
 * WHY THIS EXISTS
 * ---------------
 * The key hashed the evidence VALUES and not the run's per-source OUTCOMES. A ClinVar TIMEOUT and a
 * ClinVar query that was never made both arrive as `clinvar: null`, so the two hashed identically —
 * while they produce different prompt text: `clinvarPresence` reads the status and tells the model the
 * query "did not complete, draw no conclusion" for one, and `unqueried` for the other. A narrative
 * written for the failed query was therefore servable to a run that never asked, and the cache
 * asserted the model had been told something it had not.
 *
 * The hash now comes from the shared contract (`src/shared/narrativeEvidence.ts`), which both client
 * paths also build their request from. These tests drive the real route handler and read the real
 * cache, so a regression in either direction — dropping `serviceStatus` from the hash, or re-inlining
 * a hand-written payload list — fails here rather than in a served narrative.
 */

const ROUTE_SOURCE = path.join(process.cwd(), "server", "routes", "variant", "narrative.ts");
const CLIENTSIDE_UNIPROT = "P00439";

function getNarrativeHandler(): any {
  const route: any = apiRouter.stack.find(
    (layer: any) => layer.route && layer.route.path === "/analyze-variant-narrative"
  );
  expect(route).toBeDefined();
  return route.route.stack[route.route.stack.length - 1].handle;
}

function makeRes() {
  const res: any = {
    writableEnded: false,
    statusCode: 200,
    body: undefined as any,
    json(body: any) {
      this.body = body;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    getHeader() {
      return undefined;
    },
    on() {
      return this;
    },
  };
  return res;
}

function makeReq(body: Record<string, unknown>) {
  return {
    body: { gene: "PAH", variant: "p.Arg408Trp", ...body },
    headers: {},
    on() {
      return this;
    },
  } as any;
}

/**
 * The key the route must have built for this body, from the shared contract and nothing else.
 *
 * Computed AFTER the handler has run, and mirroring the route's key derivation including its effective
 * credential: the workspace `.env` carries a real `GEMINI_API_KEY`, so the key hash is that key's hash
 * and not the `no_key` sentinel. (No credential is asserted on here — only that the evidence segment
 * matches the shared contract.)
 */
function expectedCacheKey(body: Record<string, unknown>): string {
  const envKey =
    process.env.GEMINI_API_KEY && !geminiService.isGeminiApiKeyPlaceholder(process.env.GEMINI_API_KEY)
      ? process.env.GEMINI_API_KEY
      : undefined;
  const keyHash = crypto.createHash("sha256").update(envKey || "no_key").digest("hex");
  const evidenceHash = crypto
    .createHash("sha256")
    .update(canonicalNarrativeEvidence(buildNarrativeEvidenceContract(body as any)))
    .digest("hex");
  const model = geminiService.getConfiguredGeminiModels()[0];
  return (
    `clinical_${CLIENTSIDE_UNIPROT}_p.Arg408Trp_standard__${evidenceHash}` +
    `_key:${keyHash}_model:${model}_schema:v${NARRATIVE_PROMPT_SCHEMA_VERSION}`
  );
}

describe("narrative cache key — the evidence contract", () => {
  let analysisCallCount = 0;
  let resolveSpy: any;
  let geminiSpy: any;

  beforeEach(() => {
    geminiCache.clear();
    geminiService.resetModelHealth();
    analysisCallCount = 0;
    resolveSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue(CLIENTSIDE_UNIPROT);
    geminiSpy = vi
      .spyOn(geminiService, "performGeminiAnalysis")
      .mockImplementation((async () => {
        analysisCallCount++;
        return {
          analysis: "Narrative output",
          insights: { biochemicalShift: "s", structuralImpact: "i", plausibility: "p", acmgCriteria: [] },
        } as any;
      }) as any);
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    geminiSpy.mockRestore();
  });

  it("hashes the key from the shared contract, so the client's revision describes the same evidence", async () => {
    const handler = getNarrativeHandler();
    /*
     * `aouLookup` is in the body deliberately: it is evidence the fallback prose reads, so the route
     * must hash it exactly as the client does. Without it here this test passes while the two sides
     * disagree — which is how it was first written.
     */
    const body = {
      serviceStatus: { clinvar: "timeout" },
      aouFrequency: { aouAC: 1, aouAN: 1000 },
      aouLookup: { localTable: "found", remoteDbnsfp: "not-reported" },
    };

    await handler(makeReq(body), makeRes(), () => {});

    // The entry exists under the key the CLIENT-side contract predicts — the whole point of one
    // declaration: a run has one evidence identity, not one per control the reader pressed.
    expect(geminiCache.get(expectedCacheKey(body))).toBeTruthy();
  });

  it("separates a failed source from an absent one", async () => {
    const handler = getNarrativeHandler();

    await handler(makeReq({ serviceStatus: { clinvar: "timeout" } }), makeRes(), () => {});
    expect(geminiCache.size).toBe(1);

    // The SAME body is served from the cache rather than re-synthesized.
    await handler(makeReq({ serviceStatus: { clinvar: "timeout" } }), makeRes(), () => {});
    expect(geminiCache.size).toBe(1);
    expect(analysisCallCount).toBe(1);

    // No status at all is different evidence: `clinvarPresence` reads `unqueried`, not `unread`.
    await handler(makeReq({}), makeRes(), () => {});
    expect(geminiCache.size).toBe(2);
    expect(analysisCallCount).toBe(2);

    // A completed query that holds nothing is a third state.
    await handler(makeReq({ serviceStatus: { clinvar: "ok" } }), makeRes(), () => {});
    expect(geminiCache.size).toBe(3);
  });

  it("hashes the allele-frequency evidence the fallback report reads", async () => {
    const handler = getNarrativeHandler();

    // `aouFrequency` was accepted by the request schema, read by the route's frequency sentence, and
    // forwarded by no client path — so two runs with different AoU evidence shared one key.
    await handler(makeReq({}), makeRes(), () => {});
    await handler(makeReq({ aouFrequency: { aouAC: 1, aouAN: 1000 } }), makeRes(), () => {});
    await handler(makeReq({ aouFrequency: { aouAC: 2, aouAN: 1000 } }), makeRes(), () => {});

    expect(geminiCache.size).toBe(3);
  });

  it("builds the key from the shared contract rather than a list written in the route", () => {
    const source = fs.readFileSync(ROUTE_SOURCE, "utf-8");
    expect(source).toContain("buildNarrativeEvidenceContract");
    expect(source).toContain("canonicalNarrativeEvidence");
    // The shape that dropped `serviceStatus`: a hand-written payload hashed with JSON.stringify.
    expect(source).not.toMatch(/JSON\.stringify\(evidencePayload\)/);
  });

  it("forwards the validated deep-model block to the synthesis, and hashes it", async () => {
    const handler = getNarrativeHandler();
    const deepEvidence = buildDeepModelEvidence({
      stability: {
        foldingEnergetics: { foldx: 2.62, structureProvenance: { source: "experimental", pdbId: "1abc" } },
        dynamut2Status: "done",
      },
    });

    await handler(makeReq({ deepEvidence }), makeRes(), () => {});

    // Position 16 of `performGeminiAnalysis`: the engine receives the validated block, not `req.body`.
    const forwarded = geminiSpy.mock.calls[0][15];
    expect(forwarded.version).toBe(deepEvidence.version);
    expect(forwarded.observations.map((o: any) => o.id)).toEqual(deepEvidence.observations.map(o => o.id));
    expect(forwarded.observations.find((o: any) => o.id === "foldx").value).toBe(2.62);

    // The block is part of the evidence the key describes: a run whose ΔΔG arrived after a synthesis
    // must not be served that synthesis.
    expect(geminiCache.size).toBe(1);
    await handler(makeReq({}), makeRes(), () => {});
    expect(geminiCache.size).toBe(2);
    await handler(makeReq({ deepEvidence }), makeRes(), () => {});
    expect(geminiCache.size).toBe(2);
    expect(analysisCallCount).toBe(2);
  });

  it("refuses a deep-model block that does not describe this app's models", async () => {
    const handler = getNarrativeHandler();
    const valid = buildDeepModelEvidence({ stability: { foldingEnergetics: { foldx: 2.62 } } });
    const res = makeRes();

    await handler(
      makeReq({
        deepEvidence: {
          version: valid.version,
          observations: [{ ...valid.observations[0], id: "rosetta" }],
        },
      }),
      res,
      () => {}
    );

    expect(res.statusCode).toBe(400);
    expect(geminiSpy).not.toHaveBeenCalled();
    expect(geminiCache.size).toBe(0);
  });

  it("still refuses to count a model criterion the rule engine owns, deep evidence or not", async () => {
    /*
     * The other half of "predictions must not double-count ACMG". Sending a ΔΔG invites the model to
     * propose PS3 for it (the prompt forbids it and says why); this asserts the server-side
     * reconciliation still drops a proposal for a code the engine evaluates itself, so a criterion
     * cannot be counted twice even if one gets through.
     */
    const handler = getNarrativeHandler();
    geminiSpy.mockResolvedValue({
      analysis: "Narrative",
      insights: {
        biochemicalShift: "s",
        structuralImpact: "i",
        plausibility: "p",
        // PP3 is engine-owned (the rule engine evaluates it); PS3 is not.
        acmgCriteria: [
          { code: "PP3", reason: "predictors agree" },
          { code: "PS3", reason: "FoldX ΔΔG is destabilizing" },
        ],
      },
    } as any);

    const res = makeRes();
    await handler(
      makeReq({ deepEvidence: buildDeepModelEvidence({ stability: { foldingEnergetics: { foldx: 3.1 } } }) }),
      res,
      () => {}
    );

    const criteria: any[] = res.body.insights.acmgCriteria;
    expect(criteria.some(c => c.source === "ai_suggested" && ENGINE_OWNED_CODES.has(c.code))).toBe(false);
    expect(criteria.some(c => c.code === "PS3" && c.source === "ai_suggested")).toBe(true);
  });
});
