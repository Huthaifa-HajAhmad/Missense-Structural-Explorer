/**
 * spa-shell-cache.ts — cache policy for the SPA shell (index.html).
 *
 * The shell names the hashed bundles of ONE build, so a browser that reuses a stored shell keeps
 * loading the previous release after a deploy. Observed 2026-09-29: commit 2dffc14 was live
 * (`/api/v1/version`), a private window showed the new Score thresholds tab, and the owner's normal
 * window kept rendering the old Threshold Guide after refreshing. Hashed `/assets/*` stay
 * `immutable` for a year; only the shell must be revalidated on every load.
 */
import fs from "fs";
import path from "path";
import type { RequestHandler, Response } from "express";

export const SPA_SHELL_CACHE_CONTROL = "no-cache";

export function setSpaShellHeaders(res: Response): void {
  res.setHeader("Cache-Control", SPA_SHELL_CACHE_CONTROL);
}

/** `setHeaders` for `express.static(dist)`: it answers `/` and `/index.html` itself, before the fallback. */
export function setStaticShellHeaders(res: Response, filePath: string): void {
  if (filePath.endsWith(".html")) setSpaShellHeaders(res);
}

/**
 * The SPA shell handler: reads `index.html`, stamps the request's CSP nonce onto every `<script>`, and
 * sends it with the revalidate-every-load cache policy.
 *
 * It must answer EVERY shell request, `/` and `/index.html` included. `express.static` would otherwise
 * serve those two straight from disk (its default `index: "index.html"`), so the page would arrive
 * without nonces while helmet's `script-src` names one. The static mount therefore sets
 * `index: false` and `/` and `/index.html` are routed here first.
 */
export function createSpaShellHandler(distPath: string): RequestHandler {
  const htmlPath = path.join(distPath, "index.html");
  return async (_req, res) => {
    try {
      let html = await fs.promises.readFile(htmlPath, "utf8");
      const nonce = res.locals.nonce;
      if (nonce) {
        html = html.replace(/<script/g, `<script nonce="${nonce}"`);
      }
      setSpaShellHeaders(res);
      res.type("html").send(html);
    } catch (err: any) {
      console.error("[SPA Fallback Warning] Failed to inject CSP nonce into index.html:", err.message);
      setSpaShellHeaders(res);
      res.sendFile(htmlPath);
    }
  };
}
