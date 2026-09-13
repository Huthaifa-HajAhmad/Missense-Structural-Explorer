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
        timeout: 3000,
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
        timeout: 3000,
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

export class EnsemblAdapter implements ExternalServiceAdapter<any, any> {
  readonly id = "ensembl";
  readonly name = "Ensembl VEP";
  readonly version = "113";
  readonly rateLimitPerSecond = 15;

  cacheKey(input: { gene: string; variant?: string }): string {
    return `ensembl_${input?.gene || "default"}_${input?.variant || ""}`;
  }

  async fetch(input: { gene: string; variant: string }, _signal?: AbortSignal): Promise<any> {
    const { fetchPredictorData } = await import("../predictors/vep-orchestrator.ts");
    return fetchPredictorData(input.gene, input.variant);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://rest.ensembl.org/info/ping", {
        headers: { "Content-Type": "application/json" },
        timeout: 3000,
        signal
      }, 1);
      const latencyMs = Math.round(performance.now() - start);
      return {
        healthy: res.ok,
        latencyMs,
        message: res.ok ? "Ensembl VEP REST Live" : `HTTP ${res.status}`,
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Math.round(performance.now() - start),
        message: err.message || "Ensembl ping failed",
        timestamp: new Date().toISOString()
      };
    }
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
    const { searchGeneLiterature } = await import("../literature-rag.ts");
    return searchGeneLiterature(input.gene, undefined, signal, input.query);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=human&format=json&pageSize=1", {
        timeout: 3000,
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
    const { fetchConservationData } = await import("../predictors.ts");
    return fetchConservationData(input.gene, input.variant);
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetchWithRetry("https://myvariant.info/v1/metadata", {
        timeout: 3000,
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
