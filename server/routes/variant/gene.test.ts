import { describe, it, expect, vi, beforeEach } from "vitest";
import { GENE_RESOLVE_BUDGET_MS, CLIENT_GENE_RESOLVE_BUDGET_MS } from "../../../src/shared/structureLookupBudgets.ts";

const resolveGeneToUniprot = vi.fn();
const fetchAlphafoldPdb = vi.fn();

vi.mock("../../services/external.ts", () => ({ resolveGeneToUniprot, fetchAlphafoldPdb }));

const { registerGeneRoutes } = await import("./gene.ts");

/** Runs the real handler with a fake router and a fake response, and returns what was sent. */
const post = async (body: unknown) => {
  let handler: any;
  registerGeneRoutes({ post: (_path: string, _parser: unknown, h: unknown) => { handler = h; } } as any, {});
  const sent: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { sent.status = code; return this; },
    json(payload: unknown) { sent.body = payload; return this; }
  };
  await handler({ body, headers: {} }, res);
  return sent;
};

describe("POST /resolve-gene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers from the accession lookup alone and never downloads a structure", async () => {
    resolveGeneToUniprot.mockResolvedValue("P43694");
    const sent = await post({ gene: "GATA4" });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ gene: "GATA4", uniprotId: "P43694" });
    expect(fetchAlphafoldPdb).not.toHaveBeenCalled();
  });

  it("gives the lookup a deadline that is shorter than the browser's wait, without cancelling its shared fill", async () => {
    resolveGeneToUniprot.mockResolvedValue("P43694");
    await post({ gene: "GATA4" });
    // No signal (the shared fill is not cancelled) and no `cappedByCaller`: the fill's 15 s timeout is a limit on
    // UniProt, so a UniProt that hangs that long must count against the per-host breaker.
    expect(resolveGeneToUniprot.mock.calls[0]).toEqual(["GATA4"]);
    expect(CLIENT_GENE_RESOLVE_BUDGET_MS).toBeGreaterThan(GENE_RESOLVE_BUDGET_MS);
  });

  it("reports a timeout as a timeout, not as an unknown gene", async () => {
    vi.useFakeTimers();
    resolveGeneToUniprot.mockReturnValue(new Promise(() => { /* never settles */ }));
    const pending = post({ gene: "GATA4" });
    await vi.advanceTimersByTimeAsync(GENE_RESOLVE_BUDGET_MS + 1);
    const sent = await pending;
    vi.useRealTimers();
    expect(sent.status).toBe(504);
    expect(sent.body.error.code).toBe("TIMEOUT");
  });

  it("still answers 404 when the gene is simply unknown", async () => {
    resolveGeneToUniprot.mockResolvedValue(null);
    const sent = await post({ gene: "NOTAGENE" });
    expect(sent.status).toBe(404);
  });
});
