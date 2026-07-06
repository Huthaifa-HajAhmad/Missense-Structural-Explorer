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
    "/version"
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

  // 4. If Bearer token fails, return 401 Unauthorized
  sendError(res, 401, "UNAUTHORIZED", "Unauthorized: Invalid or missing API token.");
};

// Rate Limiting Middleware (CRIT-5)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // Limit each IP to 120 requests per minute (accommodates job status polling)
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
    // Key strictly on client IP to prevent session rotation rate-limiting bypass (C-2)
    // Fallback to remoteAddress or randomUUID to prevent sharing a bucket for unidentifiable clients
    const ip = req.ip || req.socket?.remoteAddress;
    return ip || `fallback_${crypto.randomUUID()}`;
  },
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many analysis requests. Please try again after a minute."
    }
  }
});
