import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { sendError, safeCompare, getApiKeyFromSession, decryptSession } from "./utils.ts";

// [MOD-12] Request/Response Logging Middleware
export function requestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
  const requestId = (req.headers["x-request-id"] || req.headers["x-correlation-id"] || crypto.randomUUID()) as string;
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-ID", requestId);

  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] [ReqId: ${requestId}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
}

// Content-Type validation middleware (A-4)
export const validateContentType = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if ((req.method === "POST" || req.method === "PUT") && !req.is("application/json")) {
    sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Request body must be application/json.");
    return;
  }
  next();
};

// Basic authentication middleware (SEC-2)
export const authCheck = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // 1. Allow public metadata/session endpoints to bypass auth
  const PUBLIC_ENDPOINTS = [
    "/health",
    "/version",
    "/session/keys",
    "/alphafold-pdb",
    "/sequence"
  ];
  
  const pathToCheck = req.path;
  const isPublic = PUBLIC_ENDPOINTS.some(p => pathToCheck === p || pathToCheck.startsWith(p + "/"));
  if (isPublic) {
    next();
    return;
  }

  // 2. Enforce APP_API_TOKEN configured on server
  const currentApiToken = process.env.APP_API_TOKEN;
  if (!currentApiToken) {
    sendError(res, 500, "CONFIGURATION_ERROR", "Authentication token is required but not configured on the server.");
    return;
  }

  // 3. Try Bearer token authentication (for API clients)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    if (safeCompare(token, currentApiToken)) {
      next();
      return;
    }
  }

  // 4. Try Session ID authentication (for the web application)
  const sessionId = req.headers["x-gemini-session-id"] as string | undefined;
  if (sessionId) {
    const secret = process.env.APP_SESSION_SECRET || "dev-session-secret-must-be-changed-in-prod";
    const payload = decryptSession(sessionId, secret);
    if (payload) {
      if (Date.now() > payload.expiresAt) {
        sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate.");
        return;
      }
      next();
      return;
    }
  }

  // 5. If both failed, return 401 Unauthorized
  sendError(res, 401, "UNAUTHORIZED", "Unauthorized: Invalid or missing API token / session.");
};

// Rate Limiting Middleware (CRIT-5)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests from this IP. Please try again after a minute."
    }
  }
});

// Specific rate limiter for Gemini variant analysis to manage API usage cost
export const analyzeVariantLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit to 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const sessionId = (req.headers["x-gemini-session-id"] || "") as string;
    return sessionId || req.ip || "";
  },
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many analysis requests. Please try again after a minute."
    }
  }
});
