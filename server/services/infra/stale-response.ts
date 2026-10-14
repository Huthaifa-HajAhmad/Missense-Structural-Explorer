/**
 * stale-response.ts — tells the reader when a response used saved data past its expiry (WP-I2).
 *
 * The API router runs each request in a cache scope. When a provider limits requests and
 * `getCachedOrFetch` serves an expired entry instead of failing, the entry is noted in that scope, and
 * this middleware adds `X-MSE-Stale` to the response just before its headers go out. The client reads
 * it and says how old the data is and why (`staleDataSentence`).
 */
import type express from "express";
import {
  STALE_DATA_HEADER,
  encodeStaleData,
  isKnownProviderHost,
  providerLabelForHost,
  type StaleDataNote,
} from "../../../src/shared/providerLimits.ts";
import { currentCacheScope, newCacheScope, runInCacheScope, type StaleServe } from "./cache-scope.ts";

/**
 * Reader-facing notes. A host the deployment does not call on its own account was chosen by some
 * request (a person's own endpoint); a shared cache fill can carry it into another person's response,
 * so it is named only generically.
 */
export function staleNotes(serves: readonly StaleServe[]): StaleDataNote[] {
  return serves.map(s => {
    const known = s.hosts.find(isKnownProviderHost);
    return {
      data: s.source,
      provider: known ? providerLabelForHost(known) : "A remote provider",
      ageSec: s.ageSec,
      ...(s.busy ? { busy: true } : {}),
    };
  });
}

/**
 * The notes for the current request so far. A streamed response has sent its headers before its data
 * is fetched, so it reports them in a final frame instead (`{type: "stale", notes}`).
 */
export function currentStaleNotes(): StaleDataNote[] {
  return staleNotes(currentCacheScope()?.stale ?? []);
}

export const markStaleResponses: express.RequestHandler = (_req, res, next) => {
  const scope = newCacheScope();
  const writeHead = res.writeHead;
  res.writeHead = function (this: express.Response, ...args: unknown[]) {
    if (scope.stale.length > 0 && !res.headersSent) {
      res.setHeader(STALE_DATA_HEADER, encodeStaleData(staleNotes(scope.stale)));
    }
    return (writeHead as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof res.writeHead;
  runInCacheScope(scope, next);
};
