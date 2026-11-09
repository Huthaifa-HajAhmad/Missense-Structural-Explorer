/** The Gemini credential fields of the settings, and the one reading of what they allow. */
export interface GeminiCredentialSettings {
  geminiApiKey?: string;
  geminiSessionId?: string;
  geminiSessionExpiresAt?: number;
}

export interface GeminiCredentials {
  serverKey: boolean;
  keyStored: boolean;
  sessionActive: boolean;
  /** A session existed and expired, and a stored key can relink it. */
  sessionLapsed: boolean;
  /** A narrative may be requested. A lapsed session counts: its stored key renews it on the next query. */
  canAttemptNarrative: boolean;
}

export function geminiCredentials(
  settings: GeminiCredentialSettings | null | undefined,
  serverKey: boolean,
  now: number
): GeminiCredentials {
  const keyStored = Boolean(settings?.geminiApiKey?.trim());
  const sessionActive = Boolean(settings?.geminiSessionId && now < (settings?.geminiSessionExpiresAt || 0));
  const sessionLapsed = keyStored && Boolean(settings?.geminiSessionId) && !sessionActive;
  return { serverKey, keyStored, sessionActive, sessionLapsed, canAttemptNarrative: serverKey || sessionActive || keyStored };
}
