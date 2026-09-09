import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../routes.ts";
import { encryptSession } from "../utils.ts";

describe("Session Authentication & Key Validation", () => {
  beforeEach(() => {
    process.env.APP_SESSION_SECRET = "dev-session-secret-must-be-changed-in-prod";
  });

  describe("Session Validation: Decoupled Core vs Narrative", () => {
    it("should NOT fail with SESSION_EXPIRED on /analyze-variant when an expired session token is passed", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const analysisOrchestrator = await import("../services/analysis-orchestrator.ts");
      const coreSpy = vi.spyOn(analysisOrchestrator, "runCoreAnalysis").mockResolvedValue({
        gene: "PAH",
        variant: "p.Met1Val",
        uniprotId: "P00439",
        _internal: {}
      } as any);

      const externalServices = await import("../services/external.ts");
      const seqSpy = vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("M");

      const encryptSecret = "dev-session-secret-must-be-changed-in-prod";
      const expiredSessionId = encryptSession(
        { apiKey: "test-key-expired", expiresAt: Date.now() - 5000 },
        encryptSecret
      );
      
      const req: any = {
        body: {
          gene: "PAH",
          variant: "p.Met1Val",
          uniprotId: "P00439"
        },
        headers: {
          "authorization": "Bearer dummy-token",
          "x-gemini-session-id": expiredSessionId
        }
      };
      
      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      
      // Core analysis should succeed without checking Gemini session
      expect(statusCode).toBe(200);
      expect(jsonVal).toBeDefined();
      expect(jsonVal.error).toBeUndefined();

      seqSpy.mockRestore();
      coreSpy.mockRestore();
    });

    it("should return SESSION_EXPIRED on /analyze-variant-narrative when an expired session token is passed", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-narrative");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant-narrative not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const encryptSecret = "dev-session-secret-must-be-changed-in-prod";
      const expiredSessionId = encryptSession(
        { apiKey: "test-key-expired", expiresAt: Date.now() - 5000 },
        encryptSecret
      );
      
      const req: any = {
        body: {
          gene: "PAH",
          variant: "p.Met1Val",
          uniprotId: "P00439"
        },
        headers: {
          "authorization": "Bearer dummy-token",
          "x-gemini-session-id": expiredSessionId
        }
      };
      
      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      
      expect(statusCode).toBe(401);
      expect(jsonVal.error.code).toBe("SESSION_EXPIRED");
    });

    it("should return SESSION_EXPIRED on /analyze-variant-narrative when session is completely invalid", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-narrative");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant-narrative not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const req: any = {
        body: {
          gene: "PAH",
          variant: "p.Met1Val",
          uniprotId: "P00439"
        },
        headers: {
          "authorization": "Bearer dummy-token",
          "x-gemini-session-id": "completely-invalid-session-id-format"
        }
      };
      
      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      
      expect(statusCode).toBe(401);
      expect(jsonVal.error.code).toBe("SESSION_EXPIRED");
    });
  });

  describe("API Key Regex Validation", () => {
    it("should validate relaxed API key format with special characters", () => {
      const relaxedRegex = /^[a-zA-Z0-9_\-\.\+\=\/]+$/;
      
      expect(relaxedRegex.test("AIzaSyB123_456-789")).toBe(true);
      expect(relaxedRegex.test("AIzaSyB123.456.789")).toBe(true);
      expect(relaxedRegex.test("AIzaSyB123+456/789=")).toBe(true);
      expect(relaxedRegex.test("AIzaSyB123 456")).toBe(false);
      expect(relaxedRegex.test("AIzaSyB123\"456")).toBe(false);
    });
  });

  describe("Legacy settings key scrub", () => {
    it("should scrub geminiApiKey from localStorage and return it empty in parsed settings", () => {
      const legacySettings = {
        residueColor: "#F97316",
        primaryAccent: "indigo",
        geminiApiKey: "legacy-api-key-12345",
        geminiSessionId: "session-id-123"
      };
      
      const store: Record<string, string> = {
        missenseUserSettings: JSON.stringify(legacySettings)
      };
      const localStorageMock = {
        getItem(key: string) { return store[key] || null; },
        setItem(key: string, val: string) { store[key] = val; }
      };
      
      const saved = localStorageMock.getItem("missenseUserSettings");
      let parsed = saved ? JSON.parse(saved) : null;
      if (parsed && parsed.geminiApiKey !== undefined) {
        delete parsed.geminiApiKey;
        localStorageMock.setItem("missenseUserSettings", JSON.stringify(parsed));
      }
      
      expect(parsed.geminiApiKey).toBeUndefined();
      const updatedStore = JSON.parse(store.missenseUserSettings);
      expect(updatedStore.geminiApiKey).toBeUndefined();
    });
  });

  describe("POST /session/refresh", () => {
    it("should refresh an active session token and return updated expiry", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/session/refresh");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /session/refresh not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const secret = "dev-session-secret-must-be-changed-in-prod";
      const initialSessionId = encryptSession(
        { apiKey: "valid-active-key", expiresAt: Date.now() + 5 * 60 * 1000 },
        secret
      );

      const req: any = {
        headers: { "x-gemini-session-id": initialSessionId },
        body: {}
      };

      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };

      await handler(req, res, () => {});

      expect(statusCode).toBe(200);
      expect(jsonVal.sessionId).toBeDefined();
      expect(jsonVal.sessionId).not.toBe(initialSessionId);
      expect(jsonVal.expiresAt).toBeGreaterThan(Date.now() + 10 * 60 * 1000);
    });

    it("should reject expired session token on refresh", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/session/refresh");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /session/refresh not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const secret = "dev-session-secret-must-be-changed-in-prod";
      const expiredSessionId = encryptSession(
        { apiKey: "valid-active-key", expiresAt: Date.now() - 5000 },
        secret
      );

      const req: any = {
        headers: { "x-gemini-session-id": expiredSessionId },
        body: {}
      };

      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };

      await handler(req, res, () => {});

      expect(statusCode).toBe(401);
      expect(jsonVal.error.code).toBe("SESSION_EXPIRED");
    });
  });
});
