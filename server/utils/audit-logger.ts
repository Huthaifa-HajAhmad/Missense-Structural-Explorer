import path from "path";
import fs from "fs";
import crypto from "crypto";
import readline from "readline";
import { filterPII, anonymizeGenomicCoordinate, hashClientIp } from "./security.ts";

let auditWriteChain: Promise<void> = Promise.resolve();

function serializeAuditFileOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = auditWriteChain.then(fn, fn);
  auditWriteChain = run.then(() => undefined, () => undefined);
  return run;
}

export function sanitizeAuditMetadata(metadata: any): any {
  if (!metadata || typeof metadata !== "object") return metadata;
  if (Array.isArray(metadata)) {
    return metadata.map(item => sanitizeAuditMetadata(item));
  }
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v === "string") {
      let clean = filterPII(v);
      if (k === "variant" || k === "originalNotation" || k === "mutation") {
        clean = anonymizeGenomicCoordinate(clean);
      } else if (k === "ip" || k === "clientIp" || k === "remoteAddress") {
        clean = hashClientIp(clean);
      }
      sanitized[k] = clean;
    } else if (typeof v === "object" && v !== null) {
      sanitized[k] = sanitizeAuditMetadata(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export class AuditLogger {
  /**
   * Append target for the audit trail.
   *
   * Resolved per call so tests can redirect it: route suites legitimately exercise
   * `AuditLogger.log`, and with a frozen path each run appended real audit records to the
   * developer's `logs/audit.jsonl`.
   */
  private static get logPath(): string {
    return process.env.AUDIT_LOG_PATH ?? path.join(process.cwd(), "logs", "audit.jsonl");
  }
  public static failureCount = 0;

  static async log(action: string, metadata: any) {
    try {
      const sanitizedMeta = sanitizeAuditMetadata(metadata);
      const entryObj = {
        timestamp: new Date().toISOString(),
        action,
        dataClassification: metadata?.dataClassification || "SYSTEM_EVENT",
        ...sanitizedMeta
      };
      const entryStr = JSON.stringify(entryObj);

      // Print to stdout durably for Cloud Logging ingestion
      console.log(`[AUDIT] ${entryStr}`);

      const targetPath = this.logPath;
      await serializeAuditFileOp(async () => {
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          await fs.promises.mkdir(dir, { recursive: true });
        }

        // Rotate log if it exceeds 10MB
        try {
          if (fs.existsSync(targetPath)) {
            const stats = await fs.promises.stat(targetPath);
            if (stats.size > 10 * 1024 * 1024) { // 10 MB
              const backupPath = path.join(dir, "audit.1.jsonl");
              await fs.promises.rm(backupPath, { force: true });
              await fs.promises.rename(targetPath, backupPath);
            }
          }
        } catch (rotationErr: any) {
          console.error("[AuditLogger] Log rotation failed:", rotationErr.message);
        }

        await fs.promises.appendFile(targetPath, entryStr + "\n", "utf8");
      });
    } catch (err: any) {
      AuditLogger.failureCount++;
      console.error("[AuditLogger] Failed to write audit log:", err.message);
    }
  }

  static async logVariantQuery(action: string, metadata: {
    gene: string;
    variant: string;
    uniprotId?: string;
    acmgWeighting?: string;
    requestId?: string;
    hasDirections?: boolean;
    stream?: boolean;
    [key: string]: any;
  }) {
    return this.log(action, {
      dataClassification: "CLINICAL_DECISION_SUPPORT",
      retentionPolicy: "30_DAYS",
      consentTier: "CLINICAL_RESEARCH",
      ...metadata
    });
  }

  /**
   * Purges audit log entries older than maxAgeDays (default: 30 days).
   */
  static async purgeExpiredLogs(maxAgeDays = 30): Promise<number> {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const currentPath = this.logPath;

    return serializeAuditFileOp(async () => {
      let purgedCount = 0;
      const logFiles = [currentPath, path.join(path.dirname(currentPath), "audit.1.jsonl")];
      for (const file of logFiles) {
        if (!fs.existsSync(file)) continue;
        const tmpFile = `${file}.purge.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
          const validLines: string[] = [];
          let filePurged = 0;
          const stream = fs.createReadStream(file, { encoding: "utf8" });
          const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
          for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const entry = JSON.parse(line);
              const entryTime = new Date(entry.timestamp).getTime();
              if (!isNaN(entryTime) && entryTime < cutoffTime) {
                filePurged++;
              } else {
                validLines.push(line);
              }
            } catch (_) {
              validLines.push(line);
            }
          }

          if (filePurged > 0) {
            const newContent = validLines.length > 0 ? validLines.join("\n") + "\n" : "";
            await fs.promises.writeFile(tmpFile, newContent, "utf8");
            await fs.promises.rename(tmpFile, file);
            purgedCount += filePurged;
          }
        } catch (err: any) {
          await fs.promises.unlink(tmpFile).catch(() => {});
          console.warn(`[AuditLogger] Failed to purge expired logs from ${file}:`, err.message);
        }
      }
      return purgedCount;
    });
  }
}
