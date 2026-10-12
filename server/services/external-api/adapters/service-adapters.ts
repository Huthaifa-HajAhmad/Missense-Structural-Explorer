/**
 * server/services/adapters/service-adapters.ts — Concrete implementations of external service adapters.
 */

import type { ExternalServiceAdapter, HealthStatus } from "./types.ts";
import { adapterRegistry } from "./registry.ts";
import { fetchWithRetry } from "../../infra/http-client.ts";
import { CONFIG } from "../../../config.ts";

export class ClinVarAdapter implements ExternalServiceAdapter<{ gene: string; variant: string }, any> {
  readonly id = "clinvar";
  readonly name = "NCBI ClinVar";
  readonly version = "2024.12";
  readonly rateLimitPerSecond = 3;

  cacheKey(input: { gene: string; variant: string }): string {
    return `clinvar_v${this.version}_${input.gene.toUpperCase()}_${input.variant.toUpperCase()}`;
  }

  async fetch(input: { gene: string; variant: string }, signal?: AbortSignal): Promise<any> {
    const { fetchClinVarData } = await import("../clinvar.ts");
    return fetchClinVarData(input.gene, input.variant);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=clinvar&retmode=json", {
        timeout: 3000,
        probe: true,
        signal
      }, 1);
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: res.ok,
        latencyMs,
        message: res.ok ? "NCBI ClinVar API Reachable" : `HTTP ${res.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class DbnsfpAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "dbnsfp";
  readonly name = "dbNSFP Predictors";
  readonly version = "4.9a";

  cacheKey(input: { gene: string; variant: string }): string {
    return `dbnsfp_v${this.version}_${input.gene}_${input.variant}`;
  }

  async fetch(input: any): Promise<any> {
    const { fetchConservationData } = await import("../../prediction/index.ts");
    return fetchConservationData(input.gene, input.variant);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const { isLocalDbnsfpAvailable } = await import("../../prediction/dbnsfp_local.ts");
      const localAvailable = isLocalDbnsfpAvailable();
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: true,
        latencyMs,
        message: localAvailable ? "Local SQLite dbNSFP Active" : "Remote dbNSFP Query Fallback Active",
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class GenosAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "genos";
  readonly name = "Genos Web Service";
  readonly version = "1.0";
  readonly rateLimitPerSecond = 5;

  cacheKey(input: { gene: string; variant: string }): string {
    return `genos_v${this.version}_${input.gene}_${input.variant}`;
  }

  async fetch(input: any): Promise<any> {
    const { queryGenosWebservice } = await import("../genos_web.ts");
    return queryGenosWebservice(input.gene, input.variant, input.gnomadVariantId);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://genos.app/api/v1/health", {
        timeout: 3000,
        probe: true,
        signal
      }, 1);
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: res.ok,
        latencyMs,
        message: res.ok ? "Genos API Active" : `HTTP ${res.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class UniProtAdapter implements ExternalServiceAdapter<string, any> {
  readonly id = "uniprot";
  readonly name = "UniProtKB";
  readonly version = "2024_06";
  readonly rateLimitPerSecond = 10;

  cacheKey(uniprotId: string): string {
    return `uniprot_v${this.version}_${uniprotId.toUpperCase()}`;
  }

  async fetch(uniprotId: string): Promise<any> {
    const { fetchUniprotSequence } = await import("../uniprot.ts");
    return fetchUniprotSequence(uniprotId);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://rest.uniprot.org/uniprotkb/P04637.json?fields=accession", {
        timeout: 3000,
        probe: true,
        signal
      }, 1);
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: res.ok,
        latencyMs,
        message: res.ok ? "UniProtKB API Reachable" : `HTTP ${res.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class SidecarAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "sidecar";
  readonly name = "Python ML Sidecar";
  readonly version = "1.0.0";

  cacheKey(input: any): string {
    return `sidecar_v${this.version}_${input.model || "default"}`;
  }

  async fetch(input: any): Promise<any> {
    return null;
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/health`, {
        signal: signal || AbortSignal.timeout(CONFIG.timeouts.sidecarHealthCheckMs)
      });
      const latencyMs = Math.round(performance.now() - start);
      if (sidecarRes.ok) {
        const data = await sidecarRes.json() as any;
        /**
         * `tools/model_server.py` returns `status: "healthy"` unconditionally and puts the real
         * distinction in `state`. Reading `status` alone therefore reported "ML Model Server
         * Healthy" — and downstream, a green "Neural Sidecar Live" — for the whole ~180 s
         * weight-loading window, while every ML-backed call in that window failed. `state` is the
         * only honest signal here, and its absence from this probe is what made the
         * "ML Sidecar Model Loading" arm below unreachable.
         */
        const warming = data.state === "warming_up";
        return {
          healthy: !warming && data.status === "healthy",
          state: warming ? "warming_up" : "ready",
          latencyMs,
          message: warming
            ? "Loading model weights — ML features unavailable until ready"
            : "ML Model Server Healthy",
          timestamp: new Date().toISOString()
        };
      }
      return {
        healthy: false,
        latencyMs,
        message: `HTTP ${sidecarRes.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message || "Sidecar offline",
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class EnsemblAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "ensembl";
  readonly name = "Ensembl VEP";
  readonly version = "113";
  readonly rateLimitPerSecond = 15;

  cacheKey(input: { gene: string; variant?: string }): string {
    return `ensembl_${input?.gene || "default"}_${input?.variant || ""}`;
  }

  async fetch(input: { gene: string; variant: string }, _signal?: AbortSignal): Promise<any> {
    const { fetchPredictorData } = await import("../../prediction/index.ts");
    return fetchPredictorData(input.gene, input.variant);
  }

  /**
   * Reports whether the Ensembl REST API is answering.
   *
   * Three corrections over the original single probe, all from production investigations:
   *   - `/info/ping` is NOT a reliable liveness signal: it answered HTTP 500 in 425ms while VEP itself
   *     was serving requests, and it routinely takes ~7s while VEP answers in <1s. A broken or slow
   *     ping endpoint made the whole service look down. A second, documented endpoint is tried
   *     before declaring failure;
   *   - `/info/software` is probed FIRST because it is fast and reliable; `/info/ping` is the fallback;
   *   - a TIMEOUT on one endpoint falls through to the next instead of returning immediately, and is
   *     reported as slowness rather than as unreachability, because "not answering quickly" and
   *     "not there" call for different responses.
   */
  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    const endpoints = [
      "https://rest.ensembl.org/info/software",
      "https://rest.ensembl.org/info/ping",
    ];
    let lastStatus: number | null = null;
    let sawTimeout = false;

    for (const endpoint of endpoints) {
      if (signal?.aborted) break;
      try {
        const res = await fetchWithRetry(
          endpoint,
          {
            headers: { "Content-Type": "application/json" },
            timeout: 5000,
            signal,
            /**
             * `probe`: health-check traffic must not be booked against the per-host circuit breaker.
             * Without it the monitor IS the outage it reports — five failed probes eject the host for
             * the whole cooldown, and every real request is then answered "circuit breaker open" for a
             * provider that is actually serving.
             */
            probe: true,
          },
          1
        );
        lastStatus = res.status;
        if (res.ok) {
          return {
            healthy: true,
            latencyMs: Math.round(performance.now() - start),
            message: "Ensembl VEP REST Live",
            timestamp: new Date().toISOString(),
          };
        }
      } catch (err: any) {
        // A timeout means SLOW, which is not the same answer as "unreachable": VEP routinely needs
        // ~20s under load, and calling that a dead service sent operators looking for an outage.
        // Fall through to the next endpoint — a slow ping must not mask a fast software endpoint
        // (observed: ping ~7s while VEP answers in <1s).
        const timedOut = err?.name === "TimeoutError" || /timed out|attempt timeout|abort/i.test(String(err?.message ?? ""));
        if (timedOut) {
          sawTimeout = true;
          continue;
        }
      }
    }

    if (sawTimeout && lastStatus === null) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: "No answer within 5s (service is slow, not necessarily down)",
        timestamp: new Date().toISOString(),
      };
    }
    return {
      healthy: false,
      latencyMs: Math.round(performance.now() - start),
      message: lastStatus !== null ? `Ensembl info endpoints answered HTTP ${lastStatus}` : "Ensembl REST unreachable",
      timestamp: new Date().toISOString(),
    };
  }
}

export class EuropePmcAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "europepmc";
  readonly name = "Europe PMC & PubMed";
  readonly version = "1.0";
  readonly rateLimitPerSecond = 10;

  cacheKey(input: { query?: string; gene: string }): string {
    return `europepmc_${input?.gene || "default"}_${input?.query || ""}`;
  }

  async fetch(input: { query?: string; gene: string }, signal?: AbortSignal): Promise<any> {
    const { searchGeneLiterature } = await import("../../llm/literature-rag.ts");
    return searchGeneLiterature(input.gene, undefined, signal, input.query);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=human&format=json&pageSize=1", {
        timeout: 3000,
        probe: true,
        signal
      }, 1);
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: res.ok,
        latencyMs,
        message: res.ok ? "Europe PMC Live" : `HTTP ${res.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message || "Europe PMC ping failed",
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class MyVariantAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "myvariant";
  readonly name = "MyVariant.info";
  readonly version = "v1";
  readonly rateLimitPerSecond = 10;

  cacheKey(input: { gene: string; variant: string }): string {
    return `myvariant_${input?.gene || "default"}_${input?.variant || ""}`;
  }

  async fetch(input: { gene: string; variant: string }, _signal?: AbortSignal): Promise<any> {
    const { fetchConservationData } = await import("../../prediction/index.ts");
    return fetchConservationData(input.gene, input.variant);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://myvariant.info/v1/metadata", {
        timeout: 3000,
        probe: true,
        signal
      }, 1);
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: res.ok,
        latencyMs,
        message: res.ok ? "MyVariant.info REST Live" : `HTTP ${res.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message || "MyVariant ping failed",
        timestamp: new Date().toISOString()
      };
    }
  }
}

export class AlphaGenomeAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "alphagenome";
  readonly name = "AlphaGenome Atlas";
  readonly version = "v1";

  cacheKey(input: { chrom: string; pos: number; ref: string; alt: string }): string {
    return `alphagenome_${input?.chrom || ""}_${input?.pos || ""}_${input?.ref || ""}_${input?.alt || ""}`;
  }

  async fetch(input: { chrom: string; pos: number; ref: string; alt: string }, signal?: AbortSignal): Promise<any> {
    const { fetchAlphaGenome } = await import("../alphagenome-bridge.ts");
    return fetchAlphaGenome(input.chrom, input.pos, input.ref, input.alt, signal);
  }

  async healthCheck(_signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const { alphagenomeCache } = await import("../alphagenome-bridge.ts");
      const hasKey = Boolean(
        process.env.ALPHAGENOME_API_KEY ||
        process.env.ALPHAGENOME_API_URL
      );
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: hasKey,
        latencyMs,
        message: hasKey
          ? `AlphaGenome Bridge Active (${alphagenomeCache.size} in cache)`
          : "Standby (API Key Required)",
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message || "AlphaGenome bridge unavailable",
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Auto-register standard service adapters
export function initStandardAdapters(): void {
  adapterRegistry.register(new ClinVarAdapter());
  adapterRegistry.register(new DbnsfpAdapter());
  adapterRegistry.register(new GenosAdapter());
  adapterRegistry.register(new UniProtAdapter());
  adapterRegistry.register(new SidecarAdapter());
  adapterRegistry.register(new EnsemblAdapter());
  adapterRegistry.register(new EuropePmcAdapter());
  adapterRegistry.register(new MyVariantAdapter());
  adapterRegistry.register(new AlphaGenomeAdapter());
}

initStandardAdapters();

export { adapterRegistry };
