/**
 * credentials.ts — whose token a remote model call used, in words a reader understands (WP-I4).
 *
 * Biohub (EvolutionaryScale Forge), Hugging Face and Tamarind each count calls against the token that
 * made them. A person's own token uses their own allowance; without one, the server may lend the team's
 * token, which everyone shares. The server reports which one each response used (`X-MSE-Credentials`) and
 * the client says so after the result, so a reader knows when adding their own token would help the team.
 *
 * Purity is a boundary requirement: `src/shared` may not import from outside itself.
 */

export const CREDENTIAL_KINDS = ["biohub", "huggingface", "tamarind"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** `own`: the person's token (sent with the request or saved to their account). `team`: the server's. */
export type CredentialSource = "own" | "team" | "none";

/** Why no token was used although the team has one. */
export type CredentialRefusal = "team-token-off" | "team-share-used" | "own-token-unreadable";

/** `SHARED_TOKEN_FALLBACK`: how a person without a token may use the team's. */
export type SharedTokenFallback = "on" | "limited" | "off";

export const CREDENTIAL_LABELS: Readonly<Record<CredentialKind, string>> = {
  biohub: "Biohub",
  huggingface: "Hugging Face",
  tamarind: "Tamarind",
};

/** One kind's use in one response. */
export interface CredentialUse {
  kind: CredentialKind;
  source: CredentialSource;
  refusal?: CredentialRefusal;
}

/** Response header listing the credentials a response's remote calls used. Value: {@link encodeCredentialUse}. */
export const CREDENTIALS_HEADER = "X-MSE-Credentials";

export function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === "string" && (CREDENTIAL_KINDS as readonly string[]).includes(value);
}

const SOURCES: readonly CredentialSource[] = ["own", "team", "none"];
const REFUSALS: readonly CredentialRefusal[] = ["team-token-off", "team-share-used", "own-token-unreadable"];

export function encodeCredentialUse(uses: readonly CredentialUse[]): string {
  const byKind = new Map<CredentialKind, CredentialUse>();
  for (const u of uses) byKind.set(u.kind, u);
  return JSON.stringify(
    [...byKind.values()].map(u => ({ kind: u.kind, source: u.source, ...(u.refusal ? { refusal: u.refusal } : {}) }))
  );
}

/** The uses in a {@link CREDENTIALS_HEADER} value; empty for a missing or malformed one. */
export function parseCredentialUse(value: string | null | undefined): CredentialUse[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (u): u is CredentialUse =>
          Boolean(u) &&
          isCredentialKind(u.kind) &&
          SOURCES.includes(u.source) &&
          (u.refusal === undefined || REFUSALS.includes(u.refusal))
      )
      .slice(0, CREDENTIAL_KINDS.length)
      .map(u => ({ kind: u.kind, source: u.source, ...(u.refusal ? { refusal: u.refusal } : {}) }));
  } catch {
    return [];
  }
}

/** "your token", "the team token", "no token". */
export function credentialSourceLabel(source: CredentialSource): string {
  return source === "own" ? "your token" : source === "team" ? "the team token" : "no token";
}

/**
 * The sentence after a result:
 *   own   "Biohub ran on your token."
 *   team  "Biohub ran on the team token. Add your own in Settings → Connections so your requests use your
 *          allowance and do not slow the team."
 *   none  (refused) "Biohub was not run: you have used your share of the team token this hour. Add your own
 *          token in Settings → Connections." / "...: the team token is not lent out on this server. ..."
 * Null when there is nothing worth saying (no token and nothing refused).
 */
export function credentialUseSentence(use: CredentialUse): string | null {
  const name = CREDENTIAL_LABELS[use.kind];
  if (use.source === "own") return `${name} ran on your token.`;
  if (use.source === "team") {
    return `${name} ran on the team token. Add your own in Settings → Connections so your requests use your allowance and do not slow the team.`;
  }
  if (use.refusal === "team-share-used") {
    return `${name} was not run: you have used your share of the team token this hour. Add your own token in Settings → Connections.`;
  }
  if (use.refusal === "own-token-unreadable") {
    return `${name} was not run: the token saved to your account can no longer be read by the server. Save it again in Settings → Connections.`;
  }
  if (use.refusal === "team-token-off") {
    return `${name} was not run: this server does not lend its team token. Add your own token in Settings → Connections.`;
  }
  return null;
}
