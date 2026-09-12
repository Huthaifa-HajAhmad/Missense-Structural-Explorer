import { FetchWithAuth } from "./authSession";

export function createSystemApi(fetchWithAuth: FetchWithAuth) {
  return {
    async getSidecarHealth(signal?: AbortSignal): Promise<{
      reachable: boolean;
      baseUrl: string;
      latencyMs?: number;
      status?: string;
      modelLoaded?: boolean;
      activeModels?: number;
      error?: string;
      remediation?: { local: string; oci: string };
    }> {
      const res = await fetchWithAuth("/api/v1/sidecar-health", {
        timeout: 5000,
        signal
      });
      if (!res.ok) {
        return {
          reachable: false,
          baseUrl: "",
          error: `Health check failed with HTTP ${res.status}`
        };
      }
      return await res.json();
    }
  };
}
