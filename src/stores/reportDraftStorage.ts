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

const PREFIX = "mse.reportDraft.v1:";

export function reportDraftKey(gene: string | null | undefined, uniprotId: string | null | undefined, variant: string | null | undefined): string | null {
  const g = (gene ?? "").trim();
  const v = (variant ?? "").trim();
  if (!g || !v) return null;
  return `${g}|${(uniprotId ?? "").trim()}|${v}`;
}

function isDraft(value: any): value is ReportDraft {
  return Boolean(value) && typeof value === "object" && typeof value.sections === "object" && typeof value.edits === "object" && typeof value.meta === "object" && Array.isArray(value.citations);
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
      if (known.has(k) && v && typeof (v as any).text === "string") edits[k as BlockKey] = { text: (v as any).text, base: String((v as any).base ?? "") };
    }
    return { ...parsed, edits };
  } catch {
    return null;
  }
}

export function writeReportDraft(key: string | null, draft: ReportDraft): void {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    /* storage unavailable: the draft lives for this session only */
  }
}
