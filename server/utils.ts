import express from "express";
import path from "path";
import fs from "fs";

export class Semaphore {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.activeCount--;
    }
  }
}

// Regex patterns (V-1, V-2, V-4)
export const GENE_PATTERN = /^[A-Z0-9\-]{1,20}$/i;
export const HGVS_PATTERN = /^(?:p\.)?([A-Z][a-z]{2}|[A-Z])(\d{1,5})([A-Z][a-z]{2}|[A-Z])$/i;
export const UNIPROT_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;
export const MUTATION_FOLDX_PATTERN = /^[A-Z][A-Z]\d+[A-Z]$/i;
export const VCF_GENOMIC_PATTERN = /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i;
export const CDNA_PATTERN = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;

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
  const trimmed = variant.trim();
  if (!HGVS_PATTERN.test(trimmed)) {
    throw new Error(`Invalid variant format: "${trimmed}". Must match HGVS protein nomenclature (e.g., p.Arg215Trp or R215W).`);
  }
  return trimmed;
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

export function sendError(res: express.Response, status: number, code: string, message: string, details?: any) {
  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

export class AuditLogger {
  private static logPath = path.join(process.cwd(), "logs", "audit.jsonl");

  static async log(action: string, metadata: any) {
    try {
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        action,
        ...metadata
      }) + "\n";
      await fs.promises.appendFile(this.logPath, entry, "utf8");
    } catch (err: any) {
      console.error("[AuditLogger] Failed to write audit log:", err.message);
    }
  }
}
