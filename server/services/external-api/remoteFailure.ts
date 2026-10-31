/** engine_resilience.FAILURE_CODES on the sidecar: why a remote engine did not answer, as data. */
export const REMOTE_FAILURE_CODES = ["billing", "auth", "region", "rate-limit", "timeout", "invalid-response", "unavailable"] as const;

export interface RemoteFailure {
  provider: string;
  code: (typeof REMOTE_FAILURE_CODES)[number];
}

/** The sidecar's `remoteFailure`, validated once here; anything else is treated as absent. */
export function parseRemoteFailure(raw: any): RemoteFailure | null {
  return typeof raw?.provider === "string" && REMOTE_FAILURE_CODES.includes(raw.code)
    ? { provider: raw.provider, code: raw.code }
    : null;
}
