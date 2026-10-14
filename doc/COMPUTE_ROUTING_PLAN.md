# Compute routing: accounts, queue-aware scheduling, and the submitter's own machine

Status: **decisions resolved; implementation under way on branch `feat/compute-routing`.** See 0.3 for
what is done and how the shipped contract differs from the sketches below.
Facts were read from the code on branch `chore/residue-shifts-inspector-polish`. Anything not read
from code is marked **[estimate]**, **[unmeasured]** or **[proposed]**.

Read this whole file before starting a work package. Each package in section 7 is written so that
one agent can take it without the others.

---

## 0. Decisions (final)

| # | Question | Decision |
|---|---|---|
| 1 | Identity | **Real user accounts**, to protect compute. **Production is served by Caddy at `https://missense-resolve.duckdns.org` with no Cloudflare Access in front** (confirmed by the owner), so **the app's own invite-only login is the primary sign-in**. Cloudflare Access sign-in is an optional provider for a future setup (section 4). |
| 2 | Agent packaging | **The repo in worker mode, as one bundled Node file (`npm run agent`).** No Docker. Reasoning in 0.1. |
| 3 | Local ESMFold on user GPUs | **Out of scope.** Team machines do not have suitable GPUs. ESMFold stays remote. |
| 4 | PDB text may go to a user's agent | **Yes**, for that user's own jobs. |
| 5 | Agent results enter the shared cache | **Yes by default**, after validation; a per-user opt-out exists. |
| 6 | FoldX licence and distribution | **Research use only, non-commercial, within the small team** (the owner's statement; the licence text was not reviewed here). **Team distribution is the default:** the admin uploads the licensed FoldX bundle once and every agent receives it automatically. The owner accepts responsibility for the licence position and can **revoke at any time** (admin button): the bundle is deleted from the server and agents erase their copies at next check-in. Per-user manual setup stays only as the fallback. |
| 7 | Users are not technical | **No terminal, no file hunting, no FoldX download for them.** The agent ships as a double-click bundle with a guided local setup page; with team distribution the user does nothing about FoldX. Section 7, WP-F2. |
| 8 | Limits on a small research team | **No daily compute cap by default.** Fairness is work-conserving: a user may use every free slot when nobody else is waiting. Only safety limits remain (section 4.4). |

### 0.1 Why a bundled worker instead of Docker for the agent

- The speed win comes from **native x64 FoldX** (about 60x faster than the Box64 emulation on the
  Oracle host, section 2.3). On Windows that means running `foldx.exe` directly. Docker Desktop on
  Windows would run the Linux binary inside a VM, adding overhead and an installer to maintain.
- Team members are **not developers and do not have the repo**. The agent therefore ships as a
  double-click zip with its own portable Node runtime and a guided setup page (WP-F2). It is still built from
  this repo in worker mode: it reuses `generateMutantPdb` and `findBindingPocket` unchanged, so an agent runs
  exactly the code the server runs. There is no second implementation to keep in sync.
- The repo already bundles with esbuild (`build:server`, `build:workers`). Adding `build:agent` is
  the same pattern; `build:agent-bundle` then zips it with the portable runtime.
- A container image can be added later for Linux hosts. It is not needed now.

### 0.2 Corrections to earlier advice

- **The Oracle allowance is 2 OCPU and 12 GB, not 4 OCPU and 24 GB.** `doc/DEPLOYMENT_OCI.md` records
  that Oracle halved it in June 2026, and the app container already takes up to 10 GB
  (`deploy/docker-compose.oci.yml`). **A second free Oracle VM is not realistic.** The scaling path
  is the users' own machines, which is what this plan builds.
- The queue starts with `BIOPHYSICAL_CONCURRENCY` default **4** (`config.ts`). The `2` in the
  constructor is only a default parameter that `server.ts` overrides.

### 0.3 Implementation status (update this table when a package lands)

| Package | State | Where |
|---|---|---|
| WP-C engine and cost models | **done** (25 engine + 7 cost-model tests) | `src/shared/computeRouting.ts`, `server/services/infra/cost-models.ts` |
| WP-I2 cache audit (read-only part) | **done** | `doc/EGRESS_AUDIT.md` |
| WP-A accounts, **server side** | **done** (33 integration tests) | `server/auth/*`, `server/routes/{auth,admin}.ts`, `scripts/user-admin.ts` |
| WP-A accounts, client | **done** (16 component tests; walked end to end in a browser) | `src/context/AccountContext.tsx`, `src/components/account/*`, Settings → Account / Team |
| WP-B queue ownership, fair claim, limits, cancel, my-jobs, usage | **done** (17 queue + 7 HTTP + 4 estimate tests); no client screen yet (that is WP-G) | `server/services/infra/biophysical-queue.ts`, `queue-owners.ts`, `server/routes/biophysics/polling.ts` |
| WP-0 core: telemetry table + recording, server host probe | **done** (in the queue; 1 integration test) | `server/services/infra/{compute-telemetry,host-probe,failure-class}.ts` |
| WP-0 remainder: memory sampler, tool self-tests and versions, `compute:benchmark` | **done** (#110; follow-ups in #111) (7 sampler + 13 probe + 1 telemetry + 3 report tests; benchmark run on the development machine) | `server/services/infra/{process-sampler,job-meter}.ts`, `scripts/compute-benchmark.ts`, `doc/COMPUTE_BENCHMARK.md` |
| WP-D admission and out-of-memory handling | **done**, ships in `shadow` (9 tests) | `server/services/infra/admission.ts`, `foldx/failure.ts` |
| WP-E shared cache and de-duplication | **done** (8 + 3 route tests); the agent half (validation) waits for WP-F | `src/shared/computeProvenance.ts`, `foldx-job-registry.ts` (`JobRegistry`), `routes/biophysics/pocket.ts` |
| WP-G1 jobs panel, cancelled state, wait estimate, usage | **done** (7 copy + 4 panel + 1 usage tests; walked in a browser) | `src/components/jobs/JobsMenu.tsx`, `src/shared/jobsCopy.ts`, Settings → Account → Compute |
| WP-F agents: pairing, claim/lease protocol, result validation, team FoldX bundle, the agent runtime and its double-click bundle, "Your computers" and "FoldX for the team" screens | **done** (#118) (12 protocol + 9 agent + 11 validator + 4 copy tests; a real end-to-end run on Windows of both tools, see WP-F) | `server/routes/agent.ts`, `server/services/infra/agent-*.ts`, `foldx-archive.ts`, `tool-bundles.ts`, `server/agent/*`, `src/shared/agentProtocol.ts`, `doc/AGENT.md` |
| WP-I1 fair-share egress governor: per-provider turns between people (`system` last), published rates only (Ensembl, NCBI) with sources, AIMD and learned rates, deadline-aware waits, `governedFetch` for the 41 raw remote `fetch` sites, a ratchet test, request and job attribution, governor health on `/capabilities` | **done** (#128), under the same `EGRESS_GOVERNOR` (15 governor + 1 ratchet + 23 review-fix + 2 `/capabilities` route tests; Review 4 below) | `server/services/infra/egress-governor.ts`, `egress-context.ts`, `http-client.ts` (`governedFetch`), `egress-ratchet.test.ts`, `auth/egress-owner.ts`, `biophysical-queue.ts`, `routes/capabilities.ts` |
| WP-I3 team-wide 429 pause: per-host pause for everyone, typed `PROVIDER_RATE_LIMITED`, 429 out of the breaker, DynaMut2/DDMut polls keep listening, provider health on `/capabilities` | **done** (#127), ships `EGRESS_GOVERNOR=off`; production runs `shadow` since 2026-10-13 (14 pause + 3 copy + 1 route tests) | `server/services/infra/provider-pause.ts`, `http-client.ts`, `src/shared/providerLimits.ts`, `stability/dynamut.ts`, `routes/biophysics/polling.ts`, `routes/capabilities.ts` |
| WP-I2 shared cache fixes: stale on rate limit (expired rows kept 30 days, `X-MSE-Stale`, the client's notice), nothing built from stale data cached, negative caching only for a definitive not-found, no credential in Gemini keys, one upstream call for concurrent SpliceAI / JapanFold / DynaMut2 / DDMut requests, prewarm as `system` and skipping cached runs | **done** on `feat/wp-i2-cache`, under the same `EGRESS_GOVERNOR` (28 stale + 20 hygiene + 2 client notice + 2 fetchWithAuth + 1 stream-frame + 2 prewarm tests, plus gate tests in the landscape, structure-resolver, Genos, core-singleflight, analysis-route and governor suites; Review 5 below) | `server/services/infra/{cache-registry,cache-scope,stale-response,shared-flight}.ts`, `analysis-db-core.ts`, `prewarm-manager.ts`, `src/hooks/useStaleDataNotice.ts`, `doc/EGRESS_AUDIT.md` section 8 |
| WP-I4 per-user credentials: own-token buckets in the governor, `SHARED_TOKEN_FALLBACK` (`limited` by default, an hourly team-token share per signed-in person), "your token" / "the team token" after each remote result (`X-MSE-Credentials`), no token in any key; WP-I4b tokens saved encrypted to the account | **done** on `feat/wp-i4-credentials` (16 credential + 6 HTTP + 3 ESM-2 + 2 Tamarind + 5 client-notice + 1 stream-frame + 6 Settings tests) | `server/services/infra/credentials.ts`, `credential-response.ts`, `egress-governor.ts` (own-token buckets), `server/auth/user-secrets.ts`, `routes/auth.ts` (`/me/secrets`), `src/shared/credentials.ts`, `TokenOwnership.tsx` |
| WP-G2 live routing: placement on the owner's computers, `runsOn` (where, why, prediction) on every job surface, fallback to the server, each computer's own speed, learned memory limits on the admin page | **done** on `feat/wp-g2-routing` (17 live-routing + 11 copy + 1 jobs-panel + 3 Energetics + 4 screen tests); placement is live only with `COMPUTE_ROUTING=on` | `admission.ts` (`placementOf`), `biophysical-queue.ts` (`routing` column, `agentLoad`, `releasePlacementsOf`), `routes/agent.ts` (`ownerAgentHosts`, `releaseStrandedPlacements`), `src/shared/jobPlacement.ts`, `ComputeLimits.tsx` |
| everything else | not started | |

**Where WP-A's server side differs from section 4** (the code is the source of truth):
- **The gate is "every write", not a list of heavy routes.** `PUBLIC_ENDPOINTS` already lists nearly every
  compute route, so the shared token protects almost none of them today, and a hand-kept heavy list would
  drift. In `hybrid` every POST/PUT/PATCH/DELETE needs a user or the legacy token; in `accounts` it needs a
  user. Reads are unchanged. Only the sign-in writes are exempt (`SIGN_IN_WRITES` in `server/auth/middleware.ts`).
  **Client consequence:** in `accounts` mode the SPA must sign in before its first write (including
  `POST /session/keys`).
- `/auth`, `/setup`, `/me`, `/admin` are listed in `PUBLIC_ENDPOINTS` as prefixes so their own guards answer
  (`requireUser`, `requireAdmin`); otherwise a signed-out visitor got "invalid API token".
- Extra endpoints: `POST /auth/invite-info {token}` (the accept page shows the invited email),
  `POST /admin/users/:id/reset-link`, `POST /admin/users/:id/sign-out`. Invite and reset links carry the token
  in the URL **fragment** (`/#invite=…`, `/#reset=…`), which never reaches a server or proxy log.
- Reset links have their own table, `password_resets` (single use, 24 h, a new link replaces an unused one).
- Throttle: 5 failures per email (and for the setup secret), **20 per address**, because a lab shares one NAT
  address. A success clears only the account's counter, never the address counter.
- The last active admin cannot be demoted or disabled (409 `LAST_ADMIN`).
- `npm run user:create|user:reset` runs the TypeScript source in development and the bundled
  `dist/user-admin.cjs` (built by `npm run build`) in the production image, which has neither `tsx` nor sources.
- `deploy/backup-sqlite.sh` now also backs up `accounts.sqlite`.
- Agent tokens: the `/agent/*` rule (agent token only; a cookie is neither required nor sufficient) is
  enforced centrally in `accountAccess`; pairing and the agent routes are WP-F.
- Disabling a user now cancels their queued and running jobs, and `/auth/me` reports usage (both WP-B).
- Added for the client: `GET /auth/session` (public, never 401: mode, user or null, `setupAvailable`,
  `accountsExist`), `GET /admin/invites` and `DELETE /admin/invites/:id`. A new invite for an address
  replaces its older unused one. Setup, invite acceptance and reset all record `last_login_at`.
- The password rule lives in `src/shared/accountPolicy.ts`, read by both the server check and the
  browser's live checklist.

**Where WP-B differs from section 7** (the code is the source of truth):
- The claim rule is `priority`, then fewest running jobs for the owner, then the owner **served least recently**,
  then the owner whose oldest queued job is oldest, then that owner's oldest job. The "served least recently"
  step is an addition: with the specified rule alone a single slot (concurrency 1) has no running job to
  compare and falls back to arrival order, so one person's 30 jobs would still block everyone.
- Queue position (`queuedAhead`) is computed by applying the same rule in memory (`queuedInStartOrder`) and a
  test consumes the real scheduler and compares. It assumes nothing finishes in between, which is the honest
  upper bound. `queuedEtaMs` is added to the FoldX submit and poll responses; it is `null` unless every job ahead
  has a cost estimate. FoldX jobs get one at submit time: the WP-C prior for the structure's residue count,
  repair rule and this host's emulation (`server/services/stability/foldx/estimate.ts`). P2Rank jobs have none
  yet, so a P2Rank job ahead makes the wait unknown. The P2Rank poll now returns `queuedAhead` as well.
- The submitter is the first row of `job_watchers`. A person who submits the same request as a running job
  joins it; joining a pre-warm job lifts it from `-10` to `0` so
  someone's wait is not behind other people's newer work.
- `POST /jobs/:id/cancel` (not under `/biophysics`; the existing job routes have no such prefix). Owner or
  watcher: withdraws their own interest, and the job stops only when nobody is left. Admin: stops it outright.
  Anyone else: 403. Without accounts, the shared token may cancel jobs that have no owner.
- `GET /my-jobs` needs an account. The `legacy` owner shares one rotation slot between all unowned work.
- Limits: `QUOTA_QUEUED_PER_USER` (25) counts **waiting** jobs only; `QUEUE_MAX_TOTAL` (50, was a constant)
  remains the host backstop. Running jobs are never counted against a person. **The queued limit is
  work-conserving, like the scheduler** (a deliberate change to 4.4's fixed 25): it is a per-person *share* that
  binds only while someone else (a person or unowned work; not pre-warm) is also waiting. Alone, a person may
  queue up to `QUEUE_MAX_TOTAL - 5`; the 5 are kept for a colleague who arrives. When someone does, nothing
  already queued is dropped: the heavy user simply cannot add more until back under 25, and the rotation starts
  the newcomer's work next. An admin's explicit per-person override (`quota_json.queuedPerUser`) is a
  restriction, not a share, and applies at all times. `QUOTA_SERVER_SECONDS_PER_DAY` (or the override) is enforced when set, per UTC day,
  counting failed and cancelled time too. A person's own limit answers **429** with their numbers
  (`QUEUED_PER_USER`, `DAILY_SERVER_TIME`); a full host stays 503.
- `/auth/me` `usage` is now `{ todaySeconds, weekSeconds }` (today = UTC day, week = last 7 days).
- Concurrency: the queue runs `BIOPHYSICAL_CONCURRENCY` jobs (default 4) and the FoldX semaphore is derived
  from it (`resolveFoldxConcurrency`: the explicit value when set, else `min(queue, cpus - 1)`), so FoldX can
  never be given more slots than the queue. A first version used one shared `min(4, cpus - 1)` for both; on the
  2-core server that is 1 and P2Rank (which does not take the FoldX semaphore) waited behind every FoldX run.
  Reverted the same day; `server/tests/concurrency-defaults.test.ts` pins it.
- Item 7's admission **by running cost** (rather than job count) is left to WP-D, which owns admission; WP-B
  only unified the two counts.
- The Redis backend ignores owners, priorities, watchers, `my-jobs` and cancel-by-person (documented, as planned).
- A stopped running job is marked `failed` with the error `Cancelled.`; the unwinding callback can no longer
  overwrite that (status-guarded writes).

**Where WP-0/WP-D differ from section 7** (the code is the source of truth):
- Telemetry is written by the **queue** when a job settles, not by a wrapper in `server.ts`: the queue is the one
  place that sees every ending (including timeouts it imposes and cancels). `job_telemetry` lives in the queue's
  database as planned. `residues` and `repaired` are stored on the job at submit, so the row is exact.
- `peak_rss_bytes` is null (no sampler yet), so memory never filters; the size rules do. Cost models are refitted
  every 10 rows and **immediately after an OOM**, so a ceiling stops the very next larger job.
- `COMPUTE_ROUTING` defaults to `shadow` (and to `off` under `NODE_ENV=test`). In `shadow` each submit logs one
  `[routing:shadow] {...}` JSON line with the Decision. In `on`: a `reject` is **422 `CANNOT_RUN_HERE`** with the
  engine's sentence; and a queued job is failed at **claim** time, with a reason and without starting, if an
  out-of-memory ceiling at or below its size was learned while it waited. Jobs of unknown size are never judged.
- The server's tools are reported from the same detectors that run them (`detectFoldxBinaryAndDir`,
  `checkP2RankCapability`), cached 10 min; `verified` means "present" until a self-test exists. Read the shadow
  log for a false "missing" before switching to `on`.
- Out of memory = SIGKILL that Node did not send, exit 137, Java `OutOfMemoryError`, Node heap exhaustion,
  `bad_alloc`/ENOMEM. FoldX reports it as "did not fit in memory on the server" (new `out-of-memory` failure kind,
  checked before the Box64 crash text); for other tools the queue prefixes the same sentence.
- Not done: admission **by running cost** (needs measured memory to mean anything); "one heavy job per host".

**Where WP-E differs from section 7** (the code is the source of truth):
- The cache keys already covered the coordinates actually used (FoldX: hash of the cleaned `effectiveWtPdb`;
  P2Rank: hash of the exact text) plus mutation/residue, chain and conditions. **Tool version is added only when
  a host reports one** (agents, WP-F), so every existing server cache entry stays valid; the server's bundled
  FoldX/P2Rank are the versions those entries were computed with.
- The leader/follower logic is now a reusable `JobRegistry`; FoldX keeps its function names, P2Rank uses
  `pocketJobRegistry`. Every person who submits or joins is a watcher (WP-B), so one cancel never stops the run
  for the others.
- P2Rank now checks its result cache **before** queueing and answers a hit as an already-completed job (the
  client's polling is unchanged; no queue slot). Before, every request queued a job, even for a cached result.
- Provenance is the `computeProvenance` field on each stored result: `computedOn`, `hostClass`, `toolVersion`,
  `ownerId`, and for agent results `shared` and `validated`. The queue stamps the job's own result with its owner;
  the FoldX cache stamps what it stores. A result with no provenance predates this and is the server's.
- The sharing rule is one pure function, `mayServe` (`src/shared/computeProvenance.ts`): server results go to
  anyone; an agent result goes to its owner, and to others only when validated **and** shared. Both cache reads
  (FoldX `getMutantFromCache(key, requesterId)`, P2Rank in the route) apply it. Agents do not exist yet, so today
  every result is the server's; WP-F must stamp `shared` from the owner's `share_results` and `validated` from
  `validateAgentResult`.
- Still process-local: two replicas can both run the same job (unchanged; the reservation would have to move into
  the shared store).

**Where WP-F differs from section 7** (the code is the source of truth):
- **Pairing is a code exchange.** `POST /agent/pair` (signed-in person) returns a six-character, single-use,
  10-minute code (no 0/O/1/I/L), stored hashed; the agent trades it for its token at `POST /agent/pair/redeem`
  (public, a sign-in write, throttled with the address limit of 20 per 15 min). The token is shown once.
  `GET /me/agents` and `DELETE /me/agents/:id` list and disconnect a person's computers. A token stops working
  the moment its owner is disabled, not only when revoked.
- **The claim answers 200 `{job: null}`** instead of 204, so every answer carries `foldxBundleVersion`.
- **What an agent may take, and when.** Only its OWNER's queued jobs, `placement` NULL or its own, a kind it has
  a self-tested tool for, passing the engine's hard filters for that computer (`decidePlacement` with the
  computer as the only host and the owner's `placement_pref`; `server_only` never claims). Without live
  routing an idle server claims a job within 50 ms, so a computer takes its owner's **backlog while the server
  is busy**; with `COMPUTE_ROUTING=on`, WP-G2 PLACES jobs on it (see WP-G). A job placed on a computer that
  cannot take it is released by the housekeeping sweep (every 15 s since WP-G2). A team FoldX copy whose version no longer matches the bundle is not offered FoldX work.
- **Agent jobs are not server load.** Everywhere the queue measures the server (fair rotation, positions, wait
  estimates, the load snapshot, `serverMsSince` and the daily cap, the 960 s reaper) rows with
  `claimed_by = 'agent:%'` are excluded; `claimed_by` stays on a finished agent job so history is attributable.
  Restart recovery leaves an agent's job alone while its lease is live.
- **One rule for every hand-back.** A lost lease, any agent failure (whatever its class), an invalid result, or a
  computer disconnecting hands the job to the server with `placement = 'server'`, so it is retried exactly once
  and never re-offered to a computer. A computer is never trusted to FAIL a job: someone else may have joined it,
  and the server's run gives the real answer. The 960 s reaper does not judge agent jobs; a job held past its cap
  plus a minute is handed back too.
- **The FoldX worker was split** at the portable seam (`services/stability/foldx-queue-job.ts`, behaviour
  unchanged for the server): at an agent's claim the server starts RaSP and StabilityOracle, and when the
  computer's validated FoldX result arrives it is finished (published early, companions awaited, enriched)
  exactly like a server run. The lease is extended for that finishing so it cannot expire mid-way.
- **`validateAgentResult`** (`agent-results.ts`): zod schemas (unknown keys dropped, never stored), finite and
  bounded numbers (|ddG| <= 200), identity (the mutant structure has the requested residue type at the requested
  residue and chain, and keeps >= 95% of the template's residues; the paired wild type has the wild-type
  residue), P2Rank only as `success` with engine `p2rank` or `none_detected`, and a well-formed tool version on
  the optional `AGENT_ACCEPTED_*_VERSIONS` list. Provenance `{computedOn: "agent", validated: true, shared:
  owner's share_results}`. Cache keys carry the tool version only when it differs from the server's.
- **Telemetry** for an agent attempt is keyed `<jobId>@agent:<id>`, so a later server run of the same job does not
  erase what the computer's attempt taught (an out-of-memory death sets that computer class's ceiling). Lease
  losses are counted in `agent_claims` (queue database) and give the engine its `leaseLossRate`.
- **Team FoldX upload is `PUT /admin/tools/foldx/:platform` with a raw zip** and the header
  `X-Foldx-Licence-Confirmed: yes`, not multipart (the app accepts only JSON bodies; this one path is exempted in
  `validateContentType`, and a zip content type always needs a CORS preflight). The zip is checked before it is
  stored: the program for that platform recognised by its executable header (PE / ELF / Mach-O), `molecules/`,
  `rotabase.txt`, the build date. The same checker serves the agent's "drop your zip" step. Versions are a
  monotonically increasing generation, so a revoke or re-upload always changes the number computers compare.
- **Agent downloads**: `GET /me/agent-downloads` lists the zips in `AGENT_BUNDLE_DIR` (default
  `data/agent-bundles`, on the data volume); the admin builds them with `npm run build:agent` and
  `npm run build:agent-bundle -- --platform <p>` (portable Node 22.23.3 with its pinned SHA-256).
- **Rate limits**: agent requests skip the per-address `apiLimiter` (a lab's computers share its NAT address with
  its browsers) and get 120 per minute per computer; the FoldX bundle download 12 per hour per computer.
- **Runtime downloads are pinned**: Temurin JRE 21.0.12.1+1 per platform (Adoptium's checksums) and P2Rank
  2.6-alpha (the server's version, so pocket results share its cache keys; GitHub's published digest). A verified
  download is reused if unpacking failed. On Windows the agent uses `System32\tar.exe`: Git's GNU tar, often first
  on PATH, reads `C:\...` as a remote host (found in the real run below).

**Verified for real on Windows (2026-10-11).** The bundled `dist/agent/agent.cjs`, as its own process with an empty
home folder, against the real router in-process: paired by code; downloaded and hash-checked Java and P2Rank;
ran P2Rank 2.6-alpha on 2OCJ (residue 175, 5 s); the result passed validation and completed the job as
`computedOn: agent`. Then the team path: the admin uploaded the licensed Windows FoldX (checked, licence
recorded), the computer installed it by itself, its self-test passed (FoldX 5.1), it ran 2OCJ R175H (23 s, phases
reported through heartbeats), and the real output passed `validateAgentResult`. Not yet run for real: macOS and
Linux bundles, a clean Windows machine without Git, and a browser walk of the two new settings screens.

**How the client behaves** (`AccountGate`, mounted around `<App/>` in `main.tsx`):
- `legacy` with no accounts, or a server without the account routes: the app exactly as before, with no
  account chrome.
- `/#invite=…`, `/#reset=…`, `/setup`: a full-page card; the token leaves the address bar on load.
- `accounts` and signed out: a full-page sign-in, and the app does not mount. If a session ends while
  the app is open, a sign-in dialog that cannot be dismissed appears over it, so no work is lost.
- `hybrid`/`legacy` with accounts: a "Sign in" button in the header and a dismissable dialog.
- An expired session is detected through the existing auth-lapse signal (`subscribeAuthLapse`).
- The first admin lands on Settings → Team, and the first-visit tour does not open over it.

**Review, 2026-10-10.** Four read-only reviewers (security, server correctness, client UI and
accessibility, tests/ops/docs) reviewed this branch and PR #92. Fixed: a damaged stored password hash
now fails closed; the near-tie rule ignores hosts with no time estimate; `/agent` matching is
case-insensitive and `/agent/pair` (a signed-in person's request) is exempt; a reset lifts a sign-in
lockout; the current-password check is throttled; invite/reset replacement is one transaction; one
shared email rule (`isValidEmail`); dialog Escape/Tab no longer reach the drawer underneath; menu
focus returns to the avatar; a hidden settings tab falls back cleanly; the start-up session check
retries once. Not changed, by decision: `trust proxy = 1` is safe only while the app port stays
unpublished (production publishes only Caddy's 80/443; keep it that way); the CORS `*.duckdns.org`
wildcard predates this branch and is contained by `SameSite=Lax` plus the exact-Origin write check.
**This branch must land with or after PR #92**, which carries the AlphaGenome key fix.

**Where WP-I3 differs from section 7** (the code is the source of truth):
- **The pause is per hostname**, because that is what a provider counts; one host can serve several tools
  (UQ BioSig serves DynaMut2 and DDMut, so a 429 on one pauses both). I1 adds the provider registry on top.
- **The flag has three states, and `off` is exactly today's behaviour**, including the 429 counting toward the
  breaker: with no pause in force, the breaker is the only thing that stops a burst against a provider that is
  refusing us. `shadow` records pauses, shows them on `/capabilities` and logs each call it would have held
  (`[egress:shadow]`), with responses and breaker accounting unchanged. Only `on` holds calls and takes the 429
  out of the breaker.
- **Length.** `Retry-After` (seconds or an HTTP date), capped at 10 s, the bound `fetchWithRetry` already uses;
  5 s when it is absent, unparseable, 0 or in the past. A later answer can lengthen a pause, never shorten it.
  A 503 pauses only when it carries `Retry-After`.
- **Who waits.** A caller with a `deadlineAt` that leaves room for the pause plus 1.5 s waits; any other caller is
  refused at once with `ProviderRateLimitedError` (`code: PROVIDER_RATE_LIMITED`, `retryAfterSec`, and the
  provider's own status as `statusCode`, so existing `=== 429` checks still work). `fetchWithRetry`'s own
  retry after a 429 waits for the team pause too. Health probes are exempt from the gate (a monitor must still
  observe the provider) but their 429s are recorded. `withHostLock` (node:https callers) honours the gate.
- **DynaMut2 / DDMut.** The DDMut poll (node:https) records its own 429. A rate-limited poll answers
  `UNAVAILABLE` with `reason: "rate_limited"`, `retryable: true`, `code` and `retryAfterSec`, so the client keeps
  listening (the job is delayed, not failed) and says "DynaMut2 is limiting requests; retrying in N s." A
  rate-limited SUBMIT still returns `null` like any other failed submit: its four callers take `string | null`.
- **`/capabilities` gains `egress: { mode, providers[] }`**: hosts paused now or rate-limiting in the last
  15 minutes, with `state`, `pausedUntil`, `retryAfterSec`, `recentRateLimits`, `wouldHold` and
  `limitBasis` (filled from the governor since I1). Hostnames and counts only.
- **Not in I3:** serving stale cache while paused belongs to I2 (done there: expired rows are kept and read on
  request, and the flag travels on the response, see "Where WP-I2 differs"). The raw `fetch` callers are gated since I1.

**Where WP-I1 differs from section 7** (the code is the source of truth):
- **No `provider` option and no per-call `userId`.** The governor keys providers by hostname (registry entries
  rate them), so the 27 files already on `fetchWithRetry` are governed without edits. Who a call is for comes
  from an AsyncLocalStorage owner (`egress-context.ts`): the API router sets it after `authCheck`
  (`attributeEgressOwner`: the signed-in person, else `legacy`), and the queue sets it for each job from
  `owner_id`, so prewarm jobs run as `system`. A call outside both is `unattributed`, served like a person.
  **Fair share between people therefore needs `AUTH_MODE=accounts`**: in `legacy` every request is the one
  `legacy` owner, and the governor only orders people's calls against prewarm. `credentialId` is I4.
- **Raw `fetch` sites moved to `governedFetch`, not `fetchWithRetry`.** `fetchWithRetry` would also impose its
  15 s default timeout and retry policy on long folding calls and job submissions; `governedFetch` only decides
  WHEN the request goes (the 429 pause, then a turn) and records the answer, leaving each site's own timeouts
  and retries. 41 calls moved: the 39 listed in `EGRESS_AUDIT.md` section 5, plus two loopback sidecar calls in
  the same files (`energy-models.ts` ThermoMPNN, `esmfold.ts`), which pass straight through.
  `egress-ratchet.test.ts` lists the 18 raw calls left (the implementations, loopback sidecar and health
  probes, the JapanFold probe, the AlphaGenome connection test) with exact counts: a new raw call (including
  `globalThis.fetch(` and `fetch (`) fails it, and so does a removed one until its count is lowered. Its scope
  is `server/services` and `server/routes`; `server/agent` runs on a person's own computer.
- **One turn per ATTEMPT.** Inside `fetchWithRetry` each attempt takes its own turn (and per-host semaphore
  slot) and gives it back before the backoff sleep, so a retrying call neither holds a slot others wait for nor
  sends three requests on one token. A refusal by the governor or the pause is thrown at once: not retried,
  not counted toward the breaker. A call without `deadlineAt` waits for its turn no longer than its own
  attempt timeout. The per-host semaphore is sized up when an override raises `maxConcurrent` above 5.
- **Rates.** Only two are published: Ensembl, 55,000/hour, 15/s average (900/min, burst 15), and NCBI E-utilities,
  3/s per IP or 10/s with `NCBI_API_KEY` (which `clinvar.ts` sends when set). Each carries its source URL.
  Every other provider is `unmeasured`: 5 concurrent calls, the per-host semaphore's own number, so `on`
  changes ORDER rather than throughput. A rate-limit answer (429, or 503 with `Retry-After`) halves a rate
  once per 5 s (refusals to calls already in flight are one episode, not several), never below a tenth of a
  published rate or 5/min; 20 successes raise it by 5% (at least 1/min), never above a published or configured
  rate. An unmeasured provider learns a rate (half its last minute's calls, `observed`) only from a 429 after
  at least 10 calls in that minute, and forgets it after an hour without another: a lone 429 in light traffic
  says nothing about our pace (the first version taught DynaMut2 "1 call a minute" from a single refusal).
- **Overrides** (`EGRESS_PROVIDER_LIMITS_JSON`) are keyed by registry id or hostname. A key naming a registry
  entry (by id or any of its hostnames) is merged into it: a published rate keeps its source and stays the
  ceiling (a higher override is held to it). A hostname with no entry gets the operator's values
  (`configured`, also a ceiling). Each entry is validated on its own (rates of at least 5/min); a bad entry is
  logged and skipped.
- **Waiting.** A call waits for its turn until 1.5 s before its `deadlineAt` (a fixed margin), else at most
  120 s, then fails with `EgressWaitExceededError` (`EGRESS_WAIT_EXCEEDED`, 503, "X is busy with other requests
  from the team; try again in a moment."). An aborted waiter leaves the queue. A `system` call that has waited
  30 s is served in turn with the people, so prewarm is delayed, never refused for being last.
- **Callers do not read a refusal as an outage** (`isEgressRefusal`): AlphaGenome does not cache it as
  "unavailable" for 5 minutes, the Europe PMC circuit and the Alliance release cache ignore it, and the
  coordinate resolver reports it as `rate_limited` ("... or the server is pacing the team's calls ..."). Many
  other sites still swallow errors into their own "unavailable" state, so the busy sentence often never
  reaches a reader; that is the I2/I4 follow-up, not a new failure mode.
- **Lanes.** A JapanFold fold or submit holds its request open until the model answers. Those calls run in a
  `compute` lane with their own 5 slots, so a 3.5 s ESM-C or SaProt call to the same host does not wait behind
  them. A lane is refused for a provider with a published rate (it would double the rate).
- **DDMut and DDMut-PPI** (node:https under `withHostLock`) report their HTTP status (`reportEgressAnswer`), so
  their 429s pause BioSig and adapt its rate like any other call.
- **Modes.** `off` is plain pass-through. `shadow` lets every call through, counts the ones it would have held
  (`wouldHold`, a `[egress:shadow]` line at most once a minute per provider; the I3 pause's lines are now
  throttled the same way) and still adapts rates; its token bucket never goes into debt, so switching to `on`
  does not open with a backlog. `on` holds. Health probes are never governed. Loopback, private and link-local
  addresses (IPv4 and IPv6) and `.local`/`.lan`/`.internal` and dotless names never are.
- **State is per process.** During a blue/green hand-over the old and new process each keep their own counts,
  so for that window the shared IP can see up to twice a published rate.
- **Hosts met at run time are bounded**: past 200, idle ones are forgotten. Request-chosen endpoints (a person's
  own AlphaGenome or GPN server) reach the governor too.
- **`/capabilities` `egress`** (public): `governor` lists, per provider seen since start-up, its concurrency,
  in-flight and waiting calls, rate, basis and source, and the counts `calls`, `held`, `wouldHold`, `refused`,
  `rateLimits`. Hosts that are neither registered nor one of the deployment's own providers
  (`isKnownProviderHost`) are summed into one unnamed `other` line, and the pause lines are filtered the same way
  (`otherPausedOrRateLimitedHosts`). The JapanFold reachability check is cached for 60 s, so the public page
  cannot make the server call JapanFold on every read. Log and error messages from `fetchWithRetry` drop the
  query string (NCBI's `api_key`).
- **Not in I1:** pre-warm skipping keys already cached (I2), per-credential buckets (I4), and a dedicated
  reader-facing state for "busy" in the callers that swallow errors.

**Audit facts the next packages must start from** (verified against the code, 2026-10-09):
- **WP-I3 (resolved under `EGRESS_GOVERNOR=on` by WP-I3; `off` keeps it):** a fast 429 does **not** stay out of the circuit breaker today. The fast-refusal path `break`s
  out of the retry loop and reaches the unconditional `breaker.recordFailure()` after it
  (`server/services/infra/http-client.ts`, ~line 375), so the "429 does not count" premise in I3 is a change
  to make, not existing behaviour.
- **Security, outside this plan:** the AlphaGenome bridge falls back to the server's `ALPHAGENOME_API_KEY`
  while taking the endpoint URL from the request (`x-alphagenome-url` / `alphagenomeApiUrl`), so a caller can
  have the server send its key to any URL (`alphagenome-bridge.ts` lines ~121-122 and ~367-368;
  `routes/variant/alphagenome.ts` `verify-connection`). **Fixed on branch `fix/alphagenome-key-scope`**
  (`resolveAlphaGenomeAccess` in the bridge): a request-supplied URL gets only a request-supplied key, and
  its answers stay out of the shared cache.

**Where WP-I2 differs from section 7** (the code is the source of truth; `doc/EGRESS_AUDIT.md` section 8 lists
each audit finding's status):
- **The stale flag is on the response, not on the value.** A cached value can be a string, an array or a map
  keyed by residue, so adding `stale: true` to it would corrupt some of them, and an outer cache would store the
  flag with the value. Instead every request runs in a cache scope (`cache-scope.ts`, AsyncLocalStorage, the way
  `egress-context.ts` carries the owner): a stale serve is noted there, and `markStaleResponses` adds
  `X-MSE-Stale: [{data, provider, ageSec, busy?}]` (exposed to allowed cross-origin pages). The streamed analysis
  has sent its headers before it fetches anything, so it ends with a `{type: "stale", notes}` frame instead. The
  client shows "Showing UniProt FASTA data saved 3 h ago; UniProt is limiting requests." once per data label per
  5 minutes.
- **What counts is what the fetch saw, not what it threw.** Many fetchers catch errors and return null. A 429 (or
  503 with `Retry-After`) recorded by `recordRateLimit` and a team-pause refusal are noted as "limited"; a
  governor wait that ran out is noted as "busy" (the provider refused nothing; the notice says it "is busy with
  other requests from the team"). Either lets `getCachedOrFetch` serve the expired entry whether the fetcher
  threw or returned an empty answer. Without a note an error stands, even with an expired entry available. Like
  I1 and I3 it acts only under `on`; `shadow` counts `wouldServe`.
- **A result built from stale data is returned but not stored**, at every level: a registry fill whose scope saw
  a stale serve skips its own write; an analysis is not saved to `variant_analyses`; the landscape, the structure
  tier memo and a Genos window are not cached when their calls were refused, held back or answered stale (or,
  for the landscape, when the reference sequence did not arrive).
- **Shared work runs in a scope of its own** (`startShared` / `joinShared`): registry fills and `singleFlight`,
  the shared core-analysis run, and `shared-flight.ts`. Every caller, leader or joiner, copies the notes into its
  own scope when the work settles, so a joiner's response is flagged and its writes are gated too. A caller that
  passes `serveStale: false` does not join a fill that may serve stale data.
- **Expired L2 rows are kept 30 days** (`EXPIRED_CACHE_RETENTION_MS`); the purge (at start-up, as before) removes
  only rows expired longer ago. Ordinary reads still ignore them.
- **Single-flight outside the registry** is a small helper (`shared-flight.ts`), not a second cache: the shared
  call runs without any caller's signal (it has its own timeout); a caller's abort ends only its own wait, and a
  caller that has already aborted starts nothing. The shared call runs under the first caller's egress owner, so
  a joiner's call is ordered as the first caller's. Tamarind submits are not shared: a pending job belongs to the
  submitting account's key, which is I4's credential question.
- **Prewarm** runs as `system` for its own fetches as well as its queue job, and skips a run whose FoldX result is
  already cached and shareable with anyone (`getMutantFromCache` without a requester).
- **Not in I2:** queue job results (FoldX and the remote engines) carry no stale flag; gnomAD still returns `null`
  for any error; the module-level caches stay in-process; a registry fetcher that captures its first caller's
  `AbortSignal` still fails the callers that joined it; the SSE job stream has no stale frame.

**Where WP-I4 differs from section 7** (the code is the source of truth):
- **Which credentials.** Biohub (EvolutionaryScale Forge: ESM3, ESM-C, ESMFold), Hugging Face (ESM-2, SaProt,
  GPN-Star) and Tamarind. AlphaGenome and Gemini keep their own handling (`resolveAlphaGenomeAccess`, the
  Gemini session), and JapanFold has only a server key.
- **One resolver** (`credentials.ts` `resolveCredential`): the token the request brought, else the one the
  signed-in person saved to their account (I4b), else the team token under `SHARED_TOKEN_FALLBACK`. Routes pass
  on only what the request brought; services resolve. A token handed down is classified by VALUE (equal to the
  team token means the team's), as `resolveAlphaGenomeAccess` does, so passing it along cannot make the team
  token look like a person's. A person with their own token never reaches the team step.
- **`limited`, made concrete.** Each signed-in person may make `SHARED_TOKEN_SHARE_PER_HOUR` (default 60)
  team-token calls per provider per hour; past that the call runs without a token (the sidecar stays local, or
  the model is skipped) and the reader is told to add their own. Calls are counted when they are SENT, so a
  cache hit costs nothing; a status poll or a connection test is never refused and never counted. Without
  accounts (`legacy`) nobody is told apart, so `limited` behaves like `on`. These are policy numbers, not
  provider limits.
- **Buckets.** A person's own token gets its own governor bucket (`host#own:<id>`) and its own 429 pause:
  the provider counts that token, not the team's. The id is random, kept in a process-local map; never the
  token or its hash. `/capabilities` folds these buckets into one `… (people's own tokens)` line per provider.
  Calls that leave through the Python sidecar (which goes remote only when given a token) are governed as the
  provider they reach (`governedForCredential`).
- **"After each remote model result".** Each response says whose token its calls used (`X-MSE-Credentials`; a
  final `{type: "credentials"}` frame on the streamed analysis); the app shows "Biohub ran on your token." or
  "... on the team token. Add your own ..." at most once per provider and source per 30 minutes, a refusal once
  per 5 minutes, and Settings → Connections shows the last use under each token. A result served from a cache
  made no call, so it says nothing.
- **Sharing.** The core-analysis flight key no longer separates two different Hugging Face or Biohub tokens
  (whether one was available still separates runs). A Tamarind submission is shared between callers on the
  same token, with the job id joinable for 60 s, never across tokens: a pending job can only be polled with
  the key that submitted it.
- **I4b.** `user_secrets` in `accounts.sqlite`: AES-256-GCM, key from HKDF-SHA256 over `APP_SESSION_SECRET`
  (its own label), the person and the kind bound as additional data. `GET`/`PUT`/`DELETE /me/secrets[/:kind]`
  return the kind, the last four characters and the date, never the token. Rotating `APP_SESSION_SECRET`
  leaves saved tokens unreadable; Settings asks for them again. "Test connection" tests the person's own token
  only, never the team's.
- **Not in I4:** queue jobs resolve with the job owner's saved token or the team's, not a token the browser
  sent with the submit (it is not stored with the job); the AlphaGenome key keeps its flight-key fingerprint.

**Review 5 (WP-I2), 2026-10-14.** Four read-only reviewers (stale-serve core, the negative-caching fixes,
single-flight and prewarm, client/tests/docs). Fixed: analyses built from stale data were saved to
`variant_analyses` and later restored with no flag; the shared core-analysis run, the registry's `singleFlight`
and `sharedFlight` ran in the first caller's scope, so joiners were never told and could cache what they built;
the streamed analysis lost the header (now a final frame); an expired L1 entry reported its age as 0 s
(`lru-cache`'s `info` gives the time left, not the time stored); the notice named a sibling call's provider as
the stale data (it now names the data and the provider separately) and called a governor timeout "limiting
requests"; the landscape, the structure tier memo and Genos windows cached results built while a provider was
refusing or from an empty reference; the SaProt key omitted the structure it sends (two structures shared one
answer for 14 days); popEVE's missing files answer 403 `AccessDenied` from S3, not 404, so "no file" was never
remembered (verified live); a biophysical "details unavailable" placeholder was cacheable, now in a key all keyed
users share; the biophysical route counted a placeholder `GEMINI_API_KEY` as a key; `sharedFlight` started a
call for an already-aborted caller; SpliceAI sent the contig unnormalised under a normalised key; single-flight
cleanup could delete a newer entry after `clearAll`; a throwing stale-data listener failed the request; the
header was not exposed to cross-origin pages. Not changed: a BioSig job id lingers 60 s (a stuck DDMut job is
then shared for that minute), and the route keeps its own 60 s linger beside it.

**Review 4 (WP-I1), 2026-10-13.** Four read-only reviewers (governor core, the raw-`fetch` migration,
security and operations, tests and docs). Fixed: a burst of 429s halving a published rate once per refusal
(now once per 5 s, floored at a tenth); a hostname-keyed override replacing a published limit (reproduced at
4,224/min against 900); retries holding a slot through their backoff and spending one token on several
requests; prewarm refused after 120 s under steady load (now promoted after 30 s); `/capabilities` naming
request-chosen hosts and probing JapanFold on every public read; unbounded per-host state; the NCBI key in retry
log lines; AlphaGenome negative-caching, the Europe PMC circuit and the coordinate resolver treating the server's
own refusals as provider failures; DDMut/DDMut-PPI 429s not reaching the governor; long JapanFold folds holding
the slots short calls need; shadow token debt; a prefix-matching `isLocalHost`; an unthrottled pause log; and
the missing tests (attribution, route payload, learning boundaries, overrides). Rejected: "only 39 calls were
migrated" (41 were; the two the reviewer counted as left are separate health probes). Not changed: Boltz still
reports a refusal as a `network` failure with the busy sentence as its detail, and the `legacy` owner is one
bucket for every anonymous caller (accounts mode is the fix).

**Review 3 (routing line), 2026-10-11 (WP-G1, WP-H, and the fixes from Review 2).** Four read-only reviewers
(queue correctness, security, client UX, contracts/docs) on everything after Review 2 — `6573035`, `673eb16`,
`981dc08`, `4c80cca` and the then-unmerged `feat/wp0-measure`. No critical defect and no regression from the
five packages. (A separate round the same day covered the WP-0 remainder after #110 merged; its record is the
**Review 3 (post-merge of #110)** note in the WP-0 section below, and it shipped the two findings both rounds
reached independently — see below.) Fixed: a caller-chosen GPN URL that merely *mentioned* `.huggingface.co` was
handed the server's `HF_TOKEN` (now only the configured endpoint receives it, `resolveGpnAccess`); a cancelled
FoldX run read as "Failed — The calculation failed for this variant." in Energetics (a new `cancelled` engine
state, so the panel and the result now agree); the FoldX wait estimate divided the work ahead by the *queue's*
slots instead of the FoldX semaphore, reporting about a quarter of the real wait on the 2-core host; the badge
missed a job started in the focused window (a submit announces, and `visibilitychange` refreshes); Settings
promised queue headroom that an admin-set quota removes (`queuedPerUserExplicit` is now on `/auth/me`); the
owner of a shared job was told "Stop this job" though stopping only withdrew their own interest (`watchers` on
`JobSummary`); a cancel could leave no visible confirmation; the panel printed the queue's own error prose; the
runbook contradicted `resolveFoldxConcurrency`; the spec published the write routes as unauthenticated and
omitted the `409 STALE_STRUCTURE_REF` that `/pocket-finder` and `/nearest-residues` really return; and §0.4
still listed shipped packages as outstanding.

**Two findings this round shared with the WP-0 round, and where their fix landed.** A non-clean host probe ran
its self-test inside the serialised submit chain, stalling **every** submitter for up to 60 s; and a
lease-expiry timeout recorded no peak memory, losing the measurement on the ending most likely to be a memory
runaway. Both were found independently by this round and by the WP-0 round, and **#111 shipped the fixes**
(`serverToolsCached` on the submit path; the reaper reading the job's own meter), so this branch carries
neither — two competing fixes for one bug would be worse than one.

Left, by decision: `BIOPHYSICAL_CONCURRENCY` keeps its documented "explicit value wins" behaviour (the docs
were wrong, not the code); the de-duplication join stays owner-blind until WP-F exists (finding S2, recorded as
a WP-F prerequisite above); and the low-severity notes (a public uncapped `/jobs/events`, the public
`/test-hf-connection` disclosing the server's HF account name, and test-quality gaps) are listed in the review's
own report rather than fixed here.

**Where WP-C's shipped contract differs from section 5** (the code is the source of truth; these are the
places a later package would otherwise trip):
- `Prediction.wallMs` is **nullable**. P2Rank has no timing prior, so before telemetry it is `null` and the
  engine ranks by load (`HostFeatures.runningJobs`, then running + queued cost). Section 5.2 described this
  as a "null-equivalent"; it is now a real `null`.
- `HostFeatures` gained `label` (reader-facing host name used in the reasons) and `runningJobs`.
- `RoutingPolicy.nearTieMarginMs` became **`nearTieFraction`** (0.20 = `ROUTING_TIE_MARGIN`), applied to the
  best expected completion; `RoutingPolicy` also carries `minSamples` (`COST_MODEL_MIN_SAMPLES`). Use
  `DEFAULT_ROUTING_POLICY`.
- `Decision` gained `ranked` (every feasible host with its prediction and expected completion, best first),
  which is what shadow mode (5.4) should log.
- **`repair` is not "residues <= 400".** The runner also skips RepairPDB for AlphaFold DB models. Build the
  flag with `foldxRepairApplies(residues, isAlphaFoldPdb)`. `FOLDX_REPAIR_MAX_RESIDUES` now lives in
  `src/shared/computeRouting.ts`; `foldx/budget.ts` re-exports it, so there is one number.
- `CostModels` is a frozen record keyed by `costModelKey(type, hostClassOf(host))`. Host class rounds total
  RAM to the nearest GiB (`x64-native-8c-16g`), so a machine reporting 15.6 GiB shares the 16 GB class.
- `cost-models.ts` takes **rows, not a database**: `buildCostModels(TelemetrySample[])`. WP-0 owns the
  `job_telemetry` table and maps its rows to `TelemetrySample`. Only `completed` rows feed the curves and
  `maxCompletedResidues`; only `oom` rows set `oomCeilingResidues`, and the ENFORCED ceiling is
  `enforcedOomCeiling` — the **second-smallest** out-of-memory size, i.e. the smallest size at or below which
  the host has died at least twice. One death is deliberately not enough (a single misclassified failure would
  otherwise refuse every job of that size and larger for good). The older `oomCeiling` helper still exists but
  nothing enforces it; do not build on it.
- The conservative memory rule is applied as a **size** rule while memory is unmeasured: refuse above
  1.25 x the largest completed size, and never refuse a class with nothing completed (that would refuse
  every first job). "One heavy job per host" is an admission rule for WP-D, not a placement filter.
- Priors: native BuildModel is a line through the two native measurements (2.3 s at 154, 4.7 s at 875);
  emulated BuildModel is `167.2 s x (residues/1085)^1.44` split 13.3 : 153.9 between fixed and per-run
  (reproduces 167.2 s, the 44.0 s single run and ~10 s for SOD1). RepairPDB is ONE measured curve,
  `49 s x (residues/154)^2.1`, through two **native** points (49 s at 154 from `compute:benchmark`; 205.4 s
  at 305 from the `foldx/cache.ts` table, whose BuildModel column is native — not the emulated 489-residue
  reading once assumed). The emulated repair prior reuses that curve times the same-size BuildModel
  emulation penalty, so it is never faster than native **[emulated estimate]**.

---

**Review 2, 2026-10-10 (WP-B, WP-0/D, WP-E).** Four read-only reviewers (queue correctness, security, ops,
tests/docs). Fixed: the queue running ONE job at a time on the 2-core server (shipped in WP-B; PR #104 restores
4 slots and derives the FoldX limit); a ceiling is now enforced only after **two** out-of-memory deaths at or
below the size, deaths older than 30 days are forgotten, and `DELETE /admin/compute/ceilings` clears them; a job
we kill ourselves is never recorded as out of memory; the claim-time size check cannot crash the queue;
telemetry records reaper timeouts, soft failures (a worker that resolves with `failed`/`unavailable`) as failed,
and a job cancelled while finishing as cancelled; start times are strictly increasing, so queue positions match
the claim order; submissions are serialised, so concurrent requests cannot jointly exceed a limit; the daily
cap counts the estimates of jobs already waiting; an admin's cancel always stops the job; joining lifts only
pre-warm priority; restart recovery clears agent lease fields; finished jobs are pruned after 14 days
(`JOB_RETENTION_DAYS`) and telemetry after 180 (`TELEMETRY_RETENTION_DAYS`); a follower is never handed the
leader's refusal; the host class is read once per process and the tool probe is single-flight; the P2Rank
worker never reuses a private result from its cache and pocket cache entries carry provenance; poll responses,
the broadcast stream and `/my-jobs` never show another person's account id; the shadow log uses a pseudonym and
skips pre-warm; signed-in (credentialed) CORS is limited to exact origins (`corsDecision`); the engine tunables
are read from the environment. Left, by decision: without accounts, anonymous work meets only the host backstop
(turn accounts on); the cancel route distinguishes 404/403/409 (job ids are unguessable UUIDs); the newcomer
reserve counts waiting jobs while the backstop also counts running ones; a P2Rank out-of-memory death falls back
to fpocket and is not learned; `repaired` in telemetry is the plan at submit, not what ran; OpenAPI is WP-H.

### 0.4 Consolidated status and next phases (2026-10-11, after WP-0 and Review 3)

**Everything through WP-H is on `main`:** WP-A, WP-B, WP-C, WP-0 (core #100-series and the remainder #110), WP-D
(in `shadow`), WP-E (#103, review fixes #105), WP-G1 (#106), WP-H (#109), WP-F (#118). **WP-G2** is on
`feat/wp-g2-routing` (2026-10-12). The list below is what is still missing, so a later agent does not have to re-derive it from the
per-package notes above.

**Owner actions (not code):**
1. Accounts rollout: `/setup`, invite the team, then `AUTH_MODE` legacy → hybrid → accounts, step by step in
   `doc/ACCOUNTS.md`. Apply each change with `python3 deploy/rollout.py --restart --commit <serving sha>`.
   Until then every job is `legacy`-owned: fairness, limits, my-jobs and usage are inactive in practice.
2. Read a few days of `[routing:shadow]` lines (`docker logs`) before `COMPUTE_ROUTING=on`. Check: no line says
   FoldX or P2Rank is missing on the server; how often the 1.25 x largest-completed size rule would refuse; and
   (since WP-G2 the lines weigh each person's connected computers) how often a job would have gone to one.
   `on` turns on both the refusals and live routing.

**Gaps left on purpose, each with its home:**

| Gap | Why it matters | Home |
|---|---|---|
| The server's own benchmark (`compute:benchmark` on the ARM host); emulated RepairPDB prior is still an estimate | priors for the server class | owner action, ACCOUNTS.md |
| Admission by running cost; "one heavy job per host" | memory is measured per job now; the memory fit needs 8 MEASURED peaks (not weeks) before it replaces the size rule, which still applies | WP-D2 |
| The agent bundles are not built or published by CD; the admin builds them (`doc/AGENT.md`) | a team member cannot download the agent until the admin does | WP-H2 (CD step) |
| macOS and Linux agent bundles not run for real; unsigned bundles meet SmartScreen / Gatekeeper warnings | first start needs "More info → Run anyway" / right-click Open | test pass; code signing if the team grows |
| De-duplication is process-local (two replicas can run the same job); and a job that JOINS an in-flight FoldX run created in another job's AsyncLocalStorage context records no peak for that run (after the creating job's meter stops, later children in the shared run are untracked) | the first only matters with replicas; in one process `foldx-job-registry` single-flights per cache key, so a queue job cannot join another queue job's run | later; shared-store reservation + a per-run sampler |
| The I3 pause, the I1 governor and I2's stale serving ship `off` (production runs `shadow`); I4's team-token share applies only with accounts | the team shares one IP | owner actions: read the shadow lines, then `EGRESS_GOVERNOR=on`; `AUTH_MODE=accounts` |
| Redis backend ignores owners, limits, cancel-by-person | documented; production uses SQLite | none planned |
| A placement is decided once, at submit: a job placed on a busy computer is not moved when the server frees up (only when the computer cannot take it, or sits idle 2 min without claiming it) | the engine already prices the computer's queue, so a second job overflows to the server when that is quicker; re-deciding waiting jobs is an optimisation | later, if the logs show long waits on a computer |
| No preview before submit: the decision is shown from the moment the job is queued (submit response, poll, My jobs), not before the button is pressed | the job is queued or placed within the same request, so a preview would show the same thing a moment earlier | later, if wanted |

**Who uses it today (2026-10-10):** the owner alone, with a team expected soon. Decision (owner): build in
the team order below, as if colleagues were joining now. One owner action is still worth doing first, because
it costs nothing with one user: create the admin account (`/setup`) and set `AUTH_MODE=accounts`, which closes
the anonymous compute surface the security review flagged (in `legacy` mode anyone with the URL can queue jobs).

**Next phases, in order:**

1. **WP-F — agents** — done (#118).
2. **WP-G2 — live routing** — done on `feat/wp-g2-routing` (see WP-G). Then the owner action above:
   `COMPUTE_ROUTING=on` after reading the shadow log.
3. **WP-I — outbound governor**: I3 (team-wide 429 pause) done (#127, production in `shadow` since 2026-10-13);
   I1 (fair-share governor and the raw-`fetch` migration) done (#128); I2 (stale on rate limit, cache hygiene,
   cross-user single-flight, prewarm) done (#129); I4 (per-user credentials, with I4b saved tokens) done on
   `feat/wp-i4-credentials`. WP-I is complete. Owner action
   after a few days of `shadow`: read the `[egress:shadow]` lines and `/capabilities` `egress`, then
   `EGRESS_GOVERNOR=on` (`doc/DEPLOY.md` Step 7).

Shipped since the previous revision of this list, so nobody rebuilds them: **WP-G1** (`/my-jobs`, cancel and the
wait estimate reached the interface; #106) and **WP-H** (runbook, Cloudflare corrections, OpenAPI and
`doc/API.md`; #109). **WP-0 remainder** (#110) added the process sampler, `compute:benchmark`, tool self-tests
and measured memory; the only part left is an owner action — run `compute:benchmark` once on the server.

---

## 1. Goals and non-goals

Goals
- A user account is required to spend compute. Anonymous and shared-token access cannot queue heavy work.
- One person's batch cannot starve others or crash the shared host.
- A user's machine, when online, can run that user's own FoldX and P2Rank jobs.
- Every placement decision is explained to the reader, and priors are the measured numbers already in the repo.
- The team shares **one outbound IP** (the server's), so calls to remote providers are governed fairly and
  cached across users, and one person's burst cannot get the whole team rate limited (WP-I).

Non-goals
- No local ESMFold, no GPU tier.
- No donated pool: an agent only takes jobs from its own owner.
- No public sign-up and no email service. Users are created by an admin; a forgotten password is fixed by
  the admin issuing a one-time reset link.
- Cloudflare Access sign-in is not built in the first release (4.0, package WP-A2).
- No Redis/BullMQ support for the new features (section 3, item 9).
- No change to the FoldX timeout budgets.

---

## 2. Which services need compute

### 2.1 Run on the host (placeable)

| Service | How it runs | Evidence | Cost driver | Memory |
|---|---|---|---|---|
| **FoldX** RepairPDB + BuildModel (5 runs) | subprocess; native x64 or **Box64 on ARM64** | `server/services/stability/foldx/runner.ts`, `budget.ts` | residues; emulated ~ residues^1.44 | [unmeasured] |
| **P2Rank** | Java subprocess, cap 120 s (floor 90 s) | `server/services/structure/pocket/runner.ts` | structure size | [unmeasured]; 623 MB distribution on disk |
| **SaProt 35M / 650M** | PyTorch in the Python sidecar, windowed to 510 aa | `tools/model_server_app/routers/saprot.py` | window, model size | ~0.14 / ~2.6 GB weights fp32 [estimate] |
| **VESM-150M** | sidecar, CPU, loaded at warm-up | `tools/model_server_app/models.py` | length | ~0.6 GB weights fp32 [estimate] |
| **ESM-2 650M** | sidecar, **only with CUDA**; CPU hosts get VESM-150M instead | `routers/esm2.py` lines 178-190 | length | ~2.6 GB weights [estimate] |
| **StabilityOracle** | sidecar PyTorch, 4.9 MB checkpoint | `routers/stabilityoracle.py` | structure size | [unmeasured] |
| **ThermoMPNN** | sidecar PyTorch | `routers/thermompnn.py` | structure size | [unmeasured] |
| **Structural-diff pool** | Node worker threads, up to min(8, cores-1) | `services/stability/biophysics-pool.ts` | structure size | [unmeasured] |
| **RaSP lookup** | SQLite read, 761 MB file | `data/df_rasp_gnomad_clinvar.sqlite` | I/O only | page cache |

Sidecar limits: `MAX_LOADED_MODELS` defaults to 1 (a second model evicts the first); ESM-2 inference
has a semaphore of 1; torch threads default to 2.

**Only FoldX and P2Rank go through the job queue.** The sidecar models are called inline by their
routes. Phase scope below places only FoldX and P2Rank.

### 2.2 Remote (no local compute)

**ESMFold does not run locally.** The waterfall in `server/services/structure/esmfold.ts` is
JapanFold ESMFold2-Fast (hosted, up to 1,024 aa) -> EvolutionaryScale Forge via the sidecar
(`/predict/esmfold` is a thin client and needs a Biohub token) -> public ESM Atlas (up to 400 aa).
The ceilings in `src/shared/foldingLimits.ts` are provider limits. ESM3 refinement, the Forge
ESM-C path and the HF remote ESM-2/SaProt paths are also remote. Remote services also include
DynaMut2, DDMut, DDMut-PPI, AlphaGenome, SpliceAI, GPN, Genos, Gemini, gnomAD, ClinVar, UniProt, PDBe,
STRING, IntAct. They cost latency and rate limits, not local CPU or RAM.

### 2.3 Measured numbers that already exist (use as priors)

From the comment above `foldxBuildModelMs` in `server/config.ts`, measured with `npm run foldx:timing`:

| Host | Residues | Result |
|---|---|---|
| native Windows x64 | 154 | 2.3 s (BuildModel, 5 runs) |
| native Windows x64 | 875 | 4.7 s (BuildModel, 5 runs; ~0.5 s per extra run) |
| OCI ARM64 + Box64 | 1,085 | 167.2 s for 5 runs (13.3 s fixed + 30.8 s per run) |
| OCI ARM64 + Box64 | 154 (SOD1) | 9.6 s |
| not stated in the comment | 489 | RepairPDB 205 s, BuildModel 2 s (comment in the FoldX worker branch of `server.ts`) |

Emulated cost is `2 x (15 s + runs x residues x 30 ms)` as a cap (`foldx/budget.ts`), observed
exponent ~1.44. `FOLDX_REPAIR_MAX_RESIDUES = 400`: above it RepairPDB is skipped.

---

## 3. Facts about the current code that constrain the design

1. **Production is one OCI VM**: 2 OCPU Ampere, 12 GB RAM, app container limit 10 GB, FoldX under Box64.
2. **Two concurrency knobs disagree.** Queue: `CONFIG.server.biophysicalConcurrency`, default 4
   (`server/config.ts`). FoldX runner: `biophysicalSemaphore`, default `cpus - 1`
   (`server/services/stability/foldx/runner.ts` ~line 92). On 2 vCPU, four queue slots feed one semaphore slot,
   and the wait counts against the 900 s job cap (`foldxSemaphoreWaitMs`).
3. **Auth today**: one shared `APP_API_TOKEN` bearer, optional encrypted `X-Gemini-Session-ID`
   (15 min, holds the user's Gemini key). `authCheck` in `server/middleware.ts`; `PUBLIC_ENDPOINTS` in
   `server/routes/state.ts` (asserted by `server/routes/public-endpoints.test.ts`). The browser
   stores the token in settings and sends it from `src/api/authSession.ts`. There is **no user id anywhere**.
   Rate limiting keys on a session hash or IP (`getClientIp`).
4. **There is no identity layer in front of the app.** Production is Caddy on
   `missense-resolve.duckdns.org`, so the shared bearer token is the only gate on the public internet.
   `README.md` and `doc/DEPLOYMENT_OCI.md` still describe Cloudflare Zero Trust SSO, which is not deployed.
   The app's own accounts are therefore the real access control, not an extra layer.
5. **Queue** (`server/services/infra/biophysical-queue.ts`): table `biophysical_jobs(id, type, data JSON,
   status, result, error, created_at, started_at, completed_at)` in `data/shared_state.sqlite`
   (`:memory:` under test). Jobs are claimed with `ORDER BY created_at ASC LIMIT 1` (~line 254).
   `pushJob(type, data)` enforces a global `maxQueueLength = 50`. `getQueuePosition` exists.
   Recovery: running jobs re-queued on start, reaper expires stale `running` (960 s) and `queued` (1,800 s).
6. **Job payload** (`routes/biophysics/generation.ts`): `wtPdb, mutation, uniprotId, jobDir, options,
   structureProvenance, remoteJobs{...}`. `jobDir` is a **server-local path**. The worker callback in
   `server.ts` runs `generateMutantPdb`, then RaSP and StabilityOracle on the server; the route drives
   DynaMut2/DDMut/ThermoMPNN. **The portable unit is the FoldX core call**, not the whole job.
7. **De-duplication** exists for FoldX (`server/services/infra/foldx-job-registry.ts`, leader/follower by
   cache key). Not for P2Rank. Pre-warm jobs (`prewarm-manager.ts`) enqueue speculative work on nobody's behalf.
8. **Blue/green handover**: a standby process shares the same SQLite file and must not claim work
   (`deployment-control.ts`, `deployment-role.ts`, `paused`). Agent claim endpoints must refuse while paused.
9. **The queue has two backends**: BullMQ when `REDIS_URL` is set, otherwise SQLite. Standby deployments
   already require SQLite. **All new features require the SQLite backend**; with Redis they stay disabled
   and the system behaves as today.
10. FoldX timeout nesting is asserted by `server/tests/foldx-timeout-budget.test.ts`. Do not change it.
11. `src/shared` may not import from outside itself (`scripts/check-boundaries.ts`, rule 3).
12. **Outbound calls all leave from the server, so the team shares one public IP.** What exists today:
    `fetchWithRetry` (retry with jitter, `Retry-After` support, a policy-refusal rule that does not retry a fast
    429), a **per-host semaphore of 5** and a **per-host circuit breaker** (5 failures, 60 s cooldown) in
    `server/services/infra/http-client.ts`; a 2-tier cache with single-flight (`getCachedOrFetch`, L1 LRU plus
    the SQLite `external_cache` table, `cache.ts` and `cache-registry.ts`). 29 server files call
    `fetchWithRetry`; about 26 more call raw `fetch` (inventory in WP-I). None of it knows which user a
    request is for, so one user's batch consumes the team's allowance. Per-user credentials already travel
    from the browser settings as `x-biohub-token` and `x-hf-token` (`src/api/authSession.ts`), with the
    server env `BIOHUB_API_TOKEN` as a shared fallback (`routes/structure.ts`).

---

## 4. Accounts (decision 1)

Small and boring on purpose. No new dependencies (`node:crypto`, `node:sqlite`; JWT verification uses
`crypto.verify` with the JWKS key, so no JWT library is needed).

### 4.0 Identity: one account table, the app's own login first

**Where this runs.** Production is Caddy at `https://missense-resolve.duckdns.org` (`Caddyfile`,
`deploy/docker-compose.oci.yml`) with no identity provider in front. Today the **only** gate on the public
internet is the shared `APP_API_TOKEN`. `README.md` and `doc/DEPLOYMENT_OCI.md` describe Cloudflare Zero
Trust SSO; the owner confirmed that is not what is deployed, so **WP-H must correct those documents**.
The `cloudflared` service in the compose file is not the live front end.

`AUTH_PROVIDER=password | cloudflare-access`, default **`password`**, which is the production path.

**`password` (built first, primary).** Invite-only login with server-side sessions, as in 4.1 to 4.3.
Because the app is directly exposed to the internet, the login must be hard to attack and easy to use:
- Throttling and constant-time failure responses (4.3), `Secure` and `HttpOnly` cookies over the existing Caddy TLS.
- **Easy for non-technical users:** sessions last 14 days with a 24-hour idle window, so people are not
  repeatedly re-entering a password; the login page says which email to use and who to ask when it fails.
- **No email service, so recovery is by the admin:** "Reset password" in the admin page prints a one-time
  link (expires in 24 h, single use) that the admin hands over. The invite link works the same way.
- **The owner is the admin and creates everyone else from the admin page** (create user, copy invite link,
  reset password, disable). Only the very first admin needs bootstrapping, and it needs no terminal: while the
  `users` table is empty, `/setup` shows a one-time form that asks for `ADMIN_SETUP_SECRET` (a value the
  owner puts in `.env`, which is already how `APP_API_TOKEN` is set), the owner's email, name and password.
  After the first admin exists, `/setup` returns 404 permanently. `npm run user:create` remains as a
  fallback for developers.

**`cloudflare-access` (optional provider, WP-A2, not required for the first release).** Only useful if the
deployment is later put behind Cloudflare Access. Design kept so it can be added without touching anything else:
verify the signed `Cf-Access-Jwt-Assertion` (RS256 against the team keys, check `aud`, `iss`, `exp`; never
trust the plain email header), map the verified email to a pre-approved `users` row, and treat unapproved
emails as `anonymous` for compute. Agents would then need a bypass for `/api/v1/agent/*` in Cloudflare.
Startup fails closed if its two settings are missing.

**Agents (production path today).** Agents call `https://missense-resolve.duckdns.org/api/v1/agent/*`
directly over the same Caddy TLS, authenticated only by their per-agent token (4.1). No edge exception is
needed. `Caddyfile` already blocks `/internal/*`; the agent routes are intentionally reachable.

`resolvePrincipal` is provider-shaped: it asks the configured provider for a `{userId}` and the rest of
the system (queue, quotas, agents, UI) never knows which provider answered.

### 4.1 Data model (new file `data/accounts.sqlite`, env `ACCOUNTS_DB_PATH`, `:memory:` under test)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                 -- uuid
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,                             -- "scrypt$N$r$p$saltB64$hashB64"; NULL under cloudflare-access
  role          TEXT NOT NULL CHECK (role IN ('admin','member')),
  status        TEXT NOT NULL CHECK (status IN ('active','disabled')) DEFAULT 'active',
  share_results INTEGER NOT NULL DEFAULT 1,       -- decision 5 opt-out
  placement_pref TEXT NOT NULL DEFAULT 'auto' CHECK (placement_pref IN ('auto','my_machine','server_only')),
  quota_json    TEXT,                             -- per-user overrides of section 4.4, NULL = defaults
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,                    -- sha256 of the invite token
  email      TEXT NOT NULL COLLATE NOCASE,
  role       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,                    -- 72 h [proposed]
  used_at    INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,                    -- sha256 of the cookie value
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,                    -- 14 d absolute, 24 h idle [proposed]
  last_seen  INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);
CREATE TABLE agent_tokens (                       -- used in section 8, created here so the schema ships once
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,                     -- "Huthaifa's desktop"
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);
CREATE TABLE login_attempts (                     -- throttling
  key TEXT PRIMARY KEY,                           -- "ip:<ip>" or "email:<lowercased>"
  count INTEGER NOT NULL, first_at INTEGER NOT NULL, locked_until INTEGER
);
```

### 4.2 Principals

`resolvePrincipal(req)` returns one of:

| kind | How established | May queue heavy work |
|---|---|---|
| `user` | session cookie `mse_session` (password provider); a verified Cloudflare Access JWT if that optional provider is ever enabled | yes, subject to the limits in 4.4 |
| `service` | legacy `Authorization: Bearer APP_API_TOKEN` | only in `AUTH_MODE=legacy|hybrid`, owner `service`, minimal quota |
| `agent` | `Authorization: Bearer <agent token>` on `/api/v1/agent/*` only | only claims its owner's jobs |
| `anonymous` | nothing | no |

`AUTH_MODE` env: `legacy` (today's behaviour, default until cut-over) | `hybrid` (accounts and the
legacy token both work) | `accounts` (heavy endpoints need a user; legacy token limited to read-only
and health). Cut-over order: `legacy` -> `hybrid` -> `accounts`.

### 4.3 Behaviour and security rules

- **Password provider (primary):** `crypto.scrypt` with a per-user random salt, parameters stored in the hash string,
  `crypto.timingSafeEqual`, minimum length 12. Session cookie: random 32 bytes, stored hashed, `HttpOnly`,
  `SameSite=Lax`, `Secure` when `CONFIG.server.isProduction`, never in a URL. Login throttling: 5 failures
  per ip and per email in 15 min locks for 15 min, with a constant-time response for unknown emails.
- **Cloudflare provider (optional, WP-A2):** JWT checks as in 4.0; JWKS cached with a size and age bound; a
  failed verification is `anonymous`, never an error page that reveals why.
- CSRF for cookie-authenticated state changes: `application/json` (already enforced by `validateContentType`)
  **and** an `Origin` matching `ALLOWED_ORIGINS` (which already lists the DuckDNS host).
- No sign-up. Users are created by an admin, who gets an invite link (and, for a forgotten password, a
  one-time reset link) to hand over. No email service.
- Disabling a user revokes their sessions and agent tokens, and cancels their queued jobs.
- Audit: login, logout, failed login, invite, disable, agent pair/revoke through the existing
  `AuditLogger` (`server/utils.ts`).
- The Gemini session (`X-Gemini-Session-ID`) is **unchanged and unrelated**: it carries the user's
  Gemini key, not identity. Do not merge the two.
- Optional later (WP-A2): accept a verified Cloudflare Access identity as another way to establish a
  `user`. Not needed for the current deployment; keep `resolvePrincipal` provider-shaped so it fits.

### 4.4 Limits: protect the host, do not ration a small team

A hard daily compute budget is the wrong tool for a handful of researchers: it blocks a legitimate
Friday-afternoon batch while the server sits idle. The design is **work-conserving fairness** plus a few
safety limits [proposed defaults, env-overridable, per-user overrides in `quota_json`]:

| Mechanism | Behaviour |
|---|---|
| **Fair share (scheduler, WP-B)** | When nobody else is waiting, a user may use **every** free slot. When others are waiting, slots are shared round-robin, and a user over their share simply waits behind the others. No one is ever refused for using idle capacity. |
| Queued jobs per user | 25 **while others are waiting too** (a share); alone, up to the host backstop less a 5-job reserve for newcomers (as shipped, see 0.3). Stops a runaway script or a client bug from filling the queue for others. Message says how many are queued and why. An admin override is a fixed limit. |
| Memory admission (WP-D) | Refuses or defers a job that would not fit the host's RAM, with the reason. This protects the host, not the budget. |
| Requests per user per minute | 20 at the HTTP layer, same purpose. |
| **Usage display, not enforcement** | Each user and the admin can see server seconds used (today, week). Informational. |
| Daily compute cap | **Off by default** (`QUOTA_SERVER_SECONDS_PER_DAY` unset). Exists so the admin can set it for one user if there is real abuse. |

Agent compute is never counted against the server.

### 4.5 Bootstrap and admin

- `npm run user:create -- --email a@b.org --name "A" --role admin` prompts for the password (or reads
  `USER_PASSWORD`). `npm run user:reset -- --email ...` resets one. Script: `scripts/user-admin.ts`.
- Admin API (role `admin`): create invite, list users, disable/enable, change role, set quota, revoke a
  user's sessions and agent tokens, list the queue across users, cancel any job.

### 4.6 HTTP surface (all under `/api/v1`)

`/auth/login`, `/auth/logout`, `/auth/accept-invite`, `/auth/change-password` and
`/auth/reset` (one-time reset link) exist **only when `AUTH_PROVIDER=password`**, which is production.
`/auth/me`, `/me/preferences` and the admin routes exist for every provider. With the optional Cloudflare
provider, `GET /auth/me` would return `401` with `{reason:"not_approved"}` for a verified identity whose
email an admin has not added.

```
POST /auth/login            {email,password}            -> 200 {user} + Set-Cookie | 401 | 429
POST /auth/logout                                        -> 204
GET  /auth/me                                            -> 200 {user,quota,usage} | 401
POST /auth/accept-invite    {token,password,displayName}-> 201 {user} + Set-Cookie
POST /auth/change-password  {current,next}              -> 204
GET  /me/preferences   PUT /me/preferences  {sharing, placementPref}
POST /admin/invites         {email,role}                -> 201 {inviteUrl}   (admin)
GET  /admin/users                                        -> 200 [...]         (admin)
PATCH /admin/users/:id      {status?,role?,quota?}       (admin)
```
`/auth/login`, `/auth/accept-invite`, `/auth/reset` and `/setup` (404 once a user exists) are added to
`PUBLIC_ENDPOINTS`; update `public-endpoints.test.ts` in the same change. The agent routes under
`/agent/*` are authenticated by agent token, not by `PUBLIC_ENDPOINTS`.

---

## 5. The decision engine

A **pure function in `src/shared/computeRouting.ts`** (so the UI can preview an estimate, matching
`foldingLimits.ts`; no imports from outside `src/shared`).

### 5.1 Types

```ts
export type JobType = "foldx" | "p2rank";

export interface JobFeatures {
  type: JobType;
  residues: number;            // of the structure actually used. NEVER a scan-window length.
  chains: number;
  numberOfRuns: number;        // 5 for BuildModel
  repair: boolean;             // residues <= FOLDX_REPAIR_MAX_RESIDUES (400)
  ownerId: string;
  requires: { tool: "foldx" | "p2rank"; minVersion?: string }[];
}

export interface HostFeatures {
  id: string;                  // "server" | "agent:<id>"
  kind: "server" | "agent";
  ownerId: string | null;      // null for the server
  online: boolean;
  arch: "x64" | "arm64"; emulated: boolean; os: "linux" | "win32" | "darwin";
  cores: number; totalRamBytes: number; freeRamBytes: number;
  tools: { name: string; version: string; verified: boolean }[];
  runningCostMs: number;       // sum of predicted remaining time of its running jobs
  queuedCostMs: number;
  linkRttMs: number | null;    // agents only
  leaseLossRate: number;       // 0..1 over the last 20 claims, agents only
  minFreeBytes: number;        // the floor the server already enforces (500 MB)
}

export interface Prediction {
  wallMs: { p50: number; p90: number };
  peakRamBytes: { p50: number; p90: number } | null;   // null until measured
  basis: "measured" | "prior";
  samples: number;
}

export interface Decision {
  placement: { kind: "server" } | { kind: "agent"; agentId: string } | { kind: "reject" };
  prediction: Prediction | null;
  reasons: string[];                               // reader-facing, plain sentences
  rejected: { hostId: string; because: string }[];
}

export interface RoutingPolicy {
  placementPref: "auto" | "my_machine" | "server_only";
  nearTieMarginMs: number;                         // 20% of the best p50 [proposed] (shipped as nearTieFraction, see 0.3)
  ramHeadroom: number;                             // 1.25 [proposed]
}

export function decidePlacement(
  job: JobFeatures, hosts: HostFeatures[], policy: RoutingPolicy, models: CostModels
): Decision;
```

`CostModels` is a read-only snapshot the server builds from telemetry (5.3) and hands in, keeping the
function pure and testable.

### 5.2 Evaluation order

1. **Hard filters** (record `because` for each removed host): host online; every `requires` tool present
   and `verified`; `residues` not above that host class's learned ceiling; when memory is known,
   `p90 peakRam x ramHeadroom <= freeRam - minFreeBytes`; job is owned by the same user as an agent host;
   `placementPref` allows the host kind.
2. **Predict** per remaining host. If the host class has at least `N = 8` completed samples for the
   job type, use the fitted curve. Otherwise use the priors in 2.3 and set `basis: "prior"`, with
   `p90 = 2 x p50`. P2Rank has no prior except its timeout, so it is reported as a prior with
   `p50 = null`-equivalent unknown and the engine falls back to "fewer running jobs wins".
   **Memory has no prior.** Until Phase 0 has data, `peakRamBytes` is `null` and admission uses the
   conservative rule: one heavy job per host, and refuse above (largest completed residue count x 1.25).
3. **Rank** by expected completion `queuedCostMs + runningCostMs + p50 + linkRtt-based transfer + reliability penalty`
   where penalty = `leaseLossRate x p50`. Near-ties (within `nearTieMarginMs`) go to: the owner's agent
   when `placementPref = "my_machine"`, otherwise the server.
4. **Emit** `Decision`. If nothing is feasible: `placement: reject` and a reason naming the closest miss,
   for example "needs about X GB; the largest free host has Y GB". Never a bare failure.

### 5.3 Telemetry and learning (server side, `server/services/infra/compute-telemetry.ts`)

```sql
-- in data/shared_state.sqlite, beside biophysical_jobs
CREATE TABLE job_telemetry (
  job_id TEXT PRIMARY KEY, type TEXT NOT NULL, host_id TEXT NOT NULL,
  host_class TEXT NOT NULL,        -- e.g. "arm64-emulated-2c-12g", "x64-native-8c-16g"
  residues INTEGER NOT NULL, chains INTEGER, runs INTEGER, repaired INTEGER,
  wall_ms INTEGER, peak_rss_bytes INTEGER,
  outcome TEXT NOT NULL,           -- completed | oom | timeout | failed | cancelled
  error_class TEXT, tool_version TEXT, created_at INTEGER NOT NULL
);
```
- Peak RSS: sample the child process tree (FoldX, Java) at 1 s intervals (`process-sampler.ts`). The sidecar
  is not a `JobType` and has no telemetry row, so its own RSS is **not** sampled — deferred, not done.
  `host_class` is derived from `arch`, `emulated`, `cores`, total RAM bucket.
- Fit: per (type, host_class), log-log regression of `wall_ms` and `peak_rss_bytes` on `residues`, with
  empirical p90 residual. Refit every 10 new samples, not per request. Plain and explainable, no black box.
- Ceiling: the enforced rule is the **second-smallest** out-of-memory size — two deaths at or below a size, not
  two at the same size — so a single misclassified failure cannot refuse a class forever. Deaths older than
  30 days are forgotten and an admin can clear the rest (`DELETE /admin/compute/ceilings`).

### 5.4 Shadow mode first

`COMPUTE_ROUTING=off|shadow|on`. In `shadow` the engine runs, logs its Decision beside what actually
happened, and changes nothing. Ship `shadow` before `on`, and compare before switching.

---

## 6. Variables the engine consumes (reference list)

Job: type, residues (structure used), chains, runs, repair flag, owner, required tools and versions.
Host: arch, emulation, os, cores, total and free RAM, tool inventory with verified flag, running and
queued cost, link RTT, lease-loss rate, online, last seen, minimum free floor.
Learned: wall time and peak RSS curves per host class, size ceilings, failure classes.
Policy: placement preference, sharing opt-out, quotas, headroom factor, tie margin, `N` samples.

---

## 7. Work packages

Conventions for every package:
- Read `server/routes/index.ts` and one existing route file first, and follow the
  `registerXRoutes(apiRouter, jsonParserRegular)` pattern.
- Tests are Vitest: `npx vitest run <file>`. Before finishing: `npm run lint` and the touched test files.
  `npm run verify` is the full gate (lint, deployment tests, coverage, geometry, build) and CI runs the same set.
- SQLite via `node:sqlite` (`DatabaseSync`), WAL, `busy_timeout = 5000`, `CREATE TABLE IF NOT EXISTS`, and
  additive `ALTER TABLE ... ADD COLUMN` inside try/catch, as `analysis-db-core.ts` does. Never a destructive migration.
- Under `NODE_ENV=test` use `:memory:`; never touch the developer's `data/`.
- **Do not commit** unless the user asks. Do not edit files owned by another package (file ownership below).
- The shared files `server/middleware.ts`, `server/routes/state.ts`, `server/routes/index.ts`,
  `server/config.ts` are touched by several packages: make **small additive edits**, and rebase on others' changes.

### Dependency map

```
WP-0 measure ──────────────┐
WP-A accounts ─► WP-B queue ownership/fairness ─► WP-D admission ─► WP-G live routing
                    │                                  ▲
                    └─► WP-E cache/dedupe ─► WP-F agent protocol ─► WP-G
WP-C engine (pure) ───────────┘ (needs WP-0 data only for priors; can start now)
WP-H docs/ops (any time after WP-A)
WP-I outbound governor: I2 cache audit and I3 team-wide 429 pause can start now;
     I1 fair-share limiter and I4 per-user credentials need WP-A (user identity).
```
Parallel lanes that do not collide on files: **WP-0, WP-A, WP-C** can start together, and **WP-I2 and WP-I3**
too (they touch the outbound layer, not the queue or accounts). After WP-A and
WP-B, **WP-D, WP-E** can run together. **WP-F** needs WP-A, WP-B and the WP-C types.

---

### WP-0  Measure (prerequisite for honest memory numbers)

Goal: peak RAM and wall time for FoldX and P2Rank at three or more residue sizes on the Oracle host and
one native x64 machine; a host capability probe.

Create
- `server/services/infra/host-probe.ts`: `probeHost(): HostFeatures-like` (cores, RAM, arch, emulated via
  the existing Box64 check in `routes/capabilities.ts`, os, tool presence and versions, a `verified`
  self-test per tool). Reuse the logic in `routes/capabilities.ts`; extract it, do not copy.
- `server/services/infra/process-sampler.ts`: samples RSS of a process tree at 1 s (Windows: `wmic`/
  PowerShell fallback; Linux: `/proc/<pid>/status`, summing children).
- `scripts/compute-benchmark.ts` + `npm run compute:benchmark`: runs FoldX and P2Rank on a fixed set
  (SOD1 154 aa, a ~489 aa, SLC12A4 1,085 aa) and writes `doc/COMPUTE_BENCHMARK.md` plus JSON. Model it on
  `scripts/foldx-timing.ts`.
- `compute-telemetry.ts` with the `job_telemetry` table (5.3) and a `record()` called from the worker
  callback in `server.ts` (wrap the existing call; do not change its behaviour).

Acceptance
- Benchmark runs on this machine and writes numbers. The doc states the host class and the date.
- Unit tests for the sampler (a spawned child that allocates a known amount) and the probe (mocked OS values).
- Telemetry rows are written for a completed and a failed job in an integration test.

Out of scope: any routing change.

**Done (2026-10-11, `feat/wp0-measure`).** Where it differs from the list above (the code is the source of truth):
- **Memory.** `process-sampler.ts` sums a process TREE (P2Rank is a script that starts Java; FoldX on the server
  runs under Box64): Linux reads `/proc/<pid>/status` and uses the kernel's own high-water mark `VmHWM`, so a
  spike between samples is not missed; macOS uses one `ps`; Windows uses PowerShell CIM (`wmic` no longer
  exists) every 2 s. The queue runs each job inside `runInJobMeter` (AsyncLocalStorage) and the two runners call
  `meterChildProcess(child)`, so no worker signature changed. `peak_rss_bytes` is written for every ending that has
  a meter — the in-process timeout and an out-of-memory death included; the ONE exception is a lease-expiry reap of
  a job orphaned by another process, which has no meter and writes null. The engine uses the memory fit once a class
  has 8 MEASURED peaks (cache hits do not count), and even then keeps the size guard; free memory honours the
  container's limit (`process.availableMemory`), and a container reading of 0 is taken as 0, not the host's number.
- **Self-tests, versions.** `host-probe.ts` runs each tool the way its runner does: FoldX with no command (it prints
  its banner and ends with "Foldx will end" and exit code -1, which is its normal ending), P2Rank `-v` with the
  runner's Java. Missing = cannot start; unverified = starts but fails; a self-test that only times out keeps the
  tool usable (a busy host proves nothing). Versions go to telemetry (`tool_version`) and to `computeProvenance`.
  A clean probe is kept for the process; it runs in the background at start-up and logs one `[host-probe]` line.
  A bare `foldx` on PATH that cannot start is now missing, where before it was assumed present.
- **FoldX licence date.** Academic builds are named for the day they stop working (`foldx_20261231`). The probe
  reads that date, warns from 45 days before, and after the day has passed marks FoldX **failed** (so `on` refuses
  its jobs); a binary whose name carries no date is reported as having no possible warning. **The Linux build in
  `tools/foldx_linux` stops working on 2026-12-31.**
- **Benchmark.** `npm run compute:benchmark` (bundled as `dist/compute-benchmark.cjs` for the container) measures
  SOD1 154, GCK 465 (the ~489 slot) and SLC12A4 1,085 AlphaFold models, mutation in the middle of chain A;
  RepairPDB where production repairs (<= 400 residues, or `--repair-all`). One JSON per host class in
  `doc/compute-benchmark/`, rendered into `doc/COMPUTE_BENCHMARK.md` against the engine's CURRENT prior.
  `scripts/lib/foldx-job.ts` is the job layout shared with `foldx-timing.ts`.
- **Prior corrected.** RepairPDB is now ONE measured curve, `49 s x (residues/154)^2.1`, through two **native**
  points (49 s at 154 from the benchmark; 205.4 s at 305 from `foldx/cache.ts`, whose BuildModel column is native).
  The old prior divided a 205 s anchor by the ~60x BuildModel factor and predicted 0.6 s at 154 — ~76x too fast.
  The emulated server's repair prior reuses that curve times the same-size emulation penalty (never faster than
  native); the server benchmark replaces it. The native BuildModel line (5.4 s predicted, 17 s measured at 1,085
  residues, one run) waits for more data; telemetry replaces it after 8 jobs.

**Review 3, 2026-10-11 (post-merge of #110).** Five reviewers (GPT-5.6-Sol, Claude, DeepSeek V4.1 Flash) across four
dimensions. The follow-ups landed on `fix/wp0-review-followups`: the `compute:benchmark -- <flags>` wrapper was fixed
(it passed flags straight to `node -e`, which rejected them, so every documented invocation failed); RepairPDB became
one native curve (above); an fpocket `fallback` is no longer stamped or recorded as P2Rank; the reaper writes a
lease-expiry's peak; the memory fit needs MEASURED peaks and keeps the size guard; `freeRamBytes()` treats a zero
container reading as zero; the FoldX licence date is authoritative; the submit path no longer waits on a self-test
(stale tools are served and refreshed in the background); the tool timeout kills the whole process tree;
`peak_rss_bytes` uses a high-water mark on Windows too; and the self-test mirrors the runner's batch invocation.
Test gaps the review named that are still open: a test that the two runners actually CALL `meterChildProcess`
(so deleting it fails the suite), a `measure()` test for the benchmark, and the joining-job peak above.

---

### WP-A  Accounts

Files (new): `server/auth/{password,sessions,principal,middleware,store}.ts`,
`server/auth/providers/password.ts`, `server/routes/auth.ts`, `server/routes/admin.ts`,
`scripts/user-admin.ts`, tests beside each. Build order inside the package: store and `resolvePrincipal`
with the provider interface, then the **password provider (production path)**, then routes, then client.
**WP-A2 (optional, later, separate agent):** `server/auth/providers/cloudflare-access.ts` with the JWT
verifier and JWKS cache, only if the deployment is ever put behind Cloudflare Access.
Files (additive edits): `server/middleware.ts` (`authCheck`, `getClientIp`), `server/routes/state.ts`
(`PUBLIC_ENDPOINTS`), `server/routes/index.ts` (register), `server/config.ts` (`AUTH_MODE`, quotas),
`package.json` (`user:create`, `user:reset`).
Client: login screen, account menu, admin page, "my preferences", and stop requiring `appApiToken` for
cookie sessions in `src/api/authSession.ts` (keep the token path for `legacy|hybrid`). Locate the settings
UI in `src/components/settings/sections/ConnectionsSection.tsx`.

Behaviour: sections 4.1 to 4.6.

Acceptance
- **Password provider:** invite -> accept -> login -> `/auth/me` -> logout round trip; a disabled user's
  cookie stops working on the next request; brute-force throttling works and unknown emails are
  indistinguishable from wrong passwords; a reset link works once, expires after 24 h, and invalidates the
  user's other sessions.
- First admin through `/setup`: works only while `users` is empty and only with the correct
  `ADMIN_SETUP_SECRET`; a wrong secret is throttled; after success `/setup` is 404 and cannot be reused;
  the created user is `admin`. The admin can then create, disable and reset other users from the admin
  page. `npm run user:create` also works inside the production container.
- A request through Caddy with a forged `X-Forwarded-For` cannot reset or bypass the login throttle
  (`trust proxy` is 1 in `server/express-config.ts`; test the keying used by the throttle).
- `/api/v1/agent/*` accepts only agent tokens; a user session cookie is neither required nor sufficient there.
- **WP-A2 acceptance (only if built)**: tests use a locally generated RSA key and a fake JWKS endpoint, no
  network; wrong `aud`, wrong `iss`, expired, bad signature, unknown `kid` and a missing header are each
  `anonymous`; a forged email header with no JWT grants nothing; JWKS is cached and an unknown `kid`
  triggers one refresh, not one per request.
- In `AUTH_MODE=accounts`, an anonymous or legacy-token request to a heavy endpoint
  (`/biophysics/*`, `/structure` fold routes) returns 401; reads and health still work.
- `public-endpoints.test.ts` updated and green. No new npm dependency. No password or token is ever logged
  (extend the redaction pattern in `requestLogger` if needed).
- Existing suite stays green in `AUTH_MODE=legacy` (the default).

Risks: the shared-token flow in `src/api/authSession.ts` is long and has retry paths; change it
minimally and keep its tests (`src/apiClient.test.ts`) green.

---

### WP-B  Queue ownership, fair scheduling, visibility

Depends on WP-A (`req.principal`).

Files: `server/services/infra/biophysical-queue.ts` (SQLite backend only), its tests
(`biophysical-queue.test.ts`, `biophysical-handover.test.ts`), `server/routes/biophysics/{generation,pocket,polling}.ts`,
`server/services/infra/prewarm-manager.ts`.

Changes
1. Additive columns on `biophysical_jobs`: `owner_id TEXT`, `priority INTEGER DEFAULT 0`,
   `cost_estimate_ms INTEGER`, `placement TEXT`, `lease_expires_at INTEGER`, `claimed_by TEXT`.
   Old rows: `owner_id = 'legacy'`. New table `job_watchers(job_id, user_id, PRIMARY KEY(job_id,user_id))`.
2. `pushJob(type, data, { ownerId, priority, costEstimateMs })`. Callers pass `req.principal.userId`.
   Pre-warm jobs use owner `system`, priority lower than any user job.
3. **Fair claim, work-conserving.** Replace the `ORDER BY created_at ASC LIMIT 1` query with: among queued
   jobs, pick the owner with the fewest currently running jobs (ties: the owner whose oldest queued job is
   oldest), then that owner's oldest job; `priority` first, then fairness. **Work-conserving means a free slot
   is never left idle:** if only one user has queued jobs, they get every slot. There is no per-user cap on
   running jobs; the rotation alone shares slots when several users are waiting. Must stay a single indexed
   query. Add `CREATE INDEX IF NOT EXISTS idx_jobs_owner_status ON biophysical_jobs(owner_id, status, created_at)`.
4. Replace the global `maxQueueLength = 50` with the per-user queued limit (4.4, default 25) plus the global
   limit as a backstop. There is no daily compute budget unless `QUOTA_SERVER_SECONDS_PER_DAY` is set.
5. `getQueuePosition(id)` must follow the new order, not `created_at`. Add `getEta(id)` from the
   cost estimates. Return both from the polling route.
6. New endpoints: `GET /biophysics/my-jobs`, `POST /biophysics/jobs/:id/cancel` (owner or admin).
   Cancel respects watchers: if other users joined the job (WP-E), cancelling removes only the caller's
   watch; the job is aborted only when no watcher remains.
7. Unify concurrency: one **admission budget** (running cost, not job count). Keep
   `BIOPHYSICAL_CONCURRENCY` as the upper bound; make the FoldX semaphore size derive from it instead of
   `cpus - 1`, so the two cannot disagree. Keep `foldx-timeout-budget.test.ts` green.
8. Redis backend: leave unchanged and document that ownership is ignored there.

Acceptance
- Test: user X enqueues 30 jobs, user Y then enqueues 1; Y's job starts before X's 3rd.
- Test (work-conserving): X is the only user with queued jobs and all slots are free; X occupies every slot,
  and no slot stays idle while X has queued work.
- Test: legacy rows (no owner) still run; queue recovery and handover tests unchanged and green.
- Test: cancel by a non-owner is 403; cancel with a second watcher does not abort.
- Position shown to a user matches the order the scheduler actually consumes.

---

### WP-C  Decision engine (pure) and cost models

No dependency except types. Start now.

Files: `src/shared/computeRouting.ts` (5.1, 5.2), `src/shared/__tests__/computeRouting.test.ts`;
`server/services/infra/cost-models.ts` (fit from `job_telemetry`, 5.3) with tests.

Acceptance
- Golden tests from section 2.3: 154-residue native -> ~2-3 s prior; 1,085-residue emulated -> ~167 s prior
  with `basis: "prior"`; 400/401-residue boundary changes `repair`.
- Hard-filter tests: tool missing, unverified tool, RAM too small, other user's agent, `server_only`.
- Reject test returns a reason naming the closest miss.
- Near-tie tests for `auto` and `my_machine`.
- Same input -> same Decision (pure, no clock, no randomness).
- `npm run lint` passes, including the boundary rule (no imports outside `src/shared`).

---

### WP-D  Admission control and OOM classification (server only)

Depends on WP-B, WP-C. Runs the engine with `hosts = [server]` in `shadow` and then `on`.

Files: `server/services/infra/admission.ts` (new), `server.ts` worker callback, `routes/biophysics/generation.ts`,
`pocket.ts`, `foldx/runner.ts` (error classification only).

Changes
- Before enqueue, call `decidePlacement`; `reject` becomes HTTP 422 with the engine's reasons (a new
  error code beside the existing ones; follow `sendError` in `server/utils`).
- The scheduler claims a job only if the running cost plus its predicted cost fits the budget.
- Classify exits: SIGKILL, Java `OutOfMemoryError`, Node heap exhaustion -> `error_class = oom`, then
  record the ceiling. Surface "this structure did not fit in memory on the server" instead of a timeout.

Acceptance
- A synthetic job larger than the learned ceiling is rejected with reasons before it starts.
- A killed child marks the ceiling and the next larger job is rejected, not retried.
- `foldx-timeout-budget.test.ts` unchanged and green.

---

### WP-E  Shared cache and de-duplication

Depends on WP-A, WP-B.

Files: `server/services/infra/foldx-job-registry.ts`, `cache-keys.ts`, `server/services/pocket.ts` (P2Rank path),
tests.

Changes
- Cache key `(structure hash, mutation, tool name, tool version)`; the structure hash must cover the
  coordinates actually used (`effectiveWtPdb`), not the UniProt id.
- Extend the leader/follower registry to P2Rank; add each follower to `job_watchers`.
- Store provenance with every result: `computedOn: "server" | "agent"`, `hostClass`, `toolVersion`,
  `ownerId`. Results are research-use outputs; keep any existing licence/provenance wording.
- Agent results enter the shared cache only when `validateAgentResult` passes (WP-F) **and** the owner's
  `share_results = 1` (default). Otherwise the result is returned to that user only.

Acceptance: two users requesting the same job run it once; both receive it; cancelling by one leaves the
other's job running; an opted-out user's agent result is not served to anyone else.

---

### WP-F  Agent: protocol and runtime

Depends on WP-A, WP-B, WP-C types, WP-E validation. This is the largest package; split it as F1 (server) and F2 (agent) if two agents are available.

#### F1 Server side: `server/routes/agent.ts`, `server/services/infra/agent-registry.ts`

All under `/api/v1/agent`, bearer = agent token (4.1), refused with 503 when the process is `paused` (standby).

```
POST /agent/pair           (user session)  {name}                -> 201 {agentId, token, once:true}
POST /agent/register       {hostProbe, agentVersion}             -> 200 {agentId, pollSec, leaseSec}
POST /agent/claim          {freeRamBytes, supports:["foldx","p2rank"], waitSec<=25}
                           -> 200 {job:{id,type,payload,leaseExpiresAt,deadlineMs}} | 204
POST /agent/jobs/:id/heartbeat {phase?, rssBytes?}               -> 200 {leaseExpiresAt} | 410 (lease lost)
POST /agent/jobs/:id/result    {result, wallMs, peakRssBytes, toolVersion, toolHash} -> 200 | 409
POST /agent/jobs/:id/fail      {errorClass, message, wallMs?, peakRssBytes?}         -> 200
DELETE /agent/self         (revoke)
GET  /agent/tools/foldx?platform=win32|linux|darwin   (agent token) -> 200 bundle stream + X-Bundle-Sha256 + ETag | 404 when none | 304
POST /admin/tools/foldx    (admin, multipart: platform, file, licenceConfirmed=true) -> 201 {version, sha256}
DELETE /admin/tools/foldx  (admin; revoke)           -> 204   // bumps foldxBundleVersion, agents wipe their copy
GET  /admin/tools/foldx                              -> 200 {platforms:[{platform,version,sha256,uploadedBy,uploadedAt,licenceConfirmedAt}]}
```
- Claim is a **long poll** (<= 25 s) so agents work behind NAT with outbound HTTPS only.
- Claim selects only jobs where `owner_id = agent.user_id` and `placement IN (NULL,'agent:<id>')`,
  runs the engine's hard filters against the probe, and marks `claimed_by`, `lease_expires_at = now + leaseSec`.
- Default `leaseSec = 60`, heartbeat every 20 s [proposed]. The existing reaper re-queues expired leases
  and clears `placement`, so the engine decides again (usually the server).
- `payload` for FoldX is `{wtPdb, mutation, uniprotId, options}`. **`jobDir` is not sent**; the agent
  creates its own scratch directory. For P2Rank `{pdbText, mutIndex, targetChain}`.
- `register`, `claim` and `heartbeat` responses include `foldxBundleVersion` (null when none). The agent
  acts on a change at once: download and install, or wipe on null.
- The bundle endpoint requires the agent token, is rate limited, streams from disk with no path derived from
  user input (platform is checked against an allowlist), and is never reachable without auth.
- Idempotency: a result for a job whose lease was lost or already completed returns 409 and is discarded.
- `validateAgentResult` (server): schema (zod), `ddG` finite and within sane bounds, PDB parses, the
  mutation in the result matches the request, `toolVersion` equals one the server accepts. Failure marks the
  job `failed` with `error_class = invalid_result`, and the job is re-queued once to the server.
- Rate limit agent endpoints separately from `apiLimiter` (long polls must not trip it).

#### F2 Agent runtime: `server/agent/main.ts`, `npm run agent`, `npm run build:agent`

- **Built for people who never open a terminal** (decision 7). Distribution is a zip the admin builds with
  `npm run build:agent-bundle` containing: the bundled agent, a **portable Node runtime** (so Node need not
  be installed; Node is open source and redistributable), `Start Agent.cmd` (Windows) / `start-agent.command`
  (macOS) / `start-agent.sh` (Linux), and a short `README.txt` with three screenshots. The user double-clicks
  one file. Nothing is installed system-wide; everything lives in one folder the agent manages
  (`%LOCALAPPDATA%\MissenseAgent` on Windows, `~/.missense-agent` elsewhere).
- **Guided setup page, not a command line.** On first start the agent opens `http://127.0.0.1:<port>/`
  (loopback only, random port, one-time local token in the URL) in the default browser. It is a small
  wizard: (1) "Connect to the workspace": the user clicks **Connect my computer** in the main app, gets a
  six-character pairing code, and types it here; the agent stores the token with `0600` permissions;
  (2) tool check (below); (3) "Ready: lending this computer to your own jobs", with **Pause** and
  **Disconnect** buttons. `npm run agent -- --pair` remains for developers, and `AGENT_SERVER_URL` and
  `AGENT_TOKEN` env vars remain for unattended hosts.
- The main app shows the agent's state in plain language ("Your computer is connected", "FoldX not set up
  on your computer: open the agent page to finish", "Paused"), never a stack trace.
- Loop: probe -> register -> claim -> run -> heartbeat -> result/fail. Calls `generateMutantPdb` and
  `findBindingPocket` directly. **Run only one heavy job at a time.** Respect an `AGENT_MAX_RAM_GB` cap
  and `AGENT_PAUSE` (a file or flag) so a user can stop lending the machine.
- **Tool provisioning, so users cannot misplace binaries.** The agent keeps tools in its own managed
  folder and the user never chooses a path:
  - **Java and P2Rank**: open source, so the agent downloads and unpacks them itself on first run into its
    folder (a portable Temurin JRE and the P2Rank release), verifies a pinned SHA-256, and runs a self-test.
    Zero user action.
  - **FoldX, team-distributed by default** (`AGENT_FOLDX_SOURCE=team`). The admin uploads the licensed bundle
    once (zip per platform: Windows, Linux, macOS if needed) on the admin page. The server stores it **outside
    the web root** (`data/tool-bundles/foldx/<platform>/<version>/`), records its SHA-256, and serves it only
    to authenticated agents. On pairing and at each check-in the agent compares `foldxBundleVersion`; when it
    differs it downloads its own platform's bundle over `GET /api/v1/agent/tools/foldx?platform=...`, verifies
    the hash, unpacks it into its managed folder, and runs the self-test on a tiny bundled PDB. The user sees
    "Setting up FoldX... done" and does nothing. The wizard shows the line "FoldX is provided by your lab for
    research use only" so the terms travel with the tool.
    - **Admin confirmation is recorded.** Uploading requires ticking "I confirm our FoldX licence permits
      sharing it with our team for research use". The tick, who, and when go to the audit log and are shown
      on the admin page.
    - **Revoke / roll back at any time** (one button, "Remove FoldX from the team"): deletes the stored
      bundle, increments `foldxBundleVersion` to a "none" value, and every agent, at its next heartbeat or
      claim (within `AGENT_HEARTBEAT_SEC`), **deletes its local FoldX copy**, stops advertising FoldX, and
      falls to the manual path below. Queued FoldX jobs return to the server. Rolling out a new version is the
      same upload with a new number.
    - **Fallback `guided`** (used when no team bundle exists, after a revoke, or if a user prefers their own
      copy): the wizard shows one box, **"Drop the FoldX zip you downloaded here"** (or *Choose file*). The
      agent finds `foldx*` and the `molecules` parameter folder inside it by pattern, copies them into its
      managed folder, self-tests, and gives plain fixes ("this looks like the Linux build; you need the Windows
      one", "the parameter files are missing"). The user never moves files or edits a path.
  - If a tool is missing or fails its self-test, the agent does **not** advertise it. FoldX jobs then run on
    the server as today, and the user's agent still serves P2Rank. A half-set-up machine degrades, it does not break.
  - Agents never upload tools. Only the admin uploads a bundle, and only through the admin page.
- On job start, report phase through heartbeat so the UI shows the same stepper (`src/shared/foldxPhase.ts`).
- On abort (user pause, lease lost, signal), kill the process tree and remove the scratch directory.
- Never executes anything received from the server other than the two typed job kinds; payload fields are
  validated and used only as data (file contents and arguments), never as command text.

Acceptance
- Integration test with a fake agent: register, claim, heartbeat, result; lease expiry re-queues to the
  server; double-claim race yields exactly one winner; another user's job is never offered.
- Killing the agent mid-job leaves no job stuck: the job completes on the server.
- Standby (`paused`) refuses claims.
- The bundle starts on a clean Windows machine with nothing installed: double-click, pair, and P2Rank
  works without any further step. Test on Windows first (the team's machines), then Linux.
- Setup wizard: dropping a wrong archive (Linux build on Windows, zip without `molecules`, a random zip)
  gives the specific message from the list above and leaves the agent unchanged. Dropping a correct one
  yields a passing self-test and FoldX appears in the advertised tools.
- Team distribution: after an admin upload, a paired agent installs FoldX with no user action and passes the
  self-test; uploading without the licence tick is rejected (400); an unauthenticated or wrong-platform
  request is refused; a corrupted download (hash mismatch) is discarded and retried, never installed.
- Revoke: after the admin removes the bundle, an online agent deletes its local FoldX within one heartbeat and
  stops advertising it; queued FoldX jobs return to the server; the endpoint answers 404 afterwards; an
  offline agent wipes on its next contact before claiming any FoldX job.
- A user whose FoldX is missing or failed still gets P2Rank on their machine and FoldX on the server.
- The loopback setup page refuses requests without its one-time token and from non-loopback addresses.
- No secret appears in agent logs.

---

### WP-G  Live routing and UX

Depends on WP-D and WP-F.

- Build `HostFeatures[]` from `[server, ...owner's online agents]` and run `decidePlacement` with the
  user's `placement_pref`. Set `placement` on the job; the claim paths in WP-B/WP-F honour it.
- Show the decision before and during a run: where it runs, predicted time and RAM with `basis`, and the
  reasons. Reuse `describe...`-style pure functions in `src/shared` for the copy, as `foldingLimits.ts` does.
- UI: queue panel ("My jobs" with position, ETA, cancel), agent pairing and status ("Your machine:
  online, 12 GB free"), preferences (placement, share results).
- Replace the "compute server" wording in `src/shared/foldxPhase.ts` where the job runs on the user's machine.
- Switch `COMPUTE_ROUTING` from `shadow` to `on` only after the shadow log has been reviewed.

Acceptance: end to end, a job from a user with an online agent runs on the agent; with the agent killed it
falls back to the server; a user without an agent is unaffected; another user never sees the first user's agent.

**Where WP-G2 differs** (the code is the source of truth; `server/routes/live-routing.test.ts` is the acceptance):
- **One switch.** Placement is live only with `COMPUTE_ROUTING=on`, the same switch that lets admission refuse.
  In `shadow` the engine already weighs `[server, ...owner's online computers]` and logs the decision
  (`[routing:shadow]`, `actual: "server"`); `on` logs `[routing:on]` with the real placement.
- **Hosts.** The agent routes register `ownerAgentHosts` with the queue (`setAgentHostsProvider`), so the queue
  never imports the accounts database. Only the owner's computers that are online and offer the tool now
  (self-tested, not paused, team FoldX copy current) are hosts; `legacy`/`system` work has none.
- **What is stored.** A computer's placement sets `placement = 'agent:<id>'`; a job the engine keeps on the server
  stays unplaced (NULL), so the owner's computer may still take it from the backlog. Each decision is a
  `RoutingRecord` in the new `routing` column (host, computer name, the engine's prediction and `basis`, its
  reasons, and a note when the job later moved: `released`, `handed_back`, `taken_from_backlog`). A person
  without a computer gets no record: nothing new is shown to them.
- **Load.** A computer's `runningCostMs`/`queuedCostMs` come from the predictions stored with the jobs placed on
  it (`agentLoad`), so a second job sees the first one waiting; the server's `queuedCostMs`, the fairness
  count `othersWaiting`, the daily-cap `pendingEstimateMsFor` and the 50-job host backstop now exclude jobs placed
  on a computer (the per-person waiting limit still counts them: they return to the server if the computer
  goes). A computer claims the jobs placed on it before its owner's older backlog, so position and wait for a
  placed job (`queuedAhead`, `queuedEtaMs`, `etaMs`) count only what is ahead of it on that computer.
- **Fallback.** Housekeeping now runs every 15 s (`releaseStrandedPlacements`) and releases a placed job to the
  server when its computer is offline (90 s window), paused, no longer offers the tool, or has been idle for
  2 min (`PLACEMENT_IDLE_PATIENCE_MS`) without claiming it, measured from the placement and from the computer's
  last claim, so a computer finishing a long job is not robbed of the next. A started job falls back through
  WP-F's hand-back rules. Both are recorded on the job and told to its owner.
- **Joining.** `mayJoin` treats a job WAITING for a computer like one running on it, so a private computer result
  is never handed to someone who joined before the computer claimed it.
- **Shown.** `runsOn` (`src/shared/jobPlacement.ts`, `runsOnFor`) is on the FoldX and pocket submit and poll
  responses and on `/my-jobs`: where, the computer's name, started or not, the prediction with its basis, and
  the reasons. Anyone but the owner (someone who joined, or a poll without an account) reads only where and
  whether it started. A finished job names a computer only if that computer claimed it. The routing log
  writes `agent:<id>`, never a computer's name. The jobs panel shows a host line; the Energetics card names the host
  ("Waiting for your computer (Lab PC) to pick it up") instead of "compute server". There is no pre-submit
  preview (0.4). Predicted RAM is not shown: it is null until a class has 8 measured peaks.
- **Also closed from 0.4:** "Your computers" shows each computer's last 30 days (jobs finished, given back, and
  the median FoldX and pocket time, from its own telemetry, bounded by the server's clock); Settings → Team →
  "Learned memory limits" lists the out-of-memory ceilings (`GET /admin/compute/ceilings`, new) and forgets them;
  `/auth/me` reports `liveRouting`, so "Where your jobs run" describes what the preference really does.

---

### WP-I  Outbound governor: fair share, shared cache, team-wide 429 pause, per-user credentials

Goal: the team shares one server IP and a few shared keys, so remote providers must be called fairly,
rarely, and politely. This package has four parts. I2 and I3 do not need accounts and can start immediately;
I1 and I4 need WP-A. Part 5 (calls from the user's own IP) is **not** built; it is a reserved option (section 12).

Provider inventory the implementing agent must start from (read the code, do not trust this list blindly):

| Provider | Credential today | Limit counted against |
|---|---|---|
| Gemini (`services/gemini.ts`) | user's own key (session) | that key |
| Biohub / Forge: ESM3, ESM-C, Forge ESMFold | `x-biohub-token` per request, else `BIOHUB_API_TOKEN` | that token (shared if fallback) |
| Hugging Face inference: ESM-2, SaProt remote | `x-hf-token` per request | that token |
| JapanFold, AlphaGenome | server key (`JAPANFOLD_API_KEY`, `ALPHAGENOME_API_KEY`) | the server key, shared |
| DynaMut2, DDMut, DDMut-PPI (UQ BioSig) | none | server IP, shared |
| ClinVar (NCBI), gnomAD, UniProt, PDBe, STRING, IntAct, Ensembl VEP, VariantValidator, GTEx, ESM Atlas, SpliceAI (Broad), GPN, Genos | none or server key | server IP, shared |

I1 **Per-provider fair-share limiter** (`server/services/infra/egress-governor.ts`, new)
- A registry `{ providerId, hostnames[], credentialKind: "ip" | "server-key" | "user-key", maxConcurrent,
  ratePerMin?, burst?, limitBasis: "documented" | "observed" | "unmeasured" }`. **Do not invent limits.** The
  implementing agent fills `ratePerMin` only from the provider's published limits, records the source URL in
  the registry, and leaves it unset (`unmeasured`, concurrency only) where nothing is published.
- API: `governor.run(providerId, { userId, credentialId, priority, signal }, fn)`. Admission is
  **work-conserving fair share**, as in WP-B: with one active user they get the full allowance; with several
  waiting, calls rotate between users; speculative pre-warm calls (owner `system`) go last. A waiter's queue
  time counts against its own deadline; if the wait would exceed it, fail fast with a typed error instead of
  waiting uselessly.
- Adaptive rate (only where a rate is set or learned): additive increase after sustained success,
  multiplicative decrease on a 429, so `limitBasis` can move from `unmeasured` to `observed` and the value
  is visible, not hidden. Plain and explainable.
- Hook it at the choke points rather than at 55 call sites: add a `provider` option to `fetchWithRetry`
  (29 files already use it) and migrate the raw `fetch` call sites to it. Raw `fetch` call sites to
  migrate (external only; skip loopback sidecar, health and deployment-control): `external-api/adapters/service-adapters.ts`,
  `stability/energy-models.ts`, `external-api/japanfold-client.ts`, `japanfold.ts`, `llm/literature-rag.ts`,
  `routes/structure.ts`, `structure/esmfold.ts`, `external-api/gpn.ts`, `alphagenome-bridge.ts`,
  `routes/variant/alphagenome.ts`, `stabilityoracle.ts`, `saprot.ts`, `genos_web.ts`, `esmc.ts`,
  `esm3_forge.ts`, `esm2.ts`, `evidence-context/gtex.ts`, `routes/biophysics/stability.ts`.
- Keep the existing per-host semaphore (5) and circuit breaker as backstops. The governor sits above them.
- `EGRESS_GOVERNOR=off|shadow|on` (default `off`). In `shadow` it only records what it would have delayed.
- A ratchet test: a unit test (or a rule in `scripts/check-boundaries.ts`) that lists raw `fetch(` calls to
  non-loopback hosts in `server/services` and `server/routes`; the allowed list may only shrink.

I2 **Shared cache for remote calls** (extend the existing `getCachedOrFetch`; do not build a second cache)
- Audit every remote call in the inventory: is it cached, with what key, what TTL, and does the key contain
  anything user-specific. Output a table in `doc/EGRESS_AUDIT.md`.
- Cache keys must contain **only what determines the answer** (provider, endpoint, model/version, sequence or
  variant, parameters). **Never the user id and never the token.** The answer does not depend on whose token
  asked, so a Biohub or HF result computed with one teammate's token serves the others. Keep provenance (which
  model and version) on the cached value so the UI still labels it correctly.
- Cross-user single-flight (already present for some keys): the same key in flight for two users makes one
  upstream call. Verify it holds for every provider in the inventory, including the remote model routes.
- TTL by data type: stable reference data long (UniProt, PDBe, gnomAD release data), model outputs keyed to
  model version, volatile feeds short. **Negative caching only for definitive "not found"**, never for 429,
  5xx, timeouts or errors.
- **Serve stale on rate limit:** when a provider is rate limiting (I3) and an expired cached value exists,
  return it, flagged `stale: true` with its age, instead of an error.
- Pre-warm (`prewarm-manager.ts`) must go through the governor at lowest priority and skip keys already cached.

I3 **Team-wide 429 pause**
- A 429 (or 503 with `Retry-After`) from a provider sets `pausedUntil` for that provider **for everyone**,
  using `Retry-After` capped by the existing upper bound in `http-client.ts`, with a floor when it is absent or 0.
  A 429 is a policy answer, so it pauses the provider and does **not** count toward the circuit breaker
  (consistent with the existing comment in `http-client.ts`).
- While paused, the governor does not call the provider: it serves stale cache (I2) if present, otherwise
  returns a typed `PROVIDER_RATE_LIMITED { provider, retryAfterSec }`. Callers with a longer deadline may wait.
  Queued jobs that need the provider are delayed, not failed.
- Reader-facing copy: "DynaMut2 is limiting requests; retrying in N s" through a pure function in `src/shared`
  (same style as `foldingLimits.ts`), never "the server is down". Integrate the existing handlers in
  `stability/dynamut.ts` (it already special-cases 429) instead of leaving two mechanisms.
- Provider health (state, `pausedUntil`, recent 429 count, `limitBasis`) is exposed on the existing
  `/capabilities` route so the owner can see which provider is the constraint.

I4 **Per-user credentials as the encouraged path**
- Budget buckets are keyed by **credential identity** (a hash of the token, never the token): a user's own
  Biohub or HF token is limited by their own bucket; the shared server token by the shared bucket. A user who
  supplies their own token never falls back to the shared one.
- `SHARED_TOKEN_FALLBACK=on|limited|off` (default `limited`): when a user has no token, the shared one is used
  under the fair-share rules and a per-user share of its allowance.
- UI: in settings, say in plain words that adding your own Biohub and Hugging Face tokens means your requests use
  **your** allowance and do not slow the team; after each remote model result, show whether it used "your
  token" or "the team token". Locate settings in `src/components/settings/sections/ConnectionsSection.tsx`.
- Optional later (I4b, only if re-entering tokens on each device proves annoying): store each user's tokens on
  the server in an encrypted `user_secrets` table (AES-GCM, key derived from `APP_SESSION_SECRET`), so they
  follow the user across browsers. Not part of the first release.
- Tokens are never logged or cached, and never included in a cache key (extend the `requestLogger` redaction if needed).

Acceptance
- Fair share test: user X issues 100 calls to one provider, user Y issues 1; Y's call completes before X's
  third. Single user alone gets the full allowance (no idle capacity).
- A simulated 429 from DynaMut2 pauses it for **both** users for `Retry-After`; calls during the pause do not
  reach the provider; stale cached data is returned flagged stale; after the pause calls resume; the circuit
  breaker is not tripped by the 429.
- Two users requesting the same remote result concurrently cause exactly one upstream call; the second gets
  the cached or in-flight result with correct provenance.
- Changing the user or token never changes a cache key (property test over the inventory's key builders).
- A user with their own Biohub token is never charged to the shared bucket; a user without one is, under the
  fallback policy.
- The ratchet test passes and lists the remaining raw `fetch(` sites.
- `EGRESS_GOVERNOR=shadow` reports delays it would have applied without changing responses; `off` is today's behaviour.
- No token or credential hash appears in logs or in `/capabilities`.

Risks: governing 55 call sites at once is large, so migrate provider by provider behind the flag and keep the
backstops. Published limits are missing for several providers; the limiter must work with concurrency alone and
learn rates from observed 429s rather than guess.

---

### WP-H  Docs and operations

- Update `doc/DEPLOYMENT_OCI.md` and `doc/DEPLOY.md`: accounts, `AUTH_MODE`, `AUTH_PROVIDER`, first admin,
  new env vars, backups of `data/accounts.sqlite` (`deploy/backup-sqlite.sh`), and the corrected 2 OCPU / 12 GB figure.
- **Correct the stale Cloudflare claims** in `README.md` (Access Control section) and
  `doc/DEPLOYMENT_OCI.md`: the live deployment is Caddy on `missense-resolve.duckdns.org`. Say clearly that
  access control is the app's own login, and mark the `cloudflared` service in
  `deploy/docker-compose.oci.yml` as optional.
- **First-admin and cut-over runbook** for a non-developer owner: set `ADMIN_SETUP_SECRET` in `.env`,
  restart, open `/setup` and create the owner account; add the team from the admin page and hand over each
  invite link; check each person can sign in; then step `AUTH_MODE` from `legacy` to `hybrid` to
  `accounts`, with a one-line rollback (set it back and restart).
- `Caddyfile`: confirm the agent and auth routes pass through unchanged and that response headers do not
  cache `/api/v1/auth/*` or `/api/v1/agent/*`.
- New `doc/AGENT.md` for end users, **plain language, no jargon**: what "Connect my computer" does, the
  three steps, how to pause or disconnect, what the agent receives (the structure of your own job) and
  what it never does, and what to do when FoldX setup shows a red cross.
- Add the licence note: FoldX is research use only, non-commercial, small team (the owner's statement).
- `doc/API.md` and `server/services/infra/openapi.ts` for the new endpoints.
- `.env.example` entries (check the root for the existing file name).

**Done (2026-10-11, `docs/wp-h-ops`):**
- `doc/ACCOUNTS.md`, the owner runbook: how access works, applying a setting, first admin, invites, the
  `AUTH_MODE` cut-over and rollback, day-to-day admin, job limits, `COMPUTE_ROUTING` shadow → on, backups
  and restore, a settings reference, the FoldX licence note. Linked from `README.md`, `doc/README.md`,
  `doc/DEPLOY.md` and `doc/API.md`.
- **Applying a setting had no safe path:** Compose reads `.env.oci` only when it creates a container, and
  `rollout.py` returned "already serving" for the same revision, so the plan's "set it back and restart"
  could only be done with `docker compose up`, which skips the drain. `rollout.py --restart` now runs the
  full handover on the serving revision (`deploy/test_rollout.py` covers the order).
- Cloudflare claims corrected in `README.md` and the owner's untracked `doc/DEPLOYMENT_OCI.md` (it is
  deliberately not in the repository; CD preserves the host copy, so the owner copies the update there).
  `deploy/setup-oci.sh` closed every web port for the tunnel design; the site worked only because
  Docker-published ports bypass UFW. It now opens 80 and 443 for Caddy.
- OpenAPI: the queued-compute, account, job and admin paths are in `server/services/infra/openapi-compute.ts`,
  with a `SessionCookie` scheme. Three documented paths never existed (`/biophysical-analysis`,
  `/find-pocket`, `/align-sequences`); they are replaced by the real `/generate-mutant`, `/foldx-job/{jobId}`,
  `/pocket-finder` and `/pocket-job/{jobId}`. `server/routes/docs.test.ts` now fails on a documented route
  the server does not register, and on an account, admin or job route missing from the spec.
- `doc/API.md`: the `AUTH_MODE` rules, queued responses and refusals, and the account, job and admin routes.
- `Caddyfile`: confirmed nothing caches the account routes (Caddy has no cache here, the app sends
  `no-store`); a comment says so.
- `.env.example`: concurrency, retention and the placement tunables.
- **Not done, by decision:** `doc/AGENT.md` moves to WP-F, because it would describe a feature that does
  not exist yet.

---

## 8. Environment variables introduced

| Name | Default | Package |
|---|---|---|
| `AUTH_MODE` | `legacy` | A |
| `AUTH_PROVIDER` | `password` (the production value) | A |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | none; only for the optional WP-A2 provider, startup fails closed if it is selected without them | A2 |
| `PUBLIC_BASE_URL` | `https://missense-resolve.duckdns.org` (used in invite, reset and agent-pairing links) | A, F |
| `ACCOUNTS_DB_PATH` | `data/accounts.sqlite` | A |
| `SESSION_TTL_DAYS`, `SESSION_IDLE_HOURS` (password mode only) | 14, 24 | A |
| `QUOTA_QUEUED_PER_USER` | 25 | A, B |
| `QUOTA_SERVER_SECONDS_PER_DAY` | **unset (no daily cap)** | A, B |
| `QUEUE_MAX_TOTAL` | 50 (waiting + running across everyone; the host backstop; a lone person may queue up to this minus 5) | B |
| `BIOPHYSICAL_CONCURRENCY` | 4 (jobs running at once). Unset, FoldX is capped at `min(this, CPUs − 1)` — 1 on the 2-core server. **Set, FoldX gets exactly this value too**, so 4 there means 4 Box64 FoldX at once. | B |
| `JOB_RETENTION_DAYS`, `TELEMETRY_RETENTION_DAYS` | 14, 180 (finished jobs, then timing records) | B, 0 |
| `EGRESS_GOVERNOR` | `off` (then `shadow`, then `on`) | I |
| `SHARED_TOKEN_FALLBACK` | `limited` (`on`, `limited`, `off`) | I |
| `EGRESS_PROVIDER_LIMITS_JSON` | none; optional override of the registry's per-provider limits | I |
| `AGENT_FOLDX_SOURCE` | `team` (falls back to `guided` automatically when no bundle is uploaded) | F |
| `ADMIN_SETUP_SECRET` | none; enables `/setup` only while no user exists | A |
| `COMPUTE_ROUTING` | `shadow` (logs only; `off` under test) — move to `on` after reviewing the log | C, D, G |
| `COST_MODEL_MIN_SAMPLES` | 8 | C |
| `ROUTING_RAM_HEADROOM`, `ROUTING_TIE_MARGIN` | 1.25, 0.20 | C |
| `AGENT_LEASE_SEC`, `AGENT_HEARTBEAT_SEC` | 60, 20 | F |
| `AGENT_SERVER_URL`, `AGENT_TOKEN`, `AGENT_MAX_RAM_GB`, `AGENT_PAUSE` | none | F (agent side) |
| `AGENT_HOME`, `AGENT_PAGE_PORT` | `%LOCALAPPDATA%\MissenseAgent` or `~/.missense-agent`; a random loopback port | F (agent side) |
| `TOOL_BUNDLES_DIR`, `AGENT_BUNDLE_DIR` | `data/tool-bundles`, `data/agent-bundles` | F |
| `AGENT_ACCEPTED_FOLDX_VERSIONS`, `AGENT_ACCEPTED_P2RANK_VERSIONS` | none (any well-formed version) | F |

---

## 9. Security summary

- The app is on the public internet with no identity layer in front, so its login is the access control:
  no sign-up; scrypt; hashed session, reset and agent tokens; throttling keyed so a forged forwarding header
  cannot dodge it; CSRF via JSON plus Origin; `Secure`/`HttpOnly` cookies over Caddy's TLS.
- The agent path `/api/v1/agent/*` is reachable without a user session by design and is therefore protected
  only by the per-agent token: long random values, stored hashed, revocable, scoped to one owner, rate limited.
- Agents are outbound-only, per-agent revocable tokens, scoped to their owner's jobs, and run only the
  two typed job kinds.
- PDB text is sent only to the owner's own agent (decision 4).
- Agent results are untrusted input: schema and sanity checks, tool-version check, provenance, and a single
  re-run on the server when validation fails (decision 5).
- The legacy shared token shrinks to a low-quota `service` principal and then to read-only.

## 10. Risks and open points

1. **Memory is unmeasured** until WP-0 runs. The conservative admission rule covers the gap.
2. **FoldX licence.** Recorded as research-only, non-commercial, small team (decision 6), as the owner's
   statement; the FoldX licence text was not reviewed while writing this plan, and nothing here is legal
   advice. Team distribution is the default by the owner's decision, with the position owned and recorded by
   the admin (confirmation tick, audit log) and a one-button revoke that wipes agent copies. If the owner
   later finds the licence does not allow it: press revoke, and the system falls back to per-user manual
   setup (`guided`) with no code change. Revisit if the team grows or the use changes.
3. **Limit defaults** in 4.4 are proposals; adjust after a week of telemetry. The fairness rule is the part
   that matters, and it needs no tuning.
4. **The app is directly on the public internet** (Caddy + DuckDNS, no edge identity). Until `AUTH_MODE`
   reaches `accounts`, the shared token is the only gate, so cut over soon after WP-A ships. The password
   login needs real brute-force protection, and recovery depends on the admin (no email). The Cloudflare
   provider (WP-A2) is optional and would only be worth building if the deployment moves behind it.
4a. **Agent downloads (JRE, P2Rank)** depend on upstream URLs staying valid; pin versions and hashes, and
   fail with a plain message plus a manual fallback in `doc/AGENT.md`.
5. **Sidecar models are not queued** (SaProt-local, StabilityOracle, ThermoMPNN). They do not take part in
   placement until moved behind the queue. Out of scope.
6. **Windows specifics for the agent**: process-tree RSS sampling and Java discovery (`java-detector.ts`)
   need a Windows test pass.
7. **Redis backend** gets none of this; keep `REDIS_URL` unset for the team deployment.
8. **Shared outbound IP and shared keys.** Handled by WP-I (fair share, shared cache, team-wide 429 pause,
   per-user credentials). Several providers publish no limits, so the limiter learns from observed 429s; if
   a provider still blocks the team, the reserved option in section 12 applies.

## 11. What must stay unchanged

- FoldX timeout nesting and `server/tests/foldx-timeout-budget.test.ts`.
- The leader/follower de-duplication semantics and queue crash recovery.
- Handover safety: a paused standby never claims work or serves agent claims.
- Provenance fields on structures and results.

---

## 12. Reserved options (documented, **not** to be built unless the trigger is met)

### R-1  Make remote calls from the user's own IP through the agent

**Status: reserved.** WP-I (fair share, shared cache, team-wide 429 pause, per-user credentials) is the
planned answer to the team sharing one outbound IP. This option exists so that if that is not enough, there is
a documented next step rather than an improvised one.

**Trigger (decide with the owner; "blocking" means all of these):**
1. WP-I is live (`EGRESS_GOVERNOR=on`) and the cache audit (I2) is done.
2. A specific provider still answers 429 or blocks to a degree users notice, measured from the provider
   health data on `/capabilities` over at least a week of normal use.
3. That provider's published terms allow per-user-IP access (or the owner accepts the position) and the
   provider has no per-user credential the team could use instead (I4).

**Sketch.** A new agent job kind `remote-call` limited to an **allowlist of provider and endpoint
templates** (for example the UQ BioSig DynaMut2 and DDMut calls, or NCBI). The server decides, per call, that the
submitter's agent should make it; the agent performs the HTTP request from the user's own network and returns
the response body; the server validates it against the same schema the server-side client uses, then caches it
through I2 like any other result.

**Constraints, so it cannot go wrong quietly:**
- **Never send a server-held credential to an agent.** Only credential-less public endpoints, or the user's own
  token, are eligible. JapanFold, AlphaGenome and the shared Biohub key stay server-side.
- The agent receives the request **template and parameters**, never an arbitrary URL. Hosts, paths and methods
  come from the allowlist; the agent refuses anything else.
- Results are untrusted input: schema validation, size limits, and provenance `fetchedVia: "agent"` with the
  agent id; a failed validation falls back to the server path.
- It reuses WP-F's pairing, tokens, leases and revoke; a revoked agent can no longer perform calls.
- Per-provider terms of service are checked and recorded in the allowlist entry before it is enabled.
- It counts toward the user's own IP only; the server's IP is not relieved for calls the agent could not make
  (for example when the user's agent is offline, the server falls back to its own path under WP-I).

**Why not now.** It moves network behaviour onto users' machines, adds a validation surface, depends on the
agent being online and on provider terms, and WP-I may make it unnecessary. **Do not start it without the
trigger above.**
