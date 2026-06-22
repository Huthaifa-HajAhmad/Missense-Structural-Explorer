import express from "express";
import rateLimit from "express-rate-limit";
import { sendError } from "./utils.ts";

// [MOD-12] Request/Response Logging Middleware
export function requestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
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
  const currentApiToken = process.env.APP_API_TOKEN;
  if (currentApiToken) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.split(" ")[1] !== currentApiToken) {
      sendError(res, 401, "UNAUTHORIZED", "Unauthorized: Invalid or missing API token.");
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    sendError(res, 500, "CONFIGURATION_ERROR", "Authentication token is required but not configured on the server.");
    return;
  }
  next();
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
