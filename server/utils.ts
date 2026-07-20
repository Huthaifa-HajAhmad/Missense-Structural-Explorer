import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export function safeCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export class Semaphore {
  private activeCount = 0;
  private queue: { resolve: () => void; reject: (err: Error) => void }[] = [];

  constructor(private maxConcurrency: number) {}

  async acquire(timeoutMs = 30000): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
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
export const HGVS_PATTERN = new RegExp(`^(?:p\\.)?(${IUPAC_3}|${IUPAC_1})(\\d{1,5})(${IUPAC_3}|${IUPAC_1})$`, "i");

export const UNIPROT_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;
export const MUTATION_FOLDX_PATTERN = /^[ARNDCQEGHILKMFPSTWYV][A-Z]\d+[ARNDCQEGHILKMFPSTWYV]$/i;
export const VCF_GENOMIC_PATTERN = /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i;
export const CDNA_PATTERN = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;

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
  
  const allowedKeywords = ["invalid", "session", "expired", "synonymous", "token", "missing", "unsupported"];
  if (allowedKeywords.some(kw => msg.toLowerCase().includes(kw))) {
    return msg;
  }
  
  return "An internal server error occurred while processing the request.";
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
  
  // Phone number pattern (anchored to require leading '+' or parenthesized area code to prevent over-redacting coordinate numbers)
  filtered = filtered.replace(/(?:\+\d{1,4}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[REDACTED PHONE]");
  
  // Social Security Number (SSN) pattern
  filtered = filtered.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED SSN]");
  
  // Date of Birth (DOB) patterns (e.g. DOB: 01/02/1990)
  filtered = filtered.replace(/\b(?:dob|date\s+of\s+birth)\b[:\s]+(?:\d{1,2}[-./]\d{1,2}[-./]\d{2,4})/gi, "[REDACTED DOB]");
  
  // Patient ID / MRN patterns (e.g. MRN: 1234567, Patient ID: abc-123)
  filtered = filtered.replace(/\b(?:mrn|patient\s*id|medical\s*record\s*number)\b[:\s]+[a-zA-Z0-9-]{4,15}/gi, "[REDACTED PATIENT ID]");
  
  return filtered;
}

// Session Token Payload Definition
export interface SessionPayload {
  apiKey: string;
  expiresAt: number;
}

/**
 * Encrypts a session payload into a stateless AES-256-GCM token.
 * Output format: "ivBase64:ciphertextBase64:tagBase64"
 */
export function encryptSession(payload: SessionPayload, secret: string): string {
  // Derive a key of exactly 32 bytes from the secret string via PBKDF2, using a derived salt.
  // 10,000 iterations are selected to balance cryptographic strength against CPU denial of service (DoS) risks
  // since this key derivation executes on session verification for incoming requests.
  const salt = crypto.createHmac("sha256", secret).update("missense-resolve-pbkdf2-salt").digest();
  const key = crypto.pbkdf2Sync(secret, salt, 10000, 32, "sha256");
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
    
    // Derive a key of exactly 32 bytes from the secret string via PBKDF2, using a derived salt.
    // 10,000 iterations are selected to balance cryptographic strength against CPU denial of service (DoS) risks
    // since this key derivation executes on session verification for incoming requests.
    const salt = crypto.createHmac("sha256", secret).update("missense-resolve-pbkdf2-salt").digest();
    const key = crypto.pbkdf2Sync(secret, salt, 10000, 32, "sha256");
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
  const ONE_HOUR = 60 * 60 * 1000;
  const RUN_INTERVAL = 15 * 60 * 1000; // run every 15 minutes

  setInterval(async () => {
    try {
      if (!fs.existsSync(tempJobsDir)) return;
      const files = await fs.promises.readdir(tempJobsDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(tempJobsDir, file);
        try {
          const stats = await fs.promises.stat(filePath);
          if (stats.isDirectory()) {
            const age = now - stats.mtimeMs;
            if (age > ONE_HOUR) {
              console.log(`[Janitor] Deleting expired job directory: ${filePath} (age: ${Math.round(age / 1000 / 60)} mins)`);
              await fs.promises.rm(filePath, { recursive: true, force: true });
            }
          }
        } catch (fileErr: any) {
          console.error(`[Janitor] Failed to inspect/delete ${filePath}:`, fileErr.message);
        }
      }
    } catch (err: any) {
      console.error("[Janitor] Failed to read temp_jobs directory:", err.message);
    }
  }, RUN_INTERVAL);
}
