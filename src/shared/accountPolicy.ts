/**
 * accountPolicy.ts — the password and email rules, shared by the server's checks, the browser's forms
 * and `scripts/user-admin.ts`, so no two of them can disagree about what is acceptable.
 *
 * Length is the whole rule, on purpose: composition rules ("one digit, one symbol") push people to
 * predictable patterns, while a long passphrase is both easier to remember and harder to guess.
 */
export const PASSWORD_MIN_LENGTH = 12;
/** Bounded so a megabyte "password" cannot be used to burn server CPU. */
export const PASSWORD_MAX_LENGTH = 256;

/** A plain sentence when the password is not acceptable, otherwise null. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) return "Enter a password.";
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

export const EMAIL_MAX_LENGTH = 320;

/**
 * Deliberately simple: one "@", no spaces, and a dot in the domain. Lab addresses are ordinary; the
 * check exists to catch typos, not to implement RFC 5322. Callers trim and lower-case first.
 */
export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
