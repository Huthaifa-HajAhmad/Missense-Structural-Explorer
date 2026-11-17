import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { SIDECAR_BUDGET_HEADER, sidecarFailure } from "../services/infra/sidecar-budget.ts";
import { THERMOMPNN_SIDECAR_BUDGET } from "../services/stability/energy-models.ts";
import { BACKGROUND_REMOTE_TIMEOUT_MS } from "../routes/biophysics/generation.ts";
import { CLIENT_THERMOMPNN_RETRY_WAIT_MS } from "../../src/shared/timeouts.ts";
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
      ["server", "services", "external-api", "lmSidecar.ts"], // the shared call for ESM-2, ESM C and SaProt
      ["server", "services", "external-api", "esm3_forge.ts"],
      ["server", "services", "structure", "structural-diff", "evaluator.ts"],
      ["server", "services", "stability", "stabilityoracle.ts"],
      ["server", "services", "stability", "energy-models.ts"] // the local ThermoMPNN call
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

/**
 * The model server cannot stop a CPU pass that has already started, so a ThermoMPNN call waits behind
 * the ESM-2 passes of the same analysis. ThermoMPNN used one number for both "how long you may queue"
 * and "how long I wait for you", so the caller aborted in the same second the sidecar was about to
 * refuse and explain itself, and the reader saw a bare timeout instead of "busy, retrying usually
 * works". The budgets must nest in this order, or that defect returns.
 */
describe("ThermoMPNN budgets nest", () => {
  it("lets the sidecar answer before the caller gives up", () => {
    expect(
      THERMOMPNN_SIDECAR_BUDGET.budgetMs,
      "a budget at or above the wait means the caller aborts before the sidecar can refuse"
    ).toBeLessThan(THERMOMPNN_SIDECAR_BUDGET.waitMs);
  });

  it("keeps the sidecar wait below the analysis route's outer signal", () => {
    expect(
      THERMOMPNN_SIDECAR_BUDGET.waitMs,
      "the analysis route's background signal would abort the call before the sidecar could answer"
    ).toBeLessThan(BACKGROUND_REMOTE_TIMEOUT_MS);
  });

  it("waits past the sidecar's own answer on the retry route", () => {
    // `/thermompnn-submit` awaits the sidecar without an outer signal, so the client is the only
    // timer left; it must outlast the wait or a slow-but-valid retry reads as a client timeout.
    expect(CLIENT_THERMOMPNN_RETRY_WAIT_MS).toBeGreaterThan(THERMOMPNN_SIDECAR_BUDGET.waitMs);
  });

  it("sends the budget, not the wait, as the header", () => {
    expect(read("server", "services", "stability", "energy-models.ts")).toContain(
      "[SIDECAR_BUDGET_HEADER]: String(THERMOMPNN_SIDECAR_BUDGET_MS)"
    );
  });
});
