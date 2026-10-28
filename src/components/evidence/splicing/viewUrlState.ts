import { SPLICE_MAP_STEPS } from '../../../shared/splicingEvidence';

/**
 * The RNA splicing view as URL parameters, so a curator can send the exact map and reading they saw:
 * `?spw=200` (map half-width in bases), `?spf=1` (the focused 0–0.3 score axis), `?sps=1` (non-zero signals
 * below the floor shown), `?spt=<transcript>` (the transcript those map settings were made on) and
 * `?spv=records` (the view: comparison, records or scales). Pure, so the tab only reads and writes.
 *
 * The parameters are this tab's alone: written while the tab is mounted, removed when it unmounts. The
 * variant identity (gene, variant, UniProt) stays `useVariantUrlSync`'s. Absent or invalid values read as
 * the defaults, and a default is never written.
 */

export const SPLICE_WINDOW_PARAM = 'spw';
export const SPLICE_FOCUS_PARAM = 'spf';
export const SPLICE_SMALL_PARAM = 'sps';
export const SPLICE_TRANSCRIPT_PARAM = 'spt';
export const SPLICE_VIEW_PARAM = 'spv';

/** The workspace views the splicing tab offers: comparison (the map), records (channel details) and scales. */
export const SPLICE_VIEWS = ['comparison', 'records', 'scales'] as const;
export type SpliceUrlView = (typeof SPLICE_VIEWS)[number];

/** A transcript identifier, not prose: letters, digits, dot, underscore and hyphen, at most 40 characters. */
const TRANSCRIPT_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const WINDOW_PATTERN = /^\d{1,4}$/;

export interface SpliceUrlState {
  /** The transcript the map settings were made on. Written only alongside a map setting. */
  transcript: string | null;
  /** Map half-width in bases; null is the auto width. Only the widths SpliceMap offers are valid. */
  halfWidth: number | null;
  focusedScore: boolean;
  showSmallSignals: boolean;
  view: SpliceUrlView;
}

export const SPLICE_URL_DEFAULTS: SpliceUrlState = { transcript: null, halfWidth: null, focusedScore: false, showSmallSignals: false, view: 'comparison' };

/** True for a half-width the map can draw: the steps SpliceMap's own width control offers (50 to 2000 bases). */
export function isSpliceHalfWidth(value: number): boolean {
  return (SPLICE_MAP_STEPS as readonly number[]).includes(value);
}

/** A digits-only half-width that is one of the offered steps; anything else (negative, prose, huge, off-step) is auto. */
export function parseSpliceWindow(raw: string | null): number | null {
  if (raw === null || !WINDOW_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return isSpliceHalfWidth(value) ? value : null;
}

/** Only the exact value `1` turns a flag on. */
export function parseSpliceFlag(raw: string | null): boolean {
  return raw === '1';
}

export function parseSpliceTranscript(raw: string | null): string | null {
  return raw !== null && TRANSCRIPT_PATTERN.test(raw) ? raw : null;
}

/** An unknown or foreign view id reads as the comparison, the tab's first view. */
export function parseSpliceView(raw: string | null | undefined): SpliceUrlView {
  return (SPLICE_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as SpliceUrlView) : 'comparison';
}

/** The splicing view state the URL carries. Missing or invalid parameters read as the defaults. */
export function parseSplicingUrl(href: string): SpliceUrlState {
  const params = new URL(href).searchParams;
  return {
    transcript: parseSpliceTranscript(params.get(SPLICE_TRANSCRIPT_PARAM)),
    halfWidth: parseSpliceWindow(params.get(SPLICE_WINDOW_PARAM)),
    focusedScore: parseSpliceFlag(params.get(SPLICE_FOCUS_PARAM)),
    showSmallSignals: parseSpliceFlag(params.get(SPLICE_SMALL_PARAM)),
    view: parseSpliceView(params.get(SPLICE_VIEW_PARAM)),
  };
}

/**
 * The URL with this tab's parameters set to `state`; a default (or an invalid value) removes its parameter.
 * Parameters are touched only when they differ, so an unchanged URL comes back as the input string, byte for byte.
 */
export function withSplicingParams(href: string, state: SpliceUrlState): string {
  const url = new URL(href);
  const apply = (name: string, value: string | null) => {
    if (url.searchParams.get(name) === value) return;
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  };
  const halfWidth = state.halfWidth !== null && isSpliceHalfWidth(state.halfWidth) ? state.halfWidth : null;
  const transcript = state.transcript !== null && TRANSCRIPT_PATTERN.test(state.transcript) ? state.transcript : null;
  apply(SPLICE_WINDOW_PARAM, halfWidth === null ? null : String(halfWidth));
  apply(SPLICE_FOCUS_PARAM, state.focusedScore ? '1' : null);
  apply(SPLICE_SMALL_PARAM, state.showSmallSignals ? '1' : null);
  apply(SPLICE_TRANSCRIPT_PARAM, transcript);
  apply(SPLICE_VIEW_PARAM, state.view === 'comparison' ? null : state.view);
  const next = url.toString();
  return next === new URL(href).toString() ? href : next;
}
