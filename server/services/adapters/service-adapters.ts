/**
 * server/services/adapters/service-adapters.ts — Concrete implementations of external service adapters.
 */

import type { ExternalServiceAdapter, HealthStatus } from "./types.ts";
import { adapterRegistry } from "./registry.ts";
import { fetchWithRetry } from "../http-client.ts";
import { CONFIG } from "../../config.ts";

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
        timeout: 5000,
        signal
      });
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
    const { fetchConservationData } = await import("../predictors.ts");
    return fetchConservationData(input.gene, input.variant);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const { isLocalDbnsfpAvailable } = await import("../dbnsfp_local.ts");
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
        timeout: 5000,
        signal
      });
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
        timeout: 5000,
        signal
      });
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
        return {
          healthy: data.status === "healthy",
          latencyMs,
          message: data.status === "healthy" ? "ML Model Server Healthy" : "ML Sidecar Model Loading",
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

// Auto-register standard service adapters
export function initStandardAdapters(): void {
  adapterRegistry.register(new ClinVarAdapter());
  adapterRegistry.register(new DbnsfpAdapter());
  adapterRegistry.register(new GenosAdapter());
  adapterRegistry.register(new UniProtAdapter());
  adapterRegistry.register(new SidecarAdapter());
}

initStandardAdapters();

export { adapterRegistry };
