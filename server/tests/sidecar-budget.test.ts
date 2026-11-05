import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { SIDECAR_BUDGET_HEADER, sidecarFailure } from "../services/infra/sidecar-budget.ts";
import { stripCommentsForScan } from "../../src/shared/engineStatus.ts";

const read = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf-8");

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIDECAR MUST KNOW HOW LONG EACH CALLER WILL WAIT
 * ─────────────────────────────────────────────────────────────────────────────
 * The model server runs one CPU pass at a time and cannot stop a pass that has started. A request whose
 * caller already gave up used to stay queued and take its turn, so live requests waited behind dead
 * ones. The fix has two halves in two languages; this test fails if either half is edited alone.
 */
describe("sidecar budget header", () => {
  it("uses the same header name on both sides", () => {
    const python = read("tools", "model_server_app", "engine_resilience.py");
    const declared = python.match(/^BUDGET_HEADER\s*=\s*"([^"]+)"/m)?.[1];
    expect(declared, "engine_resilience.py must declare BUDGET_HEADER").toBeDefined();
    expect(declared!.toLowerCase()).toBe(SIDECAR_BUDGET_HEADER.toLowerCase());
  });

  it("is sent by every call whose caller times out on its own clock", () => {
    // Each of these gives up after a fixed time, so each must say so.
    const callers = [
      ["server", "services", "stability", "stabilityoracle.ts"]
    ];
    for (const parts of callers) {
      const source = stripCommentsForScan(read(...parts));
      expect(source, `${parts.join("/")} must send the budget header`).toContain("SIDECAR_BUDGET_HEADER");
    }
  });

  it("is installed on the model server", () => {
    expect(read("tools", "model_server.py")).toContain("app.add_middleware(BudgetHeaderMiddleware)");
  });

  it("is honoured by the CPU gate", () => {
    const python = read("tools", "model_server_app", "engine_resilience.py");
    expect(python).toContain("request_deadline.get()");
    expect(python).toContain("GateDeadlineExceeded");
  });

  /**
   * A refusal must not read as an absence. The gate answers `503`; a bare `500` (before this) was
   * mapped to `offline` by every caller, telling the reader the model server was gone when it had just
   * replied that it was busy.
   */
  it("turns a refused pass into a statement about being busy, not about being offline", () => {
    expect(sidecarFailure("ESM-2", 503)).toMatchObject({ status: "timeout" });
    expect(sidecarFailure("ESM-2", 503).error).toContain("busy");
    expect(sidecarFailure("ESM-2", 401)).toMatchObject({ status: "unauthorized" });
    expect(sidecarFailure("ESM-2", 403)).toMatchObject({ status: "unauthorized" });
    expect(sidecarFailure("ESM-2", 500)).toMatchObject({ status: "offline" });
  });

  it("answers the refusal with 503 on the server side, and installs that handler", () => {
    const python = read("tools", "model_server_app", "engine_resilience.py");
    expect(python).toContain("status_code=503");
    expect(python).toContain("GateDeadlineExceeded");
    expect(read("tools", "model_server.py")).toContain("register_refusal_handler(app)");
  });
});
