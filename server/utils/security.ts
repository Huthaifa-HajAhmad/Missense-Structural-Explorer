import type express from "express";
import crypto from "crypto";
import { isGenomicCoordinate } from "./validation.ts";

export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function filterPII(text: string): string {
  let filtered = text;

  // API Key pattern (Google AIza...)
  filtered = filtered.replace(/\bAIza[0-9A-Za-z-_]{30,45}\b/g, "[REDACTED API KEY]");

  // Email pattern
  filtered = filtered.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED EMAIL]");

  // Phone number pattern (including bare 10-digit phones and standard variants)
  filtered = filtered.replace(/\b\d{10}\b|(?:\+\d{1,4}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[REDACTED PHONE]");

  // Social Security Number (SSN) pattern (dashed and prefixed undashed)
  filtered = filtered.replace(/\b\d{3}-\d{2}-\d{4}\b|\b(?:ssn|social\s*security(?:[-_\s]*number)?|tax\s*id)[:\s-]*\d{9}\b/gi, "[REDACTED SSN]");

  // Date of Birth (DOB) patterns (unanchored)
  filtered = filtered.replace(/(?:dob|date\s+of\s+birth|birthdate|birth\s+date)[:\s-]*(?:\d{1,2}[-./]\d{1,2}[-./]\d{2,4})/gi, "[REDACTED DOB]");

  // Patient ID / MRN patterns (unanchored)
  filtered = filtered.replace(/(?:mrn|patient\s*id|medical\s*record\s*number)[:\s-]*[a-zA-Z0-9-]{4,15}/gi, "[REDACTED PATIENT ID]");

  return filtered;
}

export function anonymizeGenomicCoordinate(val: string): string {
  if (!isGenomicCoordinate(val)) return val;
  const hash = crypto.createHash("sha256").update(val).digest("hex").slice(0, 8);
  const chrMatch = val.match(/^(?:chr)?([0-9XYMT]+)/i);
  const prefix = chrMatch ? `chr${chrMatch[1].toUpperCase()}` : "genomic";
  return `${prefix}:[HASH_${hash}]`;
}

const AUDIT_IP_SALT = process.env.AUDIT_IP_SALT || "missense-audit-salt-2026";

export function hashClientIp(ip: string, salt: string = AUDIT_IP_SALT): string {
  if (!ip || typeof ip !== "string") return ip;
  const normalized = ip.trim().toLowerCase();
  if (normalized.startsWith("session_") || normalized.startsWith("fallback_")) return normalized;
  const hash = crypto.createHmac("sha256", salt).update(normalized).digest("hex").slice(0, 16);
  return `ip_anon_${hash}`;
}

export function sanitizeErrorMessage(err: any): string {
  if (!err) return "An unexpected error occurred.";
  const msg = typeof err === "string" ? err : (err.message || "");

  if (msg.includes("ENOENT") || msg.includes("fs.") || msg.includes("spawn")) {
    return "A system-level resource is temporarily unavailable.";
  }
  if (msg.includes("fetch") || msg.includes("Failed to fetch") || msg.includes("rate limit") || msg.includes("upstream")) {
    return "Reference database query failed. Please verify the connection or try again later.";
  }
  if (msg.includes("JSON") || msg.includes("parse") || msg.includes("Unexpected token")) {
    return "Data format mismatch when retrieving reference database details.";
  }
  if (msg.includes("ACMG") || msg.includes("BayesDel") || msg.includes("concordance")) {
    return "Evaluation algorithm encountered an internal data processing mismatch.";
  }

  // Denylist of internal developer errors, stack traces, paths, and credentials to prevent information leakage
  const denylistKeywords = [
    "TypeError", "ReferenceError", "SyntaxError", "RangeError", "EvalError", "URIError",
    "password", "sessionSecret", "sessionKey", "authCheck",
    "C:\\", "/Users/", "/home/", "node_modules", " at ", ".ts:", ".js:", "mongodb", "postgres", "mysql",
    "select", "insert", "update", "delete", "sql"
  ];

  if (denylistKeywords.some(kw => msg.includes(kw) || msg.toLowerCase().includes(kw.toLowerCase()))) {
    return "An internal server error occurred while processing the request.";
  }

  return msg;
}

export function sendError(res: express.Response, status: number, code: string, message: string, details?: any) {
  if (res.headersSent) {
    console.warn(`[sendError Warning] Headers already sent. Skipping error response (${status} ${code}: ${message})`);
    return;
  }

  const reqId = res.getHeader ? (res.getHeader("X-Request-ID") as string) : undefined;

  // Sanitize the message to protect against information leakage in clinical/production environments (E-1)
  let sanitizedMessage = message;
  if (status >= 500) {
    sanitizedMessage = sanitizeErrorMessage(message);
  }

  res.status(status).json({
    error: {
      code,
      message: sanitizedMessage,
      ...(reqId ? { requestId: reqId } : {}),
      ...(details ? { details } : {})
    }
  });
}
