import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The import route on its own, with the service isolated.
 *
 * WHY A SEPARATE FILE. `structure.test.ts` finds the registered handler and exercises the body errors;
 * it cannot prove the handler *reaches the service with the reader's text* without stubbing the whole
 * UniProt/PDBe fetch surface. Mocking the service is the smallest honest instrument for that, and the
 * mock must live beside the assertions rather than leaking into the shared route file.
 */

const { importMock } = vi.hoisted(() => ({ importMock: vi.fn() }));
vi.mock("../services/multimer.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/multimer.ts")>();
  return { ...actual, importMultimerModel: importMock };
});

const { apiRouter } = await import("../routes.ts");

function importHandler(): (req: any, res: any) => Promise<void> {
  const route = apiRouter.stack.find(
    s => s.route && (s.route.path === "/structure/multimer/import"
      || (Array.isArray(s.route.path) && s.route.path.includes("/structure/multimer/import")))
  );
  expect(route).toBeDefined();
  return route!.route!.stack[route!.route!.stack.length - 1].handle as any;
}

function respondWith() {
  const state: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(code: number) { state.status = code; return this; },
    json(data: any) { state.body = data; return this; },
  };
  return { state, res };
}

describe("POST /structure/multimer/import — reaches the service", () => {
  beforeEach(() => {
    importMock.mockReset();
  });

  it("passes the reader's model through and returns the service's payload", async () => {
    const payload = { status: "success", provenance: "Boltz-2 via LocalFold (browser)" };
    importMock.mockResolvedValue(payload);
    const { state, res } = respondWith();

    await importHandler()(
      { body: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", structure: "ATOM      1  CA  GLY A 116       0.000   0.000   0.000\n" } },
      res
    );

    expect(importMock).toHaveBeenCalledWith(
      "NAE1",
      "p.Asp116Gly",
      "Q13564",
      expect.stringContaining("ATOM"),
      // An abort signal, so a reader who navigates away stops the lookups.
      expect.anything()
    );
    expect(state.status).toBe(200);
    expect(state.body).toBe(payload);
  });

  it("refuses an invalid gene before the service is called", async () => {
    const { state, res } = respondWith();
    await importHandler()(
      { body: { gene: "NAE1; DROP TABLE", variant: "p.Asp116Gly", uniprotId: "Q13564", structure: "ATOM" } },
      res
    );
    expect(state.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("refuses a body with no model text", async () => {
    const { state, res } = respondWith();
    await importHandler()(
      { body: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564" } },
      res
    );
    expect(state.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });
});
