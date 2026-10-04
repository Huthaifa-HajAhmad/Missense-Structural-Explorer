/**
 * The Functional domains view as URL parameters, so a curator can send the exact window and open row:
 * `?fnd=whole`, `?fnd=near` or `?fnd=66-166`, and `?fsel=<row key>`. Pure, so the tab only reads and writes.
 *
 * The parameters are this tab's alone: they are written while the tab is mounted and removed when it unmounts,
 * and the variant identity (gene, variant, UniProt) stays `useVariantUrlSync`'s.
 */

export const FND_WINDOW_PARAM = "fnd";
export const FND_SELECTION_PARAM = "fsel";

export type FndView = "whole" | "near" | { start: number; end: number };

export function parseFndView(raw: string | null, length: number): FndView | null {
  if (!raw) return null;
  if (raw === "whole" || raw === "near") return raw;
  const m = /^(\d{1,6})-(\d{1,6})$/.exec(raw);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!(start >= 1 && end > start && end <= Math.max(length, 1))) return null;
  return { start, end };
}

export function formatFndView(view: FndView): string {
  return typeof view === "string" ? view : `${view.start}-${view.end}`;
}

/** The URL with this tab's parameters set (or removed when `null`). Returns the input when nothing changes. */
export function withFndParams(href: string, view: FndView | null, selection: string | null): string {
  const url = new URL(href);
  const apply = (name: string, value: string | null) => {
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  };
  apply(FND_WINDOW_PARAM, view === null ? null : formatFndView(view));
  apply(FND_SELECTION_PARAM, selection);
  return url.toString();
}
