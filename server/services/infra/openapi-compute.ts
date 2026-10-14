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
const agentToken = [{ AgentToken: [] }];
const jobIdParam = { name: "jobId", in: "path", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_\\-]{1,100}$" } };
const userIdParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

const signInRequired = error("SIGN_IN_REQUIRED: no signed-in session.");
const adminOnly = error("ADMIN_ONLY: the signed-in person is not a workspace admin.");
const tooManyAttempts = error("TOO_MANY_ATTEMPTS: throttled; `Retry-After` gives the seconds to wait.");
const agentOnly = error("AGENT_TOKEN_REQUIRED: only a paired computer's token opens this route.");
const standby = error("STANDBY (a paused standby during a handover), QUEUE_UNAVAILABLE or AGENTS_UNSUPPORTED (Redis queue). Retry later.");
const weakPassword = error("BAD_REQUEST or WEAK_PASSWORD, with a reader-facing message.");

export const COMPUTE_SCHEMAS = {
  AgentHostReport: {
    type: "object",
    description: "What a paired computer reports about itself (src/shared/agentProtocol.ts).",
    properties: {
      agentVersion: { type: "string" },
      protocol: { type: "integer" },
      os: { type: "string", enum: ["win32", "linux", "darwin"] },
      arch: { type: "string", enum: ["x64", "arm64"] },
      cores: { type: "integer" },
      totalRamBytes: { type: "number" },
      freeRamBytes: { type: "number", description: "Already limited by the owner's AGENT_MAX_RAM_GB." },
      paused: { type: "boolean" },
      tools: { type: "object", properties: { foldx: ref("AgentToolReport"), p2rank: ref("AgentToolReport") } },
      foldxSource: { type: "string", enum: ["team", "guided", "none"] },
      foldxBundleVersion: { type: ["string", "null"] },
    },
  },
  AgentToolReport: {
    type: "object",
    properties: {
      state: { type: "string", enum: ["ready", "installing", "missing", "failed"] },
      version: { type: ["string", "null"] },
      detail: { type: ["string", "null"], description: "Reader-facing, when not ready." },
    },
  },
  AgentView: {
    type: "object",
    description: "One of the signed-in person's computers.",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      createdAt: { type: "integer" },
      lastSeenAt: { type: ["integer", "null"] },
      online: { type: "boolean" },
      paused: { type: "boolean" },
      runningJobs: { type: "integer" },
      os: { type: ["string", "null"] },
      totalRamBytes: { type: ["number", "null"] },
      tools: { type: ["object", "null"], properties: { foldx: ref("AgentToolReport"), p2rank: ref("AgentToolReport") } },
      foldxSource: { type: ["string", "null"] },
      recent: {
        type: ["object", "null"],
        description: "What it did in the last `days` days, measured on it: jobs finished, jobs it gave back to the server, and the median run per tool. Null before its first job.",
        properties: {
          days: { type: "integer" },
          completed: { type: "integer" },
          handedBack: { type: "integer" },
          foldx: ref("AgentToolSpeed"),
          p2rank: ref("AgentToolSpeed"),
        },
      },
    },
  },
  AgentToolSpeed: {
    type: ["object", "null"],
    properties: {
      jobs: { type: "integer" },
      medianMs: { type: "integer" },
      medianResidues: { type: ["integer", "null"] },
    },
  },
  JobRunsOn: {
    type: ["object", "null"],
    description:
      "Where the job runs (or ran) and why, for the caller (live routing, `src/shared/jobPlacement.ts`). Null when it is simply the shared server's, which is always the case unless `COMPUTE_ROUTING=on` and the owner has a connected computer, or a computer took the job from the owner's backlog. A computer's name, the reasons and the prediction are given to its owner only; anyone else holding the job id reads `teammate_computer` and only `where`/`started`.",
    properties: {
      where: { type: "string", enum: ["server", "your_computer", "teammate_computer"] },
      computerName: { type: ["string", "null"] },
      started: { type: "boolean" },
      expectedMs: { type: ["object", "null"], properties: { p50: { type: "number" }, p90: { type: "number" } }, description: "The placement engine's run-time prediction for this host." },
      basis: { type: ["string", "null"], enum: ["measured", "prior", null], description: "`measured`: fitted from completed jobs on this kind of computer; `prior`: from earlier benchmarks." },
      samples: { type: ["integer", "null"] },
      reasons: { type: "array", items: { type: "string" }, description: "Plain sentences: why it runs there, and what changed since (for example, the computer went offline and the server took it)." },
    },
  },
  FoldxBundle: {
    type: "object",
    properties: {
      platform: { type: "string", enum: ["win32", "linux", "darwin"] },
      version: { type: "string" },
      sha256: { type: "string" },
      sizeBytes: { type: "integer" },
      binaryName: { type: "string" },
      expiry: { type: ["string", "null"], description: "The build's last working day, from its file name." },
      uploadedBy: { type: "string" },
      uploadedByName: { type: ["string", "null"] },
      uploadedAt: { type: "integer" },
      licenceConfirmedAt: { type: "integer" },
    },
  },

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
  SavedSecret: {
    type: "object",
    description: "A provider token saved to an account (WP-I4b). The token itself is never returned.",
    properties: {
      kind: { type: "string", enum: ["biohub", "huggingface", "tamarind"] },
      hint: { type: "string", description: "The token's last four characters." },
      updatedAt: { type: "integer", description: "Epoch ms." },
      readable: { type: "boolean", description: "False when the server can no longer decrypt it: save it again." },
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
      elapsedMs: { type: ["integer", "null"], description: "How long it has been running, measured on the server that started it; null when not running." },
      label: { type: ["string", "null"], description: "Short human label from the job's input (mutation or protein)." },
      watchers: { type: "integer", description: "How many people are waiting on it, the caller included. More than 1 means somebody else asked for the same result, so cancelling only withdraws the caller's interest." },
      runsOn: ref("JobRunsOn"),
    },
  },
} as const;

export const COMPUTE_TAGS = [
  { name: "Accounts", description: "Invite-only sign-in, first-admin setup, password reset and personal preferences. See doc/ACCOUNTS.md." },
  { name: "Jobs", description: "The signed-in person's queued FoldX and pocket jobs: list, cancel, live updates." },
  { name: "Admin", description: "Workspace admin tools: invites, accounts, reset links, learned compute limits and the team FoldX bundle." },
  { name: "Agents", description: "A person's own computer lending itself to their own jobs (WP-F): pairing, the claim/lease protocol, the team FoldX bundle. See doc/AGENT.md." },
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
      security: signedIn,
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
              runsOn: ref("JobRunsOn"),
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
            queuedEtaMs: { type: ["integer", "null"], description: "The estimate of the wait before it starts (on the computer it is placed on, when it is); null when unknown or already running." },
            runsOn: ref("JobRunsOn"),
            result: {
              type: "object",
              description: "On `completed`, the energetics result (FoldX ddG, the other engines and `computeProvenance`). Absent while queued or running, and absent on `failed`, where `error` explains why.",
            },
            error: { type: "string", description: "Set on `failed`; exactly `Cancelled.` when the person cancelled the run rather than the engine failing." },
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
      description:
        "Always answers with a queued envelope or a cached job; the result itself comes from `GET /pocket-job/{jobId}`, " +
        "including when the answer was already cached. A `structureRef` from an earlier call that has expired is refused " +
        "with `409 STALE_STRUCTURE_REF`; resubmit the structure to get a fresh reference.",
      operationId: "findPocket",
      security: signedIn,
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
            description: "The queued envelope `{status: \"queued\", pocketJobId, structureResolution}`; poll `/pocket-job/{jobId}` for the answer. A cached find is reported the same way.",
            properties: { status: { type: "string" }, pocketJobId: { type: "string" }, runsOn: ref("JobRunsOn"), structureResolution: { type: "object" } },
          },
          "Queued pocket job",
        ),
        "400": error("BAD_REQUEST."),
        "409": error("STALE_STRUCTURE_REF: the `structureRef` has expired; submit the structure again."),
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
            runsOn: ref("JobRunsOn"),
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
                queuedPerUserExplicit: { type: "boolean", description: "True when an admin set `queuedPerUser` for this person, in which case it applies even while nobody else is waiting." },
              },
            },
            usage: {
              type: ["object", "null"],
              description: "Server seconds used today (UTC) and over the last 7 days; null when the queue is not running.",
              properties: { todaySeconds: { type: "integer" }, weekSeconds: { type: "integer" } },
            },
            liveRouting: { type: "boolean", description: "True with `COMPUTE_ROUTING=on`: each job goes where it should finish first (the person's connected computer or the shared server)." },
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
  "/me/secrets": {
    get: {
      tags: ["Accounts"],
      summary: "Provider tokens saved to your account (WP-I4b)",
      description:
        "Biohub, Hugging Face and Tamarind tokens saved encrypted (AES-256-GCM) so they follow you to other browsers. " +
        "Never returns a token: only its kind, last four characters and when it was saved. `available` is false when the " +
        "server cannot encrypt (no APP_SESSION_SECRET); `readable` is false for a row it can no longer decrypt.",
      operationId: "listSavedSecrets",
      security: signedIn,
      responses: {
        "200": json({
          type: "object",
          properties: {
            available: { type: "boolean" },
            secrets: { type: "array", items: ref("SavedSecret") },
          },
        }),
        "401": signInRequired,
      },
    },
  },
  "/me/secrets/{kind}": {
    put: {
      tags: ["Accounts"],
      summary: "Save one of your provider tokens to your account",
      description: "A token sent with a request is used before a saved one; a saved one before the team's.",
      operationId: "saveSecret",
      security: signedIn,
      parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["biohub", "huggingface", "tamarind"] } }],
      requestBody: body({ type: "object", required: ["token"], properties: { token: { type: "string", minLength: 8, maxLength: 512 } } }),
      responses: {
        "200": json(ref("SavedSecret")),
        "400": error("BAD_REQUEST: unknown kind, or not a usable token."),
        "401": signInRequired,
        "503": error("SECRETS_UNAVAILABLE: the server has no APP_SESSION_SECRET to encrypt with."),
      },
    },
    delete: {
      tags: ["Accounts"],
      summary: "Remove a saved provider token",
      operationId: "removeSecret",
      security: signedIn,
      parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["biohub", "huggingface", "tamarind"] } }],
      responses: { "204": { description: "Removed." }, "400": error("BAD_REQUEST: unknown kind."), "401": signInRequired, "404": error("NOT_FOUND: none saved.") },
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
      security: signedIn,
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
    get: {
      tags: ["Admin"],
      summary: "List the out-of-memory size limits the server has learned",
      description: "Per job type and kind of computer (host class), the smallest structure size that ran out of memory there. `enforced` is true only with `COMPUTE_ROUTING=on`, when a submission that only such a host could take is refused with `422 CANNOT_RUN_HERE`; otherwise the limits are recorded but not applied.",
      operationId: "listComputeCeilings",
      security: signedIn,
      responses: {
        "200": json({
          type: "object",
          properties: {
            enforced: { type: "boolean" },
            ceilings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["foldx", "p2rank"] },
                  hostClass: { type: "string", description: "e.g. `arm64-emulated-2c-12g`; a member's computer is `agent/<class>`." },
                  residues: { type: "integer" },
                  onServer: { type: "boolean" },
                },
              },
            },
          },
        }),
        "401": signInRequired,
        "403": adminOnly,
      },
    },
    delete: {
      tags: ["Admin"],
      summary: "Forget the out-of-memory size limits the server has learned",
      description: "For a wrong limit (a misclassified failure, or the host got more memory). Only enforced when `COMPUTE_ROUTING=on`; a limit is relearned after two new out-of-memory failures.",
      operationId: "forgetComputeCeilings",
      security: signedIn,
      responses: { "200": json({ type: "object", properties: { removed: { type: "integer" } } }), "401": signInRequired, "403": adminOnly },
    },
  },
  // ── Paired computers (WP-F) ─────────────────────────────────────────────────────────────────────
  "/agent/pair": {
    post: {
      tags: ["Agents"],
      summary: "Get a one-time code to connect a computer",
      description: "Six characters, valid once for 10 minutes. A new code replaces the person's unused one. The person types it into the agent's setup page on their computer.",
      operationId: "createPairingCode",
      security: signedIn,
      responses: {
        "201": json({ type: "object", properties: { code: { type: "string", example: "K7M-Q2X" }, expiresAt: { type: "integer" } } }, "Created"),
        "401": signInRequired,
      },
    },
  },
  "/agent/pair/redeem": {
    post: {
      tags: ["Agents"],
      summary: "Trade a pairing code for this computer's token",
      description: "Called by the agent, not a browser. Public and throttled (20 wrong codes per address per 15 minutes). The token is shown once; only its hash is stored.",
      operationId: "redeemPairingCode",
      security: [],
      requestBody: body({ type: "object", required: ["code", "name"], properties: { code: { type: "string" }, name: { type: "string", maxLength: 60 } } }),
      responses: {
        "201": json({ type: "object", properties: { agentId: { type: "string" }, token: { type: "string" }, ownerName: { type: "string" } } }, "Created"),
        "401": error("PAIRING_CODE_INVALID: wrong, used or expired code."),
        "429": tooManyAttempts,
      },
    },
  },
  "/me/agents": {
    get: {
      tags: ["Agents"],
      summary: "My connected computers",
      operationId: "listMyAgents",
      security: signedIn,
      responses: { "200": json({ type: "object", properties: { agents: { type: "array", items: ref("AgentView") } } }), "401": signInRequired },
    },
  },
  "/me/agents/{id}": {
    delete: {
      tags: ["Agents"],
      summary: "Disconnect one of my computers",
      description: "Its token stops working on the next request; a job it was running goes back to the server when its lease runs out.",
      operationId: "revokeMyAgent",
      security: signedIn,
      parameters: [userIdParam],
      responses: { "204": { description: "Disconnected" }, "401": signInRequired, "404": error("No such computer.") },
    },
  },
  "/me/agent-downloads": {
    get: {
      tags: ["Agents"],
      summary: "Agent downloads available on this workspace",
      description: "One zip per platform, built by `npm run build:agent-bundle` and placed in AGENT_BUNDLE_DIR by the admin.",
      operationId: "listAgentDownloads",
      security: signedIn,
      responses: {
        "200": json({ type: "object", properties: { platforms: { type: "array", items: { type: "object", properties: { platform: { type: "string" }, label: { type: "string" }, sizeBytes: { type: "integer" }, url: { type: "string" } } } } } }),
        "401": signInRequired,
      },
    },
  },
  "/me/agent-download/{platform}": {
    get: {
      tags: ["Agents"],
      summary: "Download the agent for one kind of computer",
      operationId: "downloadAgent",
      security: signedIn,
      parameters: [{ name: "platform", in: "path", required: true, schema: { type: "string", enum: ["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] } }],
      responses: { "200": { description: "The zip", content: { "application/zip": { schema: { type: "string", format: "binary" } } } }, "401": signInRequired, "404": error("Not built for this platform yet.") },
    },
  },
  "/agent/register": {
    post: {
      tags: ["Agents"],
      summary: "A computer says what it is and what it can run",
      operationId: "registerAgent",
      security: agentToken,
      requestBody: body({ type: "object", required: ["report"], properties: { report: ref("AgentHostReport") } }),
      responses: {
        "200": json({
          type: "object",
          properties: {
            agentId: { type: "string" },
            name: { type: "string" },
            leaseSec: { type: "integer" },
            heartbeatSec: { type: "integer" },
            claimWaitMaxSec: { type: "integer" },
            foldxBundleVersion: { type: ["string", "null"], description: "The team FoldX bundle for this computer's platform; null = none (erase any team copy)." },
          },
        }),
        "401": agentOnly,
        "426": error("AGENT_OUTDATED: protocol version mismatch."),
        "503": standby,
      },
    },
  },
  "/agent/claim": {
    post: {
      tags: ["Agents"],
      summary: "Long-poll (up to 25 s) for one of the owner's queued jobs",
      description:
        "Only the owner's own queued jobs that are not placed elsewhere, that this computer has a self-tested tool for, and that pass the placement engine's hard filters for this computer. The job is leased: renew it by heartbeat. The payload never contains a server path.",
      operationId: "claimAgentJob",
      security: agentToken,
      requestBody: body({ type: "object", required: ["report"], properties: { report: ref("AgentHostReport"), waitSec: { type: "integer", minimum: 0, maximum: 25 } } }),
      responses: {
        "200": json({
          type: "object",
          properties: {
            job: {
              type: ["object", "null"],
              properties: {
                id: { type: "string" },
                type: { type: "string", enum: ["foldx", "p2rank"] },
                payload: { type: "object", description: "FoldX: {wtPdb, mutation, uniprotId, options}. P2Rank: {pdbText, mutIndex, targetChain}." },
                leaseExpiresAt: { type: "integer" },
                deadlineMs: { type: "integer", description: "The job cap; stop and report `timeout` after it." },
              },
            },
            foldxBundleVersion: { type: ["string", "null"] },
          },
        }),
        "401": agentOnly,
        "503": standby,
      },
    },
  },
  "/agent/jobs/{jobId}/heartbeat": {
    post: {
      tags: ["Agents"],
      summary: "Renew the lease and report the FoldX phase",
      operationId: "agentHeartbeat",
      security: agentToken,
      parameters: [jobIdParam],
      requestBody: body({ type: "object", properties: { phase: { type: "string", enum: ["queued", "repairing", "modelling", "finalizing"] }, rssBytes: { type: "number" } } }),
      responses: {
        "200": json({ type: "object", properties: { leaseExpiresAt: { type: "integer" }, foldxBundleVersion: { type: ["string", "null"] } } }),
        "401": agentOnly,
        "410": error("LEASE_LOST: cancelled, finished or handed to the server. Stop the tool."),
        "503": standby,
      },
    },
  },
  "/agent/jobs/{jobId}/result": {
    post: {
      tags: ["Agents"],
      summary: "Deliver a result (validated before it completes the job)",
      description:
        "Schema, sanity and identity checks (the mutant structure carries the requested substitution at the requested residue). An invalid result is not an error: `accepted: false` with the reasons, and the job goes to the server once. A valid one is stamped `computedOn: agent`, cached, and shared with colleagues only if the owner shares results.",
      operationId: "agentResult",
      security: agentToken,
      parameters: [jobIdParam],
      requestBody: body({
        type: "object",
        required: ["result", "toolVersion"],
        properties: { result: { type: "object" }, wallMs: { type: "number" }, peakRssBytes: { type: "number" }, toolVersion: { type: "string" } },
      }),
      responses: {
        "200": json({ type: "object", properties: { accepted: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } } } }),
        "401": agentOnly,
        "404": error("No such job."),
        "409": error("LEASE_LOST: the job is no longer this computer's; the result was discarded."),
        "503": standby,
      },
    },
  },
  "/agent/jobs/{jobId}/fail": {
    post: {
      tags: ["Agents"],
      summary: "Give a job back; the server runs it",
      description: "Whatever the reason, the job goes to the server once: a computer never fails a job for everyone (someone else may have joined it).",
      operationId: "agentFail",
      security: agentToken,
      parameters: [jobIdParam],
      requestBody: body({
        type: "object",
        required: ["errorClass"],
        properties: {
          errorClass: { type: "string", enum: ["tool_missing", "tool_failed", "oom", "timeout", "aborted", "input", "other"] },
          message: { type: "string" },
          wallMs: { type: "number" },
          peakRssBytes: { type: "number" },
          toolVersion: { type: ["string", "null"] },
        },
      }),
      responses: { "200": json({ type: "object", properties: { handedToServer: { type: "boolean" } } }), "401": agentOnly, "409": error("LEASE_LOST."), "503": standby },
    },
  },
  "/agent/self": {
    delete: {
      tags: ["Agents"],
      summary: "The computer disconnects itself",
      description: "Its token is revoked and anything it was running goes back to the server at once.",
      operationId: "agentDisconnect",
      security: agentToken,
      responses: { "204": { description: "Disconnected" }, "401": agentOnly },
    },
  },
  "/agent/tools/foldx": {
    get: {
      tags: ["Agents"],
      summary: "Download the team FoldX bundle for one platform",
      description: "Agent token only, rate limited (12 per hour per computer). Verify the bytes against `X-Bundle-Sha256` before installing. `If-None-Match` with the ETag answers 304.",
      operationId: "downloadFoldxBundle",
      security: agentToken,
      parameters: [{ name: "platform", in: "query", required: true, schema: { type: "string", enum: ["win32", "linux", "darwin"] } }],
      responses: {
        "200": { description: "The zip", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
        "304": { description: "Unchanged" },
        "400": error("Unknown platform."),
        "401": agentOnly,
        "404": error("NO_BUNDLE: none uploaded for this platform, or revoked."),
      },
    },
  },
  "/admin/tools/foldx": {
    get: {
      tags: ["Admin"],
      summary: "The team FoldX bundles",
      operationId: "listFoldxBundles",
      security: signedIn,
      responses: { "200": json({ type: "object", properties: { platforms: { type: "array", items: ref("FoldxBundle") } } }), "401": signInRequired, "403": adminOnly },
    },
    delete: {
      tags: ["Admin"],
      summary: "Remove FoldX from the team",
      description: "Deletes every stored bundle; each computer erases its team copy at its next contact, and FoldX jobs run on the server.",
      operationId: "revokeFoldxBundles",
      security: signedIn,
      responses: { "204": { description: "Removed" }, "401": signInRequired, "403": adminOnly },
    },
  },
  "/admin/tools/foldx/{platform}": {
    put: {
      tags: ["Admin"],
      summary: "Upload the licensed FoldX zip for one platform",
      description:
        "Raw zip body (`application/zip`) and the header `X-Foldx-Licence-Confirmed: yes`: the admin confirms the licence permits sharing it with the team for research use; who and when go to the audit log. The zip is checked (the program for this platform, recognised by its executable header; the molecules folder; rotabase.txt; the build date) before it is stored.",
      operationId: "uploadFoldxBundle",
      security: signedIn,
      parameters: [{ name: "platform", in: "path", required: true, schema: { type: "string", enum: ["win32", "linux", "darwin"] } }],
      requestBody: { required: true, content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
      responses: {
        "201": json({ type: "object", properties: { bundle: ref("FoldxBundle") } }, "Created"),
        "400": error("LICENCE_NOT_CONFIRMED or a bad platform."),
        "401": signInRequired,
        "403": adminOnly,
        "413": error("TOO_LARGE."),
        "422": error("NOT_FOLDX: the zip is not a usable FoldX for this platform; the message says why."),
      },
    },
  },
};
