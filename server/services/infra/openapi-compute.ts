/**
 * openapi-compute.ts — the OpenAPI paths for queued compute, accounts, jobs and admin
 * (`doc/COMPUTE_ROUTING_PLAN.md`, WP-A/B/D/E/G1).
 *
 * Kept apart from the analysis paths in `openapi.ts` because these routes share one model: queued
 * server work owned by a person, and a signed-in browser carrying the `mse_session` cookie
 * (`SessionCookie`). Account responses are `Cache-Control: no-store`. `server/routes/docs.test.ts`
 * checks that every route registered in `routes/auth.ts`, `routes/admin.ts` and the job routes is
 * listed here, so a new route cannot ship undocumented.
 */

const json = (schema: object, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});
const body = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const error = (description: string) => json(ref("ErrorResponse"), description);
const signedIn = [{ SessionCookie: [] }];
const jobIdParam = { name: "jobId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_\\-]{1,100}$" } };
const userIdParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

const signInRequired = error("SIGN_IN_REQUIRED: no signed-in session.");
const adminOnly = error("ADMIN_ONLY: the signed-in person is not a workspace admin.");
const tooManyAttempts = error("TOO_MANY_ATTEMPTS: throttled; `Retry-After` gives the seconds to wait.");
const weakPassword = error("BAD_REQUEST or WEAK_PASSWORD, with a reader-facing message.");

export const COMPUTE_SCHEMAS = {
  User: {
    type: "object",
    description: "What the browser may see of an account. Never the password hash.",
    properties: {
      id: { type: "string" },
      email: { type: "string", format: "email" },
      displayName: { type: "string" },
      role: { type: "string", enum: ["admin", "member"] },
      status: { type: "string", enum: ["active", "disabled"] },
      shareResults: { type: "boolean", description: "Whether this person's server results may be reused for colleagues." },
      placementPref: ref("PlacementPref"),
      createdAt: { type: "integer", description: "Epoch ms." },
      lastLoginAt: { type: ["integer", "null"], description: "Epoch ms." },
    },
  },
  PlacementPref: {
    type: "string",
    enum: ["auto", "my_machine", "server_only"],
    description: "Where this person's jobs should run. Only `auto` and `server_only` have an effect until paired computers (WP-F) exist.",
  },
  Quota: {
    type: ["object", "null"],
    description: "An admin's explicit per-person override. null = the server defaults apply.",
    properties: {
      queuedPerUser: { type: "integer", minimum: 1, maximum: 500 },
      serverSecondsPerDay: { type: "integer", minimum: 60 },
    },
  },
  JobSummary: {
    type: "object",
    description: "One of the caller's queued jobs: submitted by them, or joined because they asked for the same result.",
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: ["foldx", "p2rank"] },
      status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
      error: { type: "string", description: "Set on `failed`. Exactly `Cancelled.` when the job was cancelled rather than failing." },
      createdAt: { type: "integer" },
      startedAt: { type: ["integer", "null"] },
      completedAt: { type: ["integer", "null"] },
      ownerId: { type: ["string", "null"], description: "The caller's own id when they own the job; null when they only joined it. Never another person's id." },
      mine: { type: "boolean", description: "True when the caller owns the job." },
      queuedAhead: { type: ["integer", "null"], description: "Jobs that will start before this one, while queued." },
      etaMs: { type: ["integer", "null"], description: "Estimated wait before it starts, while queued; null when unknown." },
      label: { type: ["string", "null"], description: "Short human label from the job's input (mutation or protein)." },
    },
  },
} as const;

export const COMPUTE_TAGS = [
  { name: "Accounts", description: "Invite-only sign-in, first-admin setup, password reset and personal preferences. See doc/ACCOUNTS.md." },
  { name: "Jobs", description: "The signed-in person's queued FoldX and pocket jobs: list, cancel, live updates." },
  { name: "Admin", description: "Workspace admin tools: invites, accounts, reset links and learned compute limits." },
];

/** Refusals a queued submission can meet, shared by the FoldX and pocket submit routes. */
const queueRefusals = {
  "422": error(
    "CANNOT_RUN_HERE: the placement engine refused the job (only with `COMPUTE_ROUTING=on`), for example a structure larger than this server can run. The message is written for the reader.",
  ),
  "429": error(
    "QUEUED_PER_USER (too many of your jobs waiting) or DAILY_SERVER_TIME (your daily server time is used; only when a cap is set). The message says what to do.",
  ),
  "503": error("SERVICE_UNAVAILABLE or CONCURRENCY_LIMIT: the server-wide queue is full (QUEUE_MAX_TOTAL). Try again later."),
};

const queuedAhead = { type: ["integer", "null"], description: "Jobs that will start before this one, while queued." };
const jobStatus = { type: "string", enum: ["queued", "running", "completed", "failed"] };

/** The queued FoldX and pocket routes: submit (cache hit or queued envelope) and poll. */
const QUEUED_COMPUTE_PATHS = {
  "/generate-mutant": {
    post: {
      tags: ["Structural Biophysics"],
      summary: "Run FoldX on a mutation: answered from cache, or queued",
      description:
        "Identical requests share one job: a second caller joins the job instead of starting another. " +
        "Poll `/foldx-job/{jobId}` (or subscribe to `/jobs/events`) while `status` is `queued`.",
      operationId: "generateMutant",
      requestBody: body({
        type: "object",
        required: ["mutation"],
        properties: {
          mutation: { type: "string", example: "VA600E", description: "FoldX mutation code: wild-type residue, chain, position, mutant residue." },
          wtPdb: { type: "string", description: "Wild-type structure as PDB text. When omitted, the AlphaFold model for `uniprotId` is used." },
          uniprotId: { type: "string", example: "P15056" },
          pH: { type: ["number", "string"] },
          temperature: { type: ["number", "string"], description: "Kelvin." },
          ionicStrength: { type: ["number", "string"], description: "Molar." },
        },
      }),
      responses: {
        "200": json(
          {
            type: "object",
            description: "Either the finished result (a cache hit), or a queued envelope with these fields.",
            properties: {
              status: { type: "string", example: "queued" },
              foldxJobId: { type: "string" },
              phase: { type: ["string", "null"], description: "`queued`, or the running phase of a job this request joined." },
              startedAt: { type: ["integer", "null"] },
              elapsedMs: { type: ["integer", "null"] },
              queuedAhead,
              queuedEtaMs: { type: ["integer", "null"], description: "Estimated wait before it starts; null when unknown or running." },
            },
          },
          "Result or queued job",
        ),
        "400": error("BAD_REQUEST: malformed or synonymous mutation code."),
        ...queueRefusals,
      },
    },
  },
  "/foldx-job/{jobId}": {
    get: {
      tags: ["Structural Biophysics"],
      summary: "Poll a FoldX job",
      operationId: "getFoldxJob",
      parameters: [jobIdParam],
      responses: {
        "200": json({
          type: "object",
          description: "Queued or running: progress. Completed: the energetics result. Failed: `error`, which is exactly `Cancelled.` for a cancelled job.",
          properties: {
            jobId: { type: "string" },
            status: jobStatus,
            phase: { type: ["string", "null"] },
            startedAt: { type: ["integer", "null"] },
            elapsedMs: { type: ["integer", "null"] },
            createdAt: { type: ["integer", "null"] },
            queuedAhead: { type: "integer", description: "0 unless queued." },
            queuedEtaMs: { type: ["integer", "null"] },
            error: { type: "string" },
          },
        }),
        "400": error("BAD_REQUEST: malformed job id."),
        "404": error("NOT_FOUND."),
      },
    },
  },
  "/pocket-finder": {
    post: {
      tags: ["Structural Biophysics"],
      summary: "Find the binding pocket nearest a residue (P2Rank, fpocket fallback): answered from cache, or queued",
      operationId: "findPocket",
      requestBody: body({
        type: "object",
        description: "One structure source (`pdbText`, `pdbRef`, `uniprotId` or `structureRef`) and one residue (`targetIndex` or `mutIndex`).",
        properties: {
          pdbText: { type: "string" },
          pdbRef: { type: "string" },
          uniprotId: { type: "string" },
          structureRef: { type: "string" },
          targetIndex: { type: ["integer", "string"] },
          mutIndex: { type: ["integer", "string"] },
          targetChain: { type: "string", default: "A" },
        },
      }),
      responses: {
        "200": json(
          {
            type: "object",
            description: "Either the finished result, or `{status: \"queued\", pocketJobId, structureResolution}`.",
            properties: { status: { type: "string" }, pocketJobId: { type: "string" }, structureResolution: { type: "object" } },
          },
          "Result or queued job",
        ),
        "400": error("BAD_REQUEST."),
        "422": error("UNPROCESSABLE_ENTITY (the residue is not in the structure) or CANNOT_RUN_HERE (refused by the placement engine)."),
        "429": queueRefusals["429"],
        "503": queueRefusals["503"],
      },
    },
  },
  "/pocket-job/{jobId}": {
    get: {
      tags: ["Structural Biophysics"],
      summary: "Poll a pocket job",
      operationId: "getPocketJob",
      parameters: [jobIdParam],
      responses: {
        "200": json({
          type: "object",
          properties: {
            jobId: { type: "string" },
            status: jobStatus,
            result: { type: "object", description: "Carries `computeProvenance`: where it ran and whether it is a shared result." },
            error: { type: "string" },
            queuedAhead,
          },
        }),
        "404": error("NOT_FOUND."),
      },
    },
  },
};

export const COMPUTE_PATHS = {
  ...QUEUED_COMPUTE_PATHS,
  "/setup": {
    get: {
      tags: ["Accounts"],
      summary: "Whether the one-time first-admin setup is open",
      description: "Open only while `ADMIN_SETUP_SECRET` is set and no account exists; afterwards the endpoint answers 404 as if it never existed.",
      operationId: "getSetup",
      responses: { "200": json({ type: "object", properties: { needed: { const: true } } }), "404": error("Setup is closed.") },
    },
    post: {
      tags: ["Accounts"],
      summary: "Create the first admin account and sign in",
      operationId: "postSetup",
      requestBody: body({
        type: "object",
        required: ["secret", "email", "displayName", "password"],
        properties: {
          secret: { type: "string", description: "The server's ADMIN_SETUP_SECRET." },
          email: { type: "string", format: "email" },
          displayName: { type: "string", maxLength: 80 },
          password: { type: "string" },
        },
      }),
      responses: {
        "201": json({ type: "object", properties: { user: ref("User") } }, "Created; sets the session cookie."),
        "400": weakPassword,
        "401": error("SETUP_SECRET_INVALID."),
        "404": error("Setup is closed."),
        "429": tooManyAttempts,
      },
    },
  },
  "/auth/login": {
    post: {
      tags: ["Accounts"],
      summary: "Sign in with email and password",
      operationId: "login",
      requestBody: body({ type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } }),
      responses: {
        "200": json({ type: "object", properties: { user: ref("User") } }, "Signed in; sets the session cookie."),
        "401": error("INVALID_CREDENTIALS."),
        "429": tooManyAttempts,
      },
    },
  },
  "/auth/logout": {
    post: { tags: ["Accounts"], summary: "End this browser's session", operationId: "logout", responses: { "204": { description: "Signed out; clears the cookie." } } },
  },
  "/auth/session": {
    get: {
      tags: ["Accounts"],
      summary: "What the app should show at start-up (never 401)",
      operationId: "getSession",
      responses: {
        "200": json({
          type: "object",
          properties: {
            mode: { type: "string", enum: ["legacy", "hybrid", "accounts"], description: "The server's AUTH_MODE." },
            provider: { type: "string", enum: ["password", "cloudflare-access"] },
            user: { oneOf: [ref("User"), { type: "null" }] },
            setupAvailable: { type: "boolean" },
            accountsExist: { type: "boolean" },
          },
        }),
      },
    },
  },
  "/auth/me": {
    get: {
      tags: ["Accounts"],
      summary: "The signed-in person, their limits and their server-time usage",
      operationId: "getMe",
      security: signedIn,
      responses: {
        "200": json({
          type: "object",
          properties: {
            user: ref("User"),
            mode: { type: "string", enum: ["legacy", "hybrid", "accounts"] },
            quota: {
              type: "object",
              properties: {
                queuedPerUser: { type: "integer", description: "Waiting jobs allowed while others wait too." },
                serverSecondsPerDay: { type: ["integer", "null"], description: "null = no daily cap." },
              },
            },
            usage: {
              type: ["object", "null"],
              description: "Server seconds used today (UTC) and over the last 7 days; null when the queue is not running.",
              properties: { todaySeconds: { type: "integer" }, weekSeconds: { type: "integer" } },
            },
          },
        }),
        "401": signInRequired,
      },
    },
  },
  "/auth/invite-info": {
    post: {
      tags: ["Accounts"],
      summary: "Look up an invite before accepting it",
      description: "Invite links carry the token in the URL fragment (`#invite=…`), which never reaches a server log; the page posts it here.",
      operationId: "getInviteInfo",
      requestBody: body({ type: "object", required: ["token"], properties: { token: { type: "string", minLength: 16, maxLength: 128 } } }),
      responses: {
        "200": json({ type: "object", properties: { email: { type: "string" }, role: { type: "string", enum: ["admin", "member"] } } }),
        "404": error("INVITE_INVALID: expired, used or unknown."),
      },
    },
  },
  "/auth/accept-invite": {
    post: {
      tags: ["Accounts"],
      summary: "Accept an invite: create the account and sign in",
      operationId: "acceptInvite",
      requestBody: body({
        type: "object",
        required: ["token", "password", "displayName"],
        properties: { token: { type: "string" }, password: { type: "string" }, displayName: { type: "string", maxLength: 80 } },
      }),
      responses: {
        "201": json({ type: "object", properties: { user: ref("User") } }, "Created; sets the session cookie."),
        "400": weakPassword,
        "404": error("INVITE_INVALID."),
        "409": error("ACCOUNT_EXISTS: sign in instead."),
      },
    },
  },
  "/auth/reset": {
    post: {
      tags: ["Accounts"],
      summary: "Set a new password from an admin's reset link",
      description: "Signs out every other browser and clears any sign-in lock-out for the account.",
      operationId: "resetPassword",
      requestBody: body({ type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string" } } }),
      responses: {
        "200": json({ type: "object", properties: { user: ref("User") } }, "Password set; sets the session cookie."),
        "400": weakPassword,
        "404": error("RESET_INVALID: expired, used or unknown."),
      },
    },
  },
  "/auth/change-password": {
    post: {
      tags: ["Accounts"],
      summary: "Change your own password",
      description: "Signs out every other browser; this one stays signed in. Wrong current passwords are throttled like sign-in.",
      operationId: "changePassword",
      security: signedIn,
      requestBody: body({ type: "object", required: ["current", "next"], properties: { current: { type: "string" }, next: { type: "string" } } }),
      responses: { "204": { description: "Changed." }, "400": weakPassword, "401": error("INVALID_CREDENTIALS or SIGN_IN_REQUIRED."), "429": tooManyAttempts },
    },
  },
  "/me/preferences": {
    get: {
      tags: ["Accounts"],
      summary: "Your sharing and placement preferences",
      operationId: "getPreferences",
      security: signedIn,
      responses: {
        "200": json({ type: "object", properties: { shareResults: { type: "boolean" }, placementPref: ref("PlacementPref") } }),
        "401": signInRequired,
      },
    },
    put: {
      tags: ["Accounts"],
      summary: "Change your sharing and placement preferences",
      operationId: "putPreferences",
      security: signedIn,
      requestBody: body({
        type: "object",
        additionalProperties: false,
        properties: { shareResults: { type: "boolean" }, placementPref: ref("PlacementPref") },
      }),
      responses: {
        "200": json({ type: "object", properties: { shareResults: { type: "boolean" }, placementPref: ref("PlacementPref") } }),
        "400": error("BAD_REQUEST: unknown field or value."),
        "401": signInRequired,
      },
    },
  },
  "/my-jobs": {
    get: {
      tags: ["Jobs"],
      summary: "Your jobs: submitted or joined, newest first (up to 50)",
      operationId: "listMyJobs",
      security: signedIn,
      responses: {
        "200": json({ type: "object", properties: { jobs: { type: "array", items: ref("JobSummary") } } }),
        "401": signInRequired,
      },
    },
  },
  "/jobs/{jobId}/cancel": {
    post: {
      tags: ["Jobs"],
      summary: "Cancel a job, or withdraw your interest in a shared one",
      description:
        "The owner or anyone who joined a job withdraws their own interest; the job stops only when nobody else is still waiting for it. " +
        "An admin's cancel always stops it. In `legacy` mode a caller without an account may cancel jobs that have no owner. " +
        "A cancelled job then reads as `failed` with the error `Cancelled.`.",
      operationId: "cancelJob",
      parameters: [jobIdParam],
      responses: {
        "200": json({
          type: "object",
          properties: {
            cancelled: { type: "boolean", description: "True when the job was stopped." },
            stillRunningForOthers: { type: "boolean", description: "True when it keeps running because someone else is waiting for it." },
            remainingWatchers: { type: "integer" },
          },
        }),
        "400": error("BAD_REQUEST: malformed job id."),
        "403": error("FORBIDDEN: the job belongs to someone else."),
        "404": error("NOT_FOUND."),
        "409": error("JOB_FINISHED: it already completed or failed."),
      },
    },
  },
  "/jobs/events": {
    get: {
      tags: ["Jobs"],
      summary: "Server-sent events for the listed jobs",
      operationId: "jobEvents",
      parameters: [{ name: "jobs", in: "query", required: true, description: "Comma-separated job ids.", schema: { type: "string" } }],
      responses: {
        "200": {
          description: "`text/event-stream`: a `connected` event, then `job_update` events `{jobId, tool, status, prediction?, result?, error?}`; a comment ping every 15 s.",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
        "400": error("BAD_REQUEST: `jobs` is missing."),
      },
    },
  },
  "/admin/invites": {
    post: {
      tags: ["Admin"],
      summary: "Create an invite link to hand to a colleague (valid 72 h, single use)",
      operationId: "createInvite",
      security: signedIn,
      requestBody: body({
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email" }, role: { type: "string", enum: ["admin", "member"], default: "member" } },
      }),
      responses: {
        "201": json({ type: "object", properties: { inviteUrl: { type: "string", description: "`PUBLIC_BASE_URL/#invite=<token>`." }, expiresAt: { type: "integer" } } }),
        "400": error("BAD_REQUEST."),
        "401": signInRequired,
        "403": adminOnly,
        "409": error("ACCOUNT_EXISTS: use a reset link instead."),
      },
    },
    get: {
      tags: ["Admin"],
      summary: "Unused, unexpired invites",
      operationId: "listInvites",
      security: signedIn,
      responses: {
        "200": json({
          type: "object",
          properties: {
            invites: {
              type: "array",
              items: { type: "object", properties: { id: { type: "string" }, email: { type: "string" }, role: { type: "string" }, expiresAt: { type: "integer" } } },
            },
          },
        }),
        "401": signInRequired,
        "403": adminOnly,
      },
    },
  },
  "/admin/invites/{id}": {
    delete: {
      tags: ["Admin"],
      summary: "Withdraw an unused invite",
      operationId: "withdrawInvite",
      security: signedIn,
      parameters: [{ ...userIdParam, description: "The invite id from `GET /admin/invites`." }],
      responses: { "204": { description: "Withdrawn." }, "401": signInRequired, "403": adminOnly, "404": error("Already used, withdrawn or expired.") },
    },
  },
  "/admin/users": {
    get: {
      tags: ["Admin"],
      summary: "Every account, with its quota override",
      operationId: "listUsers",
      security: signedIn,
      responses: {
        "200": json({ type: "object", properties: { users: { type: "array", items: { allOf: [ref("User"), { type: "object", properties: { quota: ref("Quota") } }] } } } }),
        "401": signInRequired,
        "403": adminOnly,
      },
    },
  },
  "/admin/users/{id}": {
    patch: {
      tags: ["Admin"],
      summary: "Disable or enable an account, change its role or its limits",
      description: "Disabling signs the person out everywhere and cancels their queued and running jobs. No change may leave the workspace without an active admin.",
      operationId: "updateUser",
      security: signedIn,
      parameters: [userIdParam],
      requestBody: body({
        type: "object",
        additionalProperties: false,
        properties: { status: { type: "string", enum: ["active", "disabled"] }, role: { type: "string", enum: ["admin", "member"] }, quota: ref("Quota") },
      }),
      responses: {
        "200": json({ type: "object", properties: { user: ref("User"), jobsCancelled: { type: "integer" } } }),
        "400": error("BAD_REQUEST."),
        "401": signInRequired,
        "403": adminOnly,
        "404": error("NOT_FOUND."),
        "409": error("LAST_ADMIN: make someone else an admin first."),
      },
    },
  },
  "/admin/users/{id}/reset-link": {
    post: {
      tags: ["Admin"],
      summary: "Create a password-reset link to hand over (valid 24 h, single use)",
      operationId: "createResetLink",
      security: signedIn,
      parameters: [userIdParam],
      responses: {
        "201": json({ type: "object", properties: { resetUrl: { type: "string", description: "`PUBLIC_BASE_URL/#reset=<token>`." }, expiresAt: { type: "integer" } } }),
        "401": signInRequired,
        "403": adminOnly,
        "404": error("NOT_FOUND."),
        "409": error("USER_DISABLED: enable the account first."),
      },
    },
  },
  "/admin/users/{id}/sign-out": {
    post: {
      tags: ["Admin"],
      summary: "Sign a person out of every browser",
      operationId: "signOutUser",
      security: signedIn,
      parameters: [userIdParam],
      responses: { "204": { description: "Signed out." }, "401": signInRequired, "403": adminOnly, "404": error("NOT_FOUND.") },
    },
  },
  "/admin/compute/ceilings": {
    delete: {
      tags: ["Admin"],
      summary: "Forget the out-of-memory size limits the server has learned",
      description: "For a wrong limit (a misclassified failure, or the host got more memory). Only enforced when `COMPUTE_ROUTING=on`; a limit is relearned after two new out-of-memory failures.",
      operationId: "forgetComputeCeilings",
      security: signedIn,
      responses: { "200": json({ type: "object", properties: { removed: { type: "integer" } } }), "401": signInRequired, "403": adminOnly },
    },
  },
};
