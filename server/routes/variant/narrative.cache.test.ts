import { beforeEach, describe, expect, it, vi } from "vitest";

/** The prompt version the route sees. A test changes it to stand in for a prompt edit. */
const promptVersion = vi.hoisted(() => ({ current: 1 }));
vi.mock("../../../src/shared/narrativeSynthesis.ts", async importOriginal => {
  const original = await importOriginal<typeof import("../../../src/shared/narrativeSynthesis.ts")>();
  return Object.defineProperty({ ...original }, "NARRATIVE_PROMPT_SCHEMA_VERSION", { get: () => promptVersion.current, enumerable: true });
});
vi.mock("../../services/llm/literature-summary.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../../services/llm/literature-summary.ts")>(),
  selectSummaryCitations: vi.fn(async () => ({ citations: [], scopes: { gene: "complete", variant: "complete", curated: "unavailable" }, withoutEmbeddings: 0 })),
}));
import { apiRouter } from "../../routes.ts";
import * as externalServices from "../../services/external.ts";
import * as geminiService from "../../services/gemini.ts";
import { geminiCache } from "../shared.ts";

/**
 * A narrative is cached for 24 hours. When the prompt changes, a cached narrative written under the old
 * prompt must not be served: the user would never see the fix.
 */
async function ask(): Promise<void> {
  const route: any = apiRouter.stack.find((layer: any) => layer.route?.path === "/analyze-variant-narrative");
  const handler = route.route.stack[route.route.stack.length - 1].handle;
  const req: any = { body: { gene: "PAH", variant: "p.Arg408Trp" }, headers: {}, on: () => req };
  const res: any = { writableEnded: false, json: () => res, getHeader: () => undefined, on: () => res };
  await handler(req, res, () => {});
}

describe("narrative cache and the prompt version", () => {
  const analysis = vi.spyOn(geminiService, "performGeminiAnalysis");

  beforeEach(() => {
    geminiCache.clear();
    promptVersion.current = 1;
    analysis.mockReset().mockResolvedValue({ analysis: "text", insights: { biochemicalShift: "", structuralImpact: "", plausibility: "unknown", acmgCriteria: [] } } as any);
    vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
  });

  it("serves the same request from the cache while the prompt is unchanged", async () => {
    await ask();
    await ask();
    expect(analysis).toHaveBeenCalledTimes(1);
  });

  it("writes the narrative again after the prompt version changes", async () => {
    await ask();
    promptVersion.current = 2;
    await ask();
    expect(analysis).toHaveBeenCalledTimes(2);
  });
});
