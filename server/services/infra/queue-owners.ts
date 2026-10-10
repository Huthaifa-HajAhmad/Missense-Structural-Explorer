/**
 * Who a queued job belongs to. A separate module so callers that only need the names (pre-warm, the
 * cancel route) do not import the queue itself and its database.
 */

/** Owner of jobs that predate accounts, and of anonymous submissions in `legacy` auth mode. */
export const LEGACY_OWNER = "legacy";
/** Owner of background work (pre-warm). Always sorted behind any user's job. */
export const SYSTEM_OWNER = "system";
/** Priority of background work: below every user's job (which default to 0). */
export const SYSTEM_PRIORITY = -10;

/**
 * A person's own limit was reached: their waiting jobs (`QUEUED_PER_USER`) or their daily server time
 * (`DAILY_SERVER_TIME`, only when a cap is configured). Answered with 429 and this message verbatim,
 * because unlike a full host it is about them and they can act on it.
 */
export class QueueLimitError extends Error {
  readonly status = 429;
  constructor(readonly code: "QUEUED_PER_USER" | "DAILY_SERVER_TIME", message: string) {
    super(message);
    this.name = "QueueLimitError";
  }
}

/** The limits that apply to one submitter, resolved by the route from settings and the user's overrides. */
export interface SubmitterLimits {
  queuedPerUser: number;
  /** null = no daily cap (the default). */
  serverSecondsPerDay: number | null;
}
