/** Field names that carry a credential: `apiKey`, `alphagenomeApiKey`, `hfToken`, `password`, ... */
const SECRET_FIELD = /api[-_]?key|token|secret|password|authorization/i;

/**
 * Masks the string values of credential-looking fields, recursively, so a logged request body (and any
 * curl command built from it) never shows a live key. Non-string values and other fields are kept as-is.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        SECRET_FIELD.test(key) && typeof field === "string" && field ? "[redacted]" : redactSecrets(field),
      ]),
    );
  }
  return value;
}
