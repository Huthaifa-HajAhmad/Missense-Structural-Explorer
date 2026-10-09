/**
 * reportDraftStorage.ts — the author's Report draft (ticks, edited text, document fields, pinned
 * papers), kept in this browser per variant.
 *
 * It is a per-viewer convenience, not a record: storage can be empty, blocked or throw (private
 * windows, cleared site data), and the Report must render correctly without it, so every read and
 * write is wrapped and a failure means "no draft".
 */
import { BLOCK_ORDER, type BlockKey } from "../shared/reportDocument";
import type { ReportDraft } from "../shared/reportInput";
import type { AnalysisResult } from "../shared/contracts";

const PREFIX = "mse.reportDraft.v1:";

export function reportDraftKey(gene: string | null | undefined, uniprotId: string | null | undefined, variant: string | null | undefined, reference = ""): string | null {
  const g = (gene ?? "").trim();
  const v = (variant ?? "").trim();
  if (!g || !v) return null;
  return `${g}|${(uniprotId ?? "").trim()}|${v}${reference ? `|${reference}` : ""}`;
}

/** One resolved identity for browser persistence and portable draft files. */
export function reportDraftKeys(gene: string, uniprotId: string, variant: string, result: AnalysisResult | null) {
  const baseKey = reportDraftKey(gene, uniprotId, variant);
  if (!baseKey || result?.metadata?.gene !== gene || result.metadata.variant !== variant) {
    return { key: baseKey, baseKey, reference: [null, null, null], legacyReferenceKey: baseKey ? `${baseKey}|[null,null,null]` : null };
  }
  const assembly = result.predictorData?.gnomadVariantAssembly ?? null;
  const genomicId = result.predictorData?.gnomadVariantId ?? null;
  const transcript = result.transcriptId?.trim() || result.predictorData?.transcriptId?.trim() || null;
  const reference = [assembly, genomicId, transcript];
  const key = reference.some(value => value !== null) ? reportDraftKey(gene, uniprotId, variant, JSON.stringify(reference)) : baseKey;
  // The first reference-aware release omitted transcript and appended even an all-null tuple.
  const oldKey = reportDraftKey(gene, uniprotId, variant, JSON.stringify([assembly, genomicId, null]));
  return { key, baseKey, reference, legacyReferenceKey: oldKey !== key ? oldKey : null };
}

const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);

function isDraft(value: unknown): value is ReportDraft {
  if (!isObject(value) || !isObject(value.sections) || !isObject(value.edits) || !isObject(value.meta) || !Array.isArray(value.citations)) return false;
  return ["title", "preparedBy", "caseRef"].every(k => typeof value.meta[k] === "string") &&
    Object.entries(value.sections).every(([k, v]) => BLOCK_ORDER.includes(k as BlockKey) && typeof v === "boolean") &&
    Object.entries(value.edits).every(([k, v]) => BLOCK_ORDER.includes(k as BlockKey) && isObject(v) && typeof v.text === "string" && typeof v.base === "string" && (v.evidenceId === undefined || typeof v.evidenceId === "string")) &&
    value.citations.every((c: unknown) => isObject(c) && ["id", "title", "authors", "journal"].every(k => typeof c[k] === "string") && (c.year === null || typeof c.year === "number" && Number.isFinite(c.year)) && (c.url == null || typeof c.url === "string"));
}

export function readReportDraft(key: string | null): ReportDraft | null {
  if (!key || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isDraft(parsed)) return null;
    // Keep only keys the document still knows, so a renamed block cannot resurrect stale text.
    const known = new Set<string>(BLOCK_ORDER);
    const edits: ReportDraft["edits"] = {};
    for (const [k, v] of Object.entries(parsed.edits)) {
      if (known.has(k) && v && typeof (v as any).text === "string") edits[k as BlockKey] = { text: (v as any).text, base: String((v as any).base ?? ""), evidenceId: typeof (v as any).evidenceId === "string" ? (v as any).evidenceId : undefined };
    }
    return { ...parsed, edits };
  } catch {
    return null;
  }
}

export function writeReportDraft(key: string | null, draft: ReportDraft): boolean {
  if (!key || typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(draft));
    return true;
  } catch {
    return false; // storage unavailable: the draft lives for this session only
  }
}

/** Retire a migration source only after its contents have been saved to the destination. */
export function removeReportDraft(key: string): void {
  try { localStorage.removeItem(PREFIX + key); } catch { /* Keep the source if storage is blocked. */ }
}

/** Import only a bounded draft with the same resolved variant/reference identity. */
export function parseReportDraftFile(text: string, identity: string): ReportDraft {
  if (text.length > 2_000_000) throw new Error("The draft is too large.");
  const value = JSON.parse(text);
  if (!isObject(value) || value.schema !== "mse.report-draft/1" || value.identity !== identity || !isDraft(value.draft)) throw new Error("This draft belongs to a different variant or reference, or has an unsupported format.");
  return value.draft;
}
