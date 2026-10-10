import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { sendError, safeCompare, getApiKeyFromSession, decryptSession } from "./utils.ts";
import { PUBLIC_ENDPOINTS } from "./routes/state.ts";
import { CONTEXT_SUFFIXES } from "../src/shared/contextRequest.ts";
import { accountAccess, attachPrincipal } from "./auth/middleware.ts";

const PUBLIC_CONTEXT_READ = new RegExp(`^/(?:api/v1/)?evidence-context/[^/]+(?:/(?:${CONTEXT_SUFFIXES.join("|")}))?$`);

// [MOD-12] Request/Response Logging Middleware
export function requestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
  const requestId = (req.headers["x-request-id"] || req.headers["x-correlation-id"] || crypto.randomUUID()) as string;
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-ID", requestId);

  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    let loggedUrl = req.originalUrl;
    try {
      const parsedUrl = new URL(req.originalUrl, "http://localhost");
      let changed = false;
      const SENSITIVE_PARAM_PATTERN = /(key|token|secret|session|auth|password|cred)/i;
      for (const k of Array.from(parsedUrl.searchParams.keys())) {
        if (SENSITIVE_PARAM_PATTERN.test(k)) {
          parsedUrl.searchParams.set(k, "[REDACTED]");
          changed = true;
        }
      }
      if (changed) {
        loggedUrl = parsedUrl.pathname + parsedUrl.search;
      }
    } catch (_) {}
    console.log(`[HTTP] [ReqId: ${requestId}] ${req.method} ${loggedUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
}

// Content-Type validation middleware (A-4)
export const validateContentType = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if ((req.method === "POST" || req.method === "PUT" || req.method === "PATCH") && !req.is("application/json")) {
    sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Request body must be application/json.");
    return;
  }
  next();
};

// Basic authentication middleware (SEC-2)
export const authCheck = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // 0. Accounts (server/auth): who is asking, and the AUTH_MODE rules. In AUTH_MODE=legacy (the
  //    default) this only lets a signed-in user through; every check below is unchanged.
  const verdict = accountAccess(req, attachPrincipal(req));
  if (verdict.allow === true) {
    next();
    return;
  }
  if (verdict.allow === false) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return;
  }

  // 1. Allow public metadata/session endpoints to bypass auth
  
  const pathToCheck = req.path;
  // Gene context is public reference evidence, like ClinVar and UniProt. Only
  // the existing GET routes bypass auth; future writes remain protected.
  const isPublicContextRead = req.method === "GET" && PUBLIC_CONTEXT_READ.test(pathToCheck);
  const isPublic = isPublicContextRead || PUBLIC_ENDPOINTS.some(p => pathToCheck === p || pathToCheck.startsWith(p + "/"));
  if (isPublic) {
    next();
    return;
  }

  // 2. Allow valid session-authenticated requests (X-Gemini-Session-ID)
  const sessionId = req.headers["x-gemini-session-id"] as string | undefined;
  if (sessionId) {
    try {
      const apiKey = getApiKeyFromSession(sessionId);
      if (apiKey) {
        next();
        return;
      }
    } catch (err) {
      // Invalid/expired session fallback to token check
    }
  }

  // 3. Enforce APP_API_TOKEN configured on server
  const currentApiToken = process.env.APP_API_TOKEN;
  if (!currentApiToken) {
    sendError(res, 500, "CONFIGURATION_ERROR", "Authentication token is required but not configured on the server.");
    return;
  }

  // 4. Try Bearer token authentication (for API clients)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    if (safeCompare(token, currentApiToken)) {
      next();
      return;
    }
  }

  // 5. If Bearer token fails, return 401 Unauthorized
  sendError(res, 401, "UNAUTHORIZED", "Unauthorized: Invalid or missing API token.");
};

export function getClientIp(req: any): string {
  const sessionId = req.headers["x-gemini-session-id"] as string | undefined;
  if (sessionId) {
    try {
      const apiKey = getApiKeyFromSession(sessionId);
      if (apiKey) {
        const sessionHash = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
        return `session_${sessionHash}`;
      }
    } catch (_) {
      // Invalid or expired session: fall through to IP-based rate limiting
    }
  }

  // Use Express's built-in req.ip which respects the configured 'trust proxy' setting
  if (req.ip) {
    return req.ip;
  }

  // Fallback to manual proxy extraction for unit test environments
  const remoteAddress = req.socket?.remoteAddress;
  const isLocal = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  
  if (isLocal && req.headers["x-forwarded-for"]) {
    const forwardedFor = req.headers["x-forwarded-for"];
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor
      : typeof forwardedFor === "string"
      ? forwardedFor.split(",").map(ip => ip.trim())
      : [];
    const clientIp = ips[0];
    if (clientIp) return clientIp;
  }

  return remoteAddress || `fallback_${crypto.randomUUID()}`;
}

// Rate Limiting Middleware (CRIT-5)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // Limit each IP to 120 requests per minute (accommodates job status polling)
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => getClientIp(req),
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
  keyGenerator: (req) => getClientIp(req),
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many analysis requests. Please try again after a minute."
    }
  }
});
