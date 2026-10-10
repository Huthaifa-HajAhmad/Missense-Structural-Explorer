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
