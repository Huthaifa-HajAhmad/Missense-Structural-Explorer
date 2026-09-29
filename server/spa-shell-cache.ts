/**
 * spa-shell-cache.ts — cache policy for the SPA shell (index.html).
 *
 * The shell names the hashed bundles of ONE build, so a browser that reuses a stored shell keeps
 * loading the previous release after a deploy. Observed 2026-09-29: commit 2dffc14 was live
 * (`/api/v1/version`), a private window showed the new Score thresholds tab, and the owner's normal
 * window kept rendering the old Threshold Guide after refreshing. Hashed `/assets/*` stay
 * `immutable` for a year; only the shell must be revalidated on every load.
 */
import type { Response } from "express";

export const SPA_SHELL_CACHE_CONTROL = "no-cache";

export function setSpaShellHeaders(res: Response): void {
  res.setHeader("Cache-Control", SPA_SHELL_CACHE_CONTROL);
}

/** `setHeaders` for `express.static(dist)`: it answers `/` and `/index.html` itself, before the fallback. */
export function setStaticShellHeaders(res: Response, filePath: string): void {
  if (filePath.endsWith(".html")) setSpaShellHeaders(res);
}
