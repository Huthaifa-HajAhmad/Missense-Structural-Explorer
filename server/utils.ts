import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class Semaphore {
  private activeCount = 0;
  private queue: { resolve: () => void; reject: (err: Error) => void }[] = [];

  constructor(private maxConcurrency: number, private maxQueueLength = 20) {}

  async acquire(timeoutMs = 30000): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }

    if (this.queue.length >= this.maxQueueLength) {
      throw new Error("Concurrency limit reached. Biophysical server queue is full.");
    }

    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          const idx = this.queue.findIndex(item => item.resolve === onAcquire);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          resolved = true;
          reject(new Error("Timeout acquiring biophysical semaphore. Concurrency limit reached."));
        }
      }, timeoutMs);

      const onAcquire = () => {
        resolved = true;
        clearTimeout(timer);
        this.activeCount++;
        resolve();
      };

      this.queue.push({ resolve: onAcquire, reject });
    });
  }

  release(): void {
    if (this.activeCount <= 0) {
      console.error("Semaphore over-release detected");
      return;
    }
    // NOTE: activeCount-- must happen before next.resolve() is called,
    // as next.resolve() (which triggers onAcquire) will immediately increment activeCount again.
    this.activeCount--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next.resolve();
      }
    }
  }
}

// Regex patterns (V-1, V-2, V-4)
export const GENE_PATTERN = /^[A-Z0-9\-]{1,20}$/i;

const IUPAC_3 = "(?:Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val)";
const IUPAC_1 = "[ARNDCQEGHILKMFPSTWYV]";
export const HGVS_PATTERN = new RegExp(`^(?:p\\.)?(${IUPAC_3}|${IUPAC_1})(\\d{1,6})(${IUPAC_3}|${IUPAC_1})$`, "i");

export const UNIPROT_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;
export const MUTATION_FOLDX_PATTERN = /^[ARNDCQEGHILKMFPSTWYV][A-Z]\d+[ARNDCQEGHILKMFPSTWYV]$/i;
export const VCF_GENOMIC_PATTERN = /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i;
export const CDNA_PATTERN = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;
export const DASHED_GENOMIC_PATTERN = /^(?:chr)?([0-9XYMT]+)-(\d+)-([ACGTN]+)-([ACGTN]+)$/i;


const AA_3_TO_1: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C",
  GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P",
  SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
};

function to1Letter(aa: string): string {
  const upper = aa.toUpperCase();
  if (upper.length === 1) return upper;
  return AA_3_TO_1[upper] || "";
}

export function validateGene(gene: any): string {
  if (!gene || typeof gene !== "string") {
    throw new Error("Gene symbol must be a non-empty string.");
  }
  const trimmed = gene.trim();
  if (!GENE_PATTERN.test(trimmed)) {
    throw new Error(`Invalid gene symbol format: "${trimmed}".`);
  }
  return trimmed.toUpperCase();
}

export function validateVariant(variant: any): string {
  if (!variant || typeof variant !== "string") {
    throw new Error("Variant must be a non-empty string.");
  }
  const trimmed = variant.replace(/[()]/g, "").trim();
  const match = trimmed.match(HGVS_PATTERN);
  if (!match) {
    throw new Error(`Invalid variant format: "${trimmed}". Must match HGVS protein nomenclature (e.g., p.Arg215Trp or R215W).`);
  }
  
  let wt = match[1];
  const pos = match[2];
  let mut = match[3];
  
  if (wt.length === 3) {
    wt = wt.charAt(0).toUpperCase() + wt.slice(1).toLowerCase();
  } else {
    wt = wt.toUpperCase();
  }
  
  if (mut.length === 3) {
    mut = mut.charAt(0).toUpperCase() + mut.slice(1).toLowerCase();
  } else {
    mut = mut.toUpperCase();
  }
  
  const hasP = trimmed.toLowerCase().startsWith("p.");
  const normalized = (hasP ? "p." : "") + wt + pos + mut;
  
  const wt1 = to1Letter(wt);
  const mut1 = to1Letter(mut);
  if (wt1 && mut1 && wt1 === mut1) {
    throw new Error(`Synonymous variant detected: "${normalized}". The wild-type and mutant residues are identical.`);
  }
  return normalized;
}

export function validateUniProt(uniprotId: any): string {
  if (!uniprotId || typeof uniprotId !== "string") {
    throw new Error("UniProt accession ID must be a non-empty string.");
  }
  const trimmed = uniprotId.trim();
  if (!UNIPROT_PATTERN.test(trimmed)) {
    throw new Error(`Invalid UniProt accession ID format: "${trimmed}".`);
  }
  return trimmed.toUpperCase();
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
    "dbNSFP", "FoldX", "DynaMut2", "DDMut", "ThermoMPNN", "ESMFold", "ESM2", "ESM3", "ESMC", "SaProt",
    "password", "secret", "token", "apiKey", "credential", "authCheck", "sessionSecret", "sessionKey",
    "C:\\", "/Users/", "/home/", "node_modules", " at ", ".ts:", ".js:", "mongodb", "postgres", "mysql",
    "select", "insert", "update", "delete", "sql"
  ];

  if (denylistKeywords.some(kw => msg.includes(kw) || msg.toLowerCase().includes(kw.toLowerCase()))) {
    return "An internal server error occurred while processing the request.";
  }

  return msg;
}

export function sendError(res: express.Response, status: number, code: string, message: string, details?: any) {
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

export class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF-OPEN" = "CLOSED";
  private failures = 0;
  private lastFailureTime = 0;

  constructor(
    private threshold = 5,
    private cooldownMs = 60000
  ) {}

  canExecute(): boolean {
    if (this.state === "OPEN") {
      const now = Date.now();
      if (now - this.lastFailureTime > this.cooldownMs) {
        this.state = "HALF-OPEN";
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "OPEN";
      console.warn(`[Circuit Breaker] Tripped to OPEN state due to ${this.failures} consecutive failures.`);
    }
  }
}

export class AuditLogger {
  private static logPath = path.join(process.cwd(), "logs", "audit.jsonl");
  public static failureCount = 0;

  static async log(action: string, metadata: any) {
    try {
      const entryObj = {
        timestamp: new Date().toISOString(),
        action,
        ...metadata
      };
      const entryStr = JSON.stringify(entryObj);
      
      // Print to stdout durably for Cloud Logging ingestion
      console.log(`[AUDIT] ${entryStr}`);

      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Rotate log if it exceeds 10MB
      try {
        if (fs.existsSync(this.logPath)) {
          const stats = await fs.promises.stat(this.logPath);
          if (stats.size > 10 * 1024 * 1024) { // 10 MB
            const backupPath = path.join(dir, "audit.1.jsonl");
            if (fs.existsSync(backupPath)) {
              await fs.promises.unlink(backupPath);
            }
            await fs.promises.rename(this.logPath, backupPath);
          }
        }
      } catch (rotationErr: any) {
        console.error("[AuditLogger] Log rotation failed:", rotationErr.message);
      }

      await fs.promises.appendFile(this.logPath, entryStr + "\n", "utf8");
    } catch (err: any) {
      AuditLogger.failureCount++;
      console.error("[AuditLogger] Failed to write audit log:", err.message);
    }
  }
}

export function filterPII(text: string): string {
  let filtered = text;
  
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

// Session Token Payload Definition
export interface SessionPayload {
  apiKey: string;
  expiresAt: number;
}

const pbkdf2KeyCache = new Map<string, Buffer>();

/**
 * NOTE: The PBKDF2 salt is deterministic (derived from the secret key) to allow caching
 * the resulting stretched key. If we used a random salt per session token, we could
 * not cache the key and would need to execute 100,000 PBKDF2 iterations on every single
 * incoming request, resulting in severe CPU overhead and susceptibility to Denial of Service (DoS).
 */
function getDerivedSessionKey(secret: string): Buffer {
  let key = pbkdf2KeyCache.get(secret);
  if (!key) {
    const salt = crypto.createHmac("sha256", secret).update("missense-resolve-pbkdf2-salt").digest();
    key = crypto.pbkdf2Sync(secret, salt, 100000, 32, "sha256");
    pbkdf2KeyCache.set(secret, key);
  }
  return key;
}

/**
 * Encrypts a session payload into a stateless AES-256-GCM token.
 * Output format: "ivBase64:ciphertextBase64:tagBase64"
 */
export function encryptSession(payload: SessionPayload, secret: string): string {
  const key = getDerivedSessionKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  
  return `${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

/**
 * Decrypts a stateless AES-256-GCM session token back into its payload.
 * Returns undefined if decryption or validation fails.
 */
export function decryptSession(token: string, secret: string): SessionPayload | undefined {
  try {
    const parts = token.split(":");
    if (parts.length !== 3) return undefined;
    const [ivB64, ciphertextB64, tagB64] = parts;
    
    const key = getDerivedSessionKey(secret);
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    
    if (iv.length !== 12 || tag.length !== 16) {
      return undefined;
    }
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    
    return JSON.parse(decrypted.toString("utf8"));
  } catch (err) {
    return undefined;
  }
}

export function getApiKeyFromSession(sessionId: string): string | undefined {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    throw new Error("APP_SESSION_SECRET is not configured in the environment.");
  }
  const payload = decryptSession(sessionId, secret);
  if (!payload) return undefined;
  if (Date.now() > payload.expiresAt) {
    return undefined;
  }
  return payload.apiKey;
}

/**
 * Starts a background janitor that runs periodically to delete job directories in temp_jobs/
 * that are older than 1 hour (M-8).
 */
export function runTempJobsJanitor() {
  const tempJobsDir = path.join(process.cwd(), "temp_jobs");
  const cacheDir = path.join(process.cwd(), "logs", "gemini_cache");
  const MAX_AGE = 30 * 60 * 1000; // 30 minutes TTL (M-4)
  const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days TTL (M-6)
  const RUN_INTERVAL = 5 * 60 * 1000; // run every 5 minutes (M-4)

  setInterval(async () => {
    // 1. Sweep temp jobs
    try {
      if (fs.existsSync(tempJobsDir)) {
        const files = await fs.promises.readdir(tempJobsDir);
        const now = Date.now();

        for (const file of files) {
          const filePath = path.join(tempJobsDir, file);
          try {
            const stats = await fs.promises.stat(filePath);
            if (stats.isDirectory()) {
              const age = now - stats.mtimeMs;
              if (age > MAX_AGE) {
                console.log(`[Janitor] Deleting expired job directory: ${filePath} (age: ${Math.round(age / 1000 / 60)} mins)`);
                await fs.promises.rm(filePath, { recursive: true, force: true });
              }
            }
          } catch (fileErr: any) {
            console.error(`[Janitor] Failed to inspect/delete ${filePath}:`, fileErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error("[Janitor] Failed to read temp_jobs directory:", err.message);
    }

    // 2. Sweep stale Gemini disk cache files (prevents unbounded disk growth)
    try {
      if (fs.existsSync(cacheDir)) {
        const files = await fs.promises.readdir(cacheDir);
        const now = Date.now();

        for (const file of files) {
          const filePath = path.join(cacheDir, file);
          try {
            const stats = await fs.promises.stat(filePath);
            const age = now - stats.mtimeMs;
            if (age > CACHE_MAX_AGE) {
              console.log(`[Janitor] Deleting expired Gemini cache file: ${filePath}`);
              await fs.promises.unlink(filePath);
            }
          } catch (fileErr: any) {
            console.error(`[Janitor] Failed to inspect/delete cache file ${filePath}:`, fileErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error("[Janitor] Failed to read Gemini cache directory:", err.message);
    }
  }, RUN_INTERVAL);
}

export function formatZodError(error: any): string {
  if (error && Array.isArray(error.issues)) {
    return error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ");
  }
  return "Invalid request body format.";
}
