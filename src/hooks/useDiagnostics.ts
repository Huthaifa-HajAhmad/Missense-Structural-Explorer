import { useCallback, useEffect, useState } from "react";

export interface CacheDiagnostic {
  size: number;
  max: number;
  ttl: string;
}

export interface DiagnosticsData {
  status: string;
  timestamp: string;
  foldxReady: boolean;
  geminiReady: boolean;
  geminiModel?: string;
  modelServerReady: boolean;
  auditLogFailures?: number;
  cacheDiagnostics?: Record<string, CacheDiagnostic>;
}

export interface VersionData {
  version: string;
  env: string;
}

/**
 * Fetches the server diagnostics and version payloads. /api/v1/diagnostics
 * already existed but only geminiReady was ever consumed; this hook exposes
 * the full readiness + cache table for the settings Connections/About panels.
 */
export function useDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [version, setVersion] = useState<VersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [diagRes, versionRes] = await Promise.all([
        fetch("/api/v1/diagnostics"),
        fetch("/api/v1/version")
      ]);
      if (diagRes.ok) {
        setDiagnostics(await diagRes.json());
      }
      if (versionRes.ok) {
        setVersion(await versionRes.json());
      }
      if (!diagRes.ok && !versionRes.ok) {
        setError(`Diagnostics unavailable (HTTP ${diagRes.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { diagnostics, version, loading, error, refresh };
}
