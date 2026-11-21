import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CONFIG, resolvePpiLookupBudgetMs } from "../config.ts";
import { CLIENT_PPI_LOOKUP_BUDGET_MS } from "../../src/shared/timeouts.ts";

/**
 * The PPI lookup budgets must NEST across client and server.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `POST /api/v1/ppi/binding-affinity` used to run STRING, UniProt features, and IntAct in parallel
 * with no shared server deadline (`fetchIntactEvidence` alone had a 20 s timeout x 3 retries = 63 s),
 * while both client callers (`fetchProgressivePpi` and `useInterfacesData`) relied on
 * `fetchWithRetry`'s 60 s default timeout. When one upstream (e.g., IntAct) stalled, the client
 * aborted at 60 s, retried, and threw away partial STRING/UniProt results that had already settled.
 *
 * The server now bounds the whole `analyzePpiBinding` lookup stage with
 * `CONFIG.timeouts.ppiLookupBudgetMs`, and both client callers use `CLIENT_PPI_LOOKUP_BUDGET_MS`,
 * which strictly outlasts the server budget while remaining bounded.
 */

const SEC = 1000;

describe("PPI lookup timeout budgets nest", () => {
  it("keeps the client budget strictly larger than the server lookup budget", () => {
    expect(
      CLIENT_PPI_LOOKUP_BUDGET_MS,
      `client budget (${CLIENT_PPI_LOOKUP_BUDGET_MS / SEC}s) must exceed server ppiLookupBudgetMs ` +
        `(${CONFIG.timeouts.ppiLookupBudgetMs / SEC}s) so partial degradation settles before the client retries`
    ).toBeGreaterThan(CONFIG.timeouts.ppiLookupBudgetMs);
  });

  it("bounds the client spinner below the old 60 s default", () => {
    expect(CONFIG.timeouts.ppiLookupBudgetMs).toBeGreaterThan(0);
    expect(CLIENT_PPI_LOOKUP_BUDGET_MS).toBeLessThanOrEqual(60 * SEC);
  });

  it("clamps PPI_LOOKUP_BUDGET_MS env overrides strictly below the client budget", () => {
    expect(resolvePpiLookupBudgetMs(undefined)).toBe(35_000);
    expect(resolvePpiLookupBudgetMs("0")).toBe(35_000);
    expect(resolvePpiLookupBudgetMs("-500")).toBe(35_000);
    expect(resolvePpiLookupBudgetMs("not-a-number")).toBe(35_000);
    expect(resolvePpiLookupBudgetMs("20000")).toBe(20_000);
    expect(resolvePpiLookupBudgetMs(String(CLIENT_PPI_LOOKUP_BUDGET_MS))).toBeLessThan(CLIENT_PPI_LOOKUP_BUDGET_MS);
    expect(resolvePpiLookupBudgetMs("120000")).toBeLessThan(CLIENT_PPI_LOOKUP_BUDGET_MS);
  });

  it("uses CONFIG.timeouts.ppiLookupBudgetMs inside the server PPI lookup service", () => {
    const serverSource = fs.readFileSync(
      path.join(process.cwd(), "server", "services", "external-api", "ppi.ts"),
      "utf-8"
    );
    expect(serverSource).toContain("CONFIG.timeouts.ppiLookupBudgetMs");
  });
});
