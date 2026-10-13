import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { registerCapabilitiesRoutes, resetJapanFoldProbeForTests } from "./capabilities.ts";
import { governedFetch } from "../services/infra/http-client.ts";
import { resetEgressGovernorForTests } from "../services/infra/egress-governor.ts";
import { recordRateLimit, resetProviderPausesForTests } from "../services/infra/provider-pause.ts";

/**
 * `/capabilities` is public. WP-I1's review found it (a) naming every host the governor had seen,
 * including a person's own AlphaGenome/GPN server, and (b) probing JapanFold on every request, so any
 * visitor could make the server call a shared provider as often as the API limiter allowed.
 */

let server: Server;
let baseUrl: string;
const realFetch = globalThis.fetch;
let japanFoldCalls = 0;
const savedMode = process.env.EGRESS_GOVERNOR;

beforeAll(async () => {
  const app = express();
  const router = express.Router();
  registerCapabilitiesRoutes(router);
  app.use("/api", router);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  process.env.EGRESS_GOVERNOR = "shadow";
  resetEgressGovernorForTests();
  resetProviderPausesForTests();
  resetJapanFoldProbeForTests();
  japanFoldCalls = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
    if (url.includes("japanfold")) japanFoldCalls++;
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedMode === undefined) delete process.env.EGRESS_GOVERNOR;
  else process.env.EGRESS_GOVERNOR = savedMode;
});

async function capabilities(): Promise<any> {
  const res = await realFetch(`${baseUrl}/api/capabilities`, { headers: { "x-biohub-token": "tok-SECRET-9" } });
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /capabilities — egress", () => {
  it("names the deployment's own providers and folds a person's own endpoint into an unnamed count", async () => {
    await governedFetch("https://rest.ensembl.org/info/ping", { headers: { Authorization: "Bearer tok-SECRET-9" } });
    await governedFetch("https://my-lab-alphagenome.example.edu/v1/predict?api_key=tok-SECRET-9");
    recordRateLimit("my-lab-alphagenome.example.edu", 429, "3");
    recordRateLimit("rest.ensembl.org", 429, "3");

    const body = await capabilities();
    const text = JSON.stringify(body.egress);
    expect(text).not.toContain("my-lab-alphagenome");
    expect(text).not.toContain("tok-SECRET-9");
    expect(body.egress.mode).toBe("shadow");
    expect(body.egress.providers.map((p: any) => p.hostname)).toEqual(["rest.ensembl.org"]);
    expect(body.egress.providers[0].limitBasis).toBe("documented");
    expect(body.egress.otherPausedOrRateLimitedHosts).toBe(1);
    const ids = body.egress.governor.map((p: any) => p.id);
    expect(ids).toEqual(["ensembl", "other"]);
  });

  it("checks JapanFold at most once a minute, however often the page is read", async () => {
    await capabilities();
    await capabilities();
    await capabilities();
    expect(japanFoldCalls).toBe(1);
  });
});
