import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { PUBLIC_ENDPOINTS } from "./state.ts";

describe("HTTP Pipeline & Middleware Invariants (Tier 1)", () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  const TEST_API_TOKEN = "test-token-fixed-length-32-chars-ok!";
  const TEST_SESSION_SECRET = "test-session-secret-fixed-32-chars!";

  beforeAll(async () => {
    process.env.APP_API_TOKEN = TEST_API_TOKEN;
    process.env.APP_SESSION_SECRET = TEST_SESSION_SECRET;

    app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.use(validateContentType);

    // Mount apiRouter both at /api/v1 (production primary) and at root (legacy/internal)
    app.use("/api/v1", apiRouter);
    app.use(apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe("Public Endpoints Authentication Bypass", () => {
    it("GET /api/v1/capabilities should return 200 OK without requiring authentication", async () => {
      const res = await fetch(`${baseUrl}/api/v1/capabilities`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(Array.isArray(json.engines)).toBe(true);
      expect(json.engines.length).toBe(8);
    });

    it("GET /capabilities should return 200 OK without requiring authentication", async () => {
      const res = await fetch(`${baseUrl}/capabilities`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(Array.isArray(json.engines)).toBe(true);
    });

    it("GET /api/v1/health should return 200 OK without requiring authentication", async () => {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
    });

    it("GET /api/v1/diagnostics should return 200 OK with cacheDiagnostics", async () => {
      const res = await fetch(`${baseUrl}/api/v1/diagnostics`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(json.cacheDiagnostics).toBeDefined();
    });

    it("POST /api/v1/session/keys should bypass authCheck and reach handler (returning 400 for empty body)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/session/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      // 400 means authCheck allowed the request through to handler validation, not 401
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("GET /api/v1/sidecar-health should return 200 OK without requiring authentication", async () => {
      const res = await fetch(`${baseUrl}/api/v1/sidecar-health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reachable).toBeDefined();
    });
  });

  describe("Protected Endpoints Security Enforcement", () => {
    it("POST /api/v1/esm3-structure-eval should reject unauthenticated requests with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/esm3-structure-eval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uniprotId: "P04637", position: 273 })
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("POST /api/v1/esm3-structure-eval should accept valid Bearer token", async () => {
      const res = await fetch(`${baseUrl}/api/v1/esm3-structure-eval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${TEST_API_TOKEN}`
        },
        body: JSON.stringify({}) // Empty body should reach handler and fail schema validation (400)
      });
      // Not 401: proves Bearer token authentication successfully passed authCheck!
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("BAD_REQUEST");
    });

    it("Non-public unregistered endpoint should be rejected by authCheck with 401 before 404", async () => {
      const res = await fetch(`${baseUrl}/api/v1/private-admin-route`, {
        method: "GET"
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("Content-Type Enforcement", () => {
    it("POST /api/v1/session/refresh with non-JSON Content-Type should return 415", async () => {
      const res = await fetch(`${baseUrl}/api/v1/session/refresh`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "malformed payload"
      });
      expect(res.status).toBe(415);
      const json = await res.json();
      expect(json.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });
  });

  describe("Route Coverage Parity", () => {
    it("PUBLIC_ENDPOINTS should explicitly list all critical health and capability routes", () => {
      expect(PUBLIC_ENDPOINTS).toContain("/capabilities");
      expect(PUBLIC_ENDPOINTS).toContain("/api/v1/capabilities");
      expect(PUBLIC_ENDPOINTS).toContain("/health");
      expect(PUBLIC_ENDPOINTS).toContain("/api/v1/health");
      expect(PUBLIC_ENDPOINTS).toContain("/sidecar-health");
      expect(PUBLIC_ENDPOINTS).toContain("/api/v1/sidecar-health");
    });
  });
});
