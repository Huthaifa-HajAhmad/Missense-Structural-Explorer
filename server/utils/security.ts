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

const AUDIT_IP_SALT =
  process.env.AUDIT_IP_SALT ||
  (process.env.APP_SESSION_SECRET
    ? crypto.createHmac("sha256", process.env.APP_SESSION_SECRET).update("audit-ip-salt").digest("hex")
    : crypto.randomBytes(32).toString("hex"));

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

const BLOCKED_CUSTOM_HOST_REGEX = /^(169\.254\.\d+\.\d+|metadata\.google\.internal|metadata|instance-data|0\.0\.0\.0|localhost|::1|\[::1\]|::|\[::\])$/i;

function parseIpv4Octets(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(n => n <= 255) ? [o[0], o[1], o[2], o[3]] : null;
}

function parseIpv6Groups(host: string): number[] | null {
  if (!host.includes(":")) return null;
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":").map(g => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

function parseMappedIpv4Octets(host: string): [number, number, number, number] | null {
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
  if (dotted) return parseIpv4Octets(dotted[1]);
  const g = parseIpv6Groups(host);
  if (!g || g.slice(0, 5).some(x => x !== 0) || g[5] !== 0xffff) return null;
  return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
}

/**
 * Validates a caller-supplied custom endpoint URL against SSRF-prone schemes and IP ranges
 * (non-HTTP(S), cloud metadata 169.254.0.0/16, loopback, IPv6 link-local fe80::/10, ULA fc00::/7,
 * and plaintext HTTP / RFC1918 in production) while preserving hostname endpoints in non-prod.
 */
export function validateSafeCustomEndpointUrl(rawUrl: string): { valid: true; url: string } | { valid: false; reason: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 512) {
    return { valid: false, reason: "Invalid custom endpoint URL length" };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: "Only http(s) URLs are allowed" };
    }
    const hostname = parsed.hostname.toLowerCase();
    const cleanHost = hostname.replace(/^\[|\]$/g, "");
    const isProd = process.env.NODE_ENV === "production";

    const v4 = parseIpv4Octets(cleanHost) ?? parseMappedIpv4Octets(cleanHost);
    const v6 = v4 ? null : parseIpv6Groups(cleanHost);
    if (v6) {
      const isLoopbackOrUnspecified = v6.slice(0, 7).every(g => g === 0) && (v6[7] === 0 || v6[7] === 1);
      if (isLoopbackOrUnspecified || (v6[0] & 0xffc0) === 0xfe80 || (v6[0] & 0xfe00) === 0xfc00) {
        return { valid: false, reason: "Loopback, link-local, or unique-local IPv6 host is not permitted" };
      }
    }
    if (v4) {
      const [a, b] = v4;
      if (a === 127 || a === 0 || (a === 169 && b === 254)) {
        return { valid: false, reason: "Loopback, unspecified, or link-local metadata IP host is not permitted" };
      }
      if (isProd && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127))) {
        return { valid: false, reason: "Private network IP host is not permitted in production" };
      }
    }
    if (BLOCKED_CUSTOM_HOST_REGEX.test(hostname)) {
      return { valid: false, reason: "Metadata or loopback hostname is not permitted" };
    }
    if (isProd && parsed.protocol !== "https:") {
      return { valid: false, reason: "HTTPS is required for custom endpoints in production" };
    }
    return { valid: true, url: parsed.toString().replace(/\/+$/, "") };
  } catch {
    return { valid: false, reason: "Malformed custom endpoint URL" };
  }
}
