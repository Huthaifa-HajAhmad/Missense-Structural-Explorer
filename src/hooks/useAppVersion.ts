import { useEffect, useState } from "react";
import type { VersionData } from "../types/diagnostics";

/** The running version. Its own request, so showing a version number does not run the health checks. */
export function useAppVersion(): VersionData | null {
  const [version, setVersion] = useState<VersionData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/version", { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (!controller.signal.aborted) setVersion(data); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return version;
}
