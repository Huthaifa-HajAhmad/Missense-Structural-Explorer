/**
 * http-client.ts — Core HTTP infrastructure for all external service calls.
 *
 * Contains:
 *   - Circuit breaker setup (per-hostname)
 *   - fetchWithRetry (retry + jitter + Retry-After header support)
 *   - normalizeGeneSymbol
 *   - normalizeVariantTo3Letter
 *
 * This module has zero dependencies on other server/services modules,
 * making it safe to import anywhere without circular references.
 */
import { CircuitBreaker } from "../utils.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "../../src/aminoAcids.ts";

export function normalizeGeneSymbol(gene: string): string {
  const g = gene.trim().toUpperCase();
  if (g === "GBA1") return "GBA";
  return g;
}

const hostBreakers = new Map<string, CircuitBreaker>();

function getHostBreaker(hostname: string): CircuitBreaker {
  let breaker = hostBreakers.get(hostname);
  if (!breaker) {
    breaker = new CircuitBreaker(5, 60000); // 5 failures, 60s cooldown
    hostBreakers.set(hostname, breaker);
  }
  return breaker;
}

export async function fetchWithRetry(url: string, options: RequestInit & { timeout?: number } = {}, retries = 3, delay = 1000): Promise<Response> {
  let hostname = "unknown";
  try {
    hostname = new URL(url).hostname;
  } catch (_) {}

  const breaker = getHostBreaker(hostname);
  if (!breaker.canExecute()) {
    throw new Error(`Upstream service ${hostname} is temporarily unavailable (circuit breaker open).`);
  }

  const timeoutMs = options.timeout ?? 15000;
  let lastStatus = 200;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);

      if (res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) {
        breaker.recordFailure();
        lastStatus = res.status;
        let backoff = delay * (2 ** i);
        let hasRetryAfter = false;
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("Retry-After");
          if (retryAfterHeader) {
            const seconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(seconds)) {
              backoff = seconds * 1000;
              hasRetryAfter = true;
            } else {
              const date = Date.parse(retryAfterHeader);
              if (!isNaN(date)) {
                backoff = Math.max(0, date - Date.now());
                hasRetryAfter = true;
              }
            }
          }
        }
        if (!hasRetryAfter) {
          const jitter = 0.5 + Math.random() * 0.5;
          backoff = Math.round(backoff * jitter);
        }
        console.warn(`[Upstream Fetch ${res.status}] error/limit on ${url}. Retrying after ${backoff}ms (attempt ${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      breaker.recordSuccess();
      return res;
    } catch (err: any) {
      breaker.recordFailure();
      if (i === retries - 1) {
        err.statusCode = lastStatus;
        throw err;
      }
      const jitter = 0.5 + Math.random() * 0.5;
      const backoff = Math.round(delay * (2 ** i) * jitter);
      console.warn(`[Upstream Fetch Error] Failed to fetch ${url} (attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  const errObj = new Error(`Failed to fetch ${url} after ${retries} attempts.`);
  (errObj as any).statusCode = lastStatus;
  throw errObj;
}

export function normalizeVariantTo3Letter(variant: string): string {
  const clean = variant.replace(/^p\./i, "").trim();
  const match = clean.match(/^([a-zA-Z]{3}|[a-zA-Z])(\d+)([a-zA-Z]{3}|[a-zA-Z])$/);
  if (!match) return clean;

  let wt = match[1];
  const pos = match[2];
  let mut = match[3];

  if (wt.length === 1) {
    wt = AMINO_ACID_1_TO_3_TITLE[wt.toUpperCase()] || wt;
  } else {
    wt = wt.charAt(0).toUpperCase() + wt.slice(1).toLowerCase();
  }

  if (mut.length === 1) {
    mut = AMINO_ACID_1_TO_3_TITLE[mut.toUpperCase()] || mut;
  } else {
    mut = mut.charAt(0).toUpperCase() + mut.slice(1).toLowerCase();
  }

  return `${wt}${pos}${mut}`;
}
