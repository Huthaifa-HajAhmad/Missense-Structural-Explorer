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

/** Capture only formats whose credential fields can be inspected. Opaque, malformed and binary
 * bodies are omitted from diagnostics rather than copied verbatim into reports or cURL. */
export function redactRequestBody(body: BodyInit | null | undefined): unknown {
  const raw = body instanceof URLSearchParams ? body.toString() : body;
  if (typeof raw !== 'string' || raw.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? undefined : redactSecrets(parsed);
  } catch {
    if (!raw.includes('=')) return undefined;
    const fields = new URLSearchParams(raw);
    if ([...fields.keys()].some(key => !key || /[\s{}\[\]"\\]/.test(key))) return undefined;
    const redacted = new URLSearchParams();
    for (const [key, value] of fields) redacted.append(key, SECRET_FIELD.test(key) && value ? '[redacted]' : value);
    return redacted.toString();
  }
}
