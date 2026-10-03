import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { apiRouter } from "../../routes.ts";
import * as externalServices from "../../services/external.ts";
import * as orchestrator from "../../services/analysis-orchestrator.ts";
import { PrewarmManager, PREWARM_OPT_IN_ENV } from "../../services/prewarm-manager.ts";
import { activeBackgroundTasks } from "../state.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE PRE-WARMING MAY BE INVOKED — asserted at the route, not at the manager
 * ─────────────────────────────────────────────────────────────────────────────
 * Two properties belong to the routes and cannot be asserted from the manager's own suite:
 *
 *   1. A deployment that has NOT opted in never reaches the prewarm at all. The manager would refuse
 *      anyway, but the route must not build the parameters or dispatch a speculative FoldX run —
 *      the interactive UI submits FoldX itself.
 *   2. The STREAMING route never prewarms. `/analyze-variant` and `/analyze-variant/stream` serve the
 *      same analysis to the same reader, so dispatching from both would enqueue a second speculative
 *      run for one visit. The standalone route is the single, deliberate invocation site.
 *
 * The route's own wiring is observed through the manager's prototype, so no module in the server's
 * import graph has to be replaced to run this.
 */
describe("prewarm invocation sites", () => {
  const originalEnv = { NODE_ENV: process.env.NODE_ENV, optIn: process.env[PREWARM_OPT_IN_ENV] };

  function handlerFor(path: string) {
    const route: any = apiRouter.stack.find((layer: any) => layer.route && layer.route.path === path);
    expect(route, `${path} is not registered`).toBeDefined();
    return route.route.stack[route.route.stack.length - 1].handle;
  }

  /** A minimal response double, matching the shape `analysis.test.ts` uses for these handlers. */
  function responseDouble() {
    const state: any = { code: 200, body: null, chunks: [] as string[], ended: false };
    return {
      state,
      res: {
        status(code: number) { state.code = code; return this; },
        json(body: any) { state.body = body; return this; },
        setHeader() {},
        flushHeaders() {},
        write(chunk: string) { state.chunks.push(chunk); return true; },
        end() { state.ended = true; },
        writableEnded: false
      }
    };
  }

  const coreResult: any = {
    ruleBasedInsights: { classification: "Uncertain Significance", criteria: [] },
    metadata: { gene: "PAH", variant: "p.Met1Val" },
    _internal: { pdbMapping: { pdbId: "1PAH", chainId: "A" } }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    activeBackgroundTasks.length = 0;
    delete process.env[PREWARM_OPT_IN_ENV];
    process.env.NODE_ENV = "test";
    vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
    vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("MAPTVR");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.optIn === undefined) delete process.env[PREWARM_OPT_IN_ENV];
    else process.env[PREWARM_OPT_IN_ENV] = originalEnv.optIn;
    activeBackgroundTasks.length = 0;
  });

  it("does not dispatch from /analyze-variant at the default configuration", async () => {
    process.env.NODE_ENV = "development"; // opt-in simply absent
    const prewarmSpy = vi.spyOn(PrewarmManager.prototype, "triggerPrewarm").mockResolvedValue();
    vi.spyOn(orchestrator, "runCoreAnalysis").mockResolvedValue(coreResult);

    const { res } = responseDouble();
    await handlerFor("/analyze-variant")({ body: { gene: "PAH", variant: "p.Met1Val" }, headers: {} }, res, () => {});

    expect(prewarmSpy).not.toHaveBeenCalled();
    expect(activeBackgroundTasks.length).toBe(0);
  });

  it("dispatches from the standalone route when the deployment opted in, carrying the numbering fact", async () => {
    process.env.NODE_ENV = "development";
    process.env[PREWARM_OPT_IN_ENV] = "true";
    const prewarmSpy = vi.spyOn(PrewarmManager.prototype, "triggerPrewarm").mockResolvedValue();
    vi.spyOn(orchestrator, "runCoreAnalysis").mockResolvedValue(coreResult);

    const { res } = responseDouble();
    await handlerFor("/analyze-variant")({ body: { gene: "PAH", variant: "p.Met1Val" }, headers: {} }, res, () => {});

    expect(prewarmSpy).toHaveBeenCalledTimes(1);
    const params = prewarmSpy.mock.calls[0][0] as any;
    expect(params.gene).toBe("PAH");
    expect(params.pdbMapping).toEqual({ pdbId: "1PAH", chainId: "A" });
    /**
     * The route must hand the prewarm the interpretation fact it HAS, and must not invent one: the
     * key is always present (possibly `undefined`), and `false` — the unverified-numbering case — is
     * what the manager refuses on.
     */
    expect(params.conditions).toHaveProperty("numberingVerified");
  });

  it("never prewarms from the streaming route, even with the opt-in enabled", async () => {
    process.env.NODE_ENV = "development";
    process.env[PREWARM_OPT_IN_ENV] = "true";
    const prewarmSpy = vi.spyOn(PrewarmManager.prototype, "triggerPrewarm").mockResolvedValue();
    vi.spyOn(orchestrator, "streamCoreAnalysis").mockImplementation(async (_ctx: any, onChunk: any) => {
      onChunk({ chunkIndex: 0, isFinal: true, data: { metadata: { gene: "PAH" } } });
      return { metadata: { gene: "PAH" } };
    });

    const { res } = responseDouble();
    await handlerFor("/analyze-variant/stream")(
      { body: { gene: "PAH", variant: "p.Met1Val" }, headers: {}, on: vi.fn() },
      res,
      () => {}
    );

    expect(prewarmSpy).not.toHaveBeenCalled();
    expect(activeBackgroundTasks.length).toBe(0);
  });

  it("keeps the prewarm call site in the standalone handler only", () => {
    // A source-level guard for the rule the test above can only observe for one configuration:
    // `triggerPrewarm` must appear in the `/analyze-variant` handler and nowhere else in the file.
    const source = fs.readFileSync(
      path.join(process.cwd(), "server", "routes", "variant", "analysis.ts"),
      "utf-8"
    );
    const standalone = source.slice(source.indexOf('"/analyze-variant"'), source.indexOf('"/analyze-variant/stream"'));
    const stream = source.slice(source.indexOf('"/analyze-variant/stream"'), source.indexOf('"/analyze-variant/landscape"'));

    expect(standalone).toContain("triggerPrewarm");
    expect(standalone).toContain("isPrewarmEnabled()");
    expect(stream).not.toContain("Prewarm");
    expect(source.split("triggerPrewarm").length - 1).toBe(1);
  });
});
