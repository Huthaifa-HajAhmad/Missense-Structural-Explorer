import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../../routes.ts";
import { requestLogger, validateContentType } from "../../middleware.ts";
import { PUBLIC_ENDPOINTS } from "../state.ts";

// The handler's own logic is covered in spliceai.test.ts. This file runs the REAL router and middleware, because
// what that test cannot see is the part that protects a rate-limited third-party service: authentication and the
// per-client limiter. Only the Broad client is mocked, so nothing here reaches the network.
vi.mock("../../services/external-api/spliceai_broad.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/external-api/spliceai_broad.ts")>();
  return {
    ...actual,
    fetchSpliceAiBroadOutcome: vi.fn(async () => ({
      record: null,
      failure: { kind: "rate-limited" as const, httpStatus: 429, detail: null },
    })),
  };
});

describe("POST /api/v1/spliceai/score through the real middleware", () => {
  const TOKEN = "test-token-fixed-length-32-chars-ok!";
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.APP_API_TOKEN = TOKEN;
    process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
    const app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.use(validateContentType);
    app.use("/api/v1", apiRouter);
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });
  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const post = (body: unknown, auth = true) =>
    fetch(`${baseUrl}/api/v1/spliceai/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify(body),
    });
  const valid = { coordinates: "16-67946177-C-G", assembly: "GRCh38", distance: 500 };

  it("is not a public endpoint: it calls a rate-limited third party, so it needs the app token", async () => {
    expect(PUBLIC_ENDPOINTS).not.toContain("/spliceai/score");
    expect(PUBLIC_ENDPOINTS).not.toContain("/api/v1/spliceai/score");
    expect((await post(valid, false)).status).toBe(401);
  });

  it("answers an authenticated request with the reason SpliceAI had no score", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.spliceai).toBeNull();
    expect(json.spliceaiFailure).toMatchObject({ kind: "rate-limited" });
  });

  // Last: the limiter is per client and shared by every analysis route, so this exhausts it.
  it("limits a client to 10 requests a minute, and says so rather than hammering the service", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post(valid)).status);
    expect(statuses).toContain(429);
    const limited = await post(valid);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
  });
});
