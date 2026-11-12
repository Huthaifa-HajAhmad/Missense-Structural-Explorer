import { useEffect, useState } from "react";
import type { VersionData } from "../types/diagnostics";

/** null while the request runs; "unavailable" when the server did not answer with a version. */
export type AppVersion = VersionData | null | "unavailable";

/** The running version. Its own request, so showing a version number does not run the health checks. */
export function useAppVersion(): AppVersion {
  const [version, setVersion] = useState<AppVersion>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/version", { signal: controller.signal })
      .then(response => (response.ok ? response.json() : "unavailable"))
      .then(data => { if (!controller.signal.aborted) setVersion(data?.version ? data : "unavailable"); })
      .catch(() => { if (!controller.signal.aborted) setVersion("unavailable"); });
    return () => controller.abort();
  }, []);
  return version;
}

/** "v1.2.0 · production", or a plain word while loading or when the version is not known. */
export function versionLabel(version: AppVersion): string {
  if (version === null) return "…";
  if (version === "unavailable") return "Version unavailable";
  return `v${version.version}${version.env ? ` · ${version.env}` : ""}`;
}
